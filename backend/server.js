// @ts-check
/**
 * HTTP transport for the profile service: routing, CORS, form parsing,
 * status codes and request logging. Business rules live in profile.js.
 *
 * Run with: node backend/server.js
 */
import { randomUUID } from 'node:crypto';
import { createServer } from 'node:http';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import {
  AGENT_CLIENT,
  CLIENT_HEADER,
  LIMITS,
  STATUS_BY_OUTCOME,
  parseConflictReport,
  parseConflictResolution,
  parseProfileChange,
} from './contract.js';
import { getDestinationInfo, listDestinationNames } from './destinations.js';
import {
  renderDestinationNotFoundPage,
  renderDestinationPage,
  renderDestinationsPage,
  renderErrorPage,
  renderHomePage,
  renderProfilePage,
} from './html.js';
import { applyChange, reportConflict, resetState, resolveConflict } from './profile.js';
import { createFileStore } from './store.js';

/** @typedef {import('node:http').IncomingMessage} Request */
/** @typedef {import('node:http').ServerResponse} Response */
/** @typedef {import('./store.js').Store} Store */
/** @typedef {import('./profile.js').State} State */
/** @typedef {import('./profile.js').Transition} Transition */
/** @typedef {(event: Record<string, unknown>) => void} Log */
/** @typedef {{ status: number, html: string, headers?: Record<string, string> }} Reply */
/** @typedef {import('./contract.js').Client} Client */
/** @typedef {(ctx: { url: URL, req: Request, params: string[], client: Client }) => Promise<Reply>} Handler */

/** Thrown by handlers to reply with an error page. */
class HttpError extends Error {
  /** @param {number} status @param {string} message @param {Record<string, string>} [headers] */
  constructor(status, message, headers) {
    super(message);
    this.status = status;
    this.headers = headers;
  }
}

/**
 * @param {{ store: Store, log?: Log, now?: () => Date }} options
 */
export async function createApp({ store, log = logJson, now = () => new Date() }) {
  let state = await store.load();

  // Writes are serialized so each one sees the previous one's result and a
  // slow save can't be overtaken by a later request.
  let queue = Promise.resolve();
  /** @param {(state: State) => Transition} transition */
  function mutate(transition) {
    const run = queue.then(async () => {
      const { state: next, outcome } = transition(state);
      if (next !== state) {
        await store.save(next);
        state = next;
      }
      return outcome;
    });
    queue = run.then(
      () => {},
      () => {},
    );
    return run;
  }

  /** @param {(state: State) => Transition} transition @param {Client} client @returns {Promise<Reply>} */
  async function write(transition, client) {
    const outcome = await mutate(transition);
    return {
      status: STATUS_BY_OUTCOME[outcome.kind],
      html: renderProfilePage(state, { outcome: outcome.kind, message: outcome.message }, client),
    };
  }

  /** @param {string[]} errors @param {Client} client @returns {Reply} */
  function invalidRequest(errors, client) {
    return {
      status: STATUS_BY_OUTCOME.invalid,
      html: renderProfilePage(state, { outcome: 'invalid', message: 'Request rejected.', errors }, client),
    };
  }

  /** @type {Array<[string, RegExp, Handler]>} */
  const routes = [
    ['GET', /^\/$/, async () => ({ status: 200, html: renderHomePage() })],

    ['GET', /^\/profile$/, async ({ client }) => ({ status: 200, html: renderProfilePage(state, undefined, client) })],

    [
      'POST',
      /^\/profile$/,
      async ({ req, client }) => {
        const parsed = parseProfileChange(await readForm(req));
        if (!parsed.ok) return invalidRequest(parsed.errors, client);
        return write((s) => applyChange(s, parsed.value, now()), client);
      },
    ],

    [
      'POST',
      /^\/profile\/conflicts$/,
      async ({ req, client }) => {
        const parsed = parseConflictReport(await readForm(req));
        if (!parsed.ok) return invalidRequest(parsed.errors, client);
        return write((s) => reportConflict(s, parsed.value, now()), client);
      },
    ],

    [
      'POST',
      /^\/profile\/conflicts\/([A-Za-z0-9]+)$/,
      async ({ req, params: [id], client }) => {
        const parsed = parseConflictResolution(await readForm(req));
        if (!parsed.ok) return invalidRequest(parsed.errors, client);
        return write((s) => resolveConflict(s, id, parsed.value, now()), client);
      },
    ],

    [
      'POST',
      /^\/profile\/reset$/,
      async ({ client }) => {
        if (client === 'agent') {
          const message = 'The assistant may not reset the profile; only the user can, from the profile page.';
          return {
            status: STATUS_BY_OUTCOME.forbidden,
            html: renderProfilePage(state, { outcome: 'forbidden', message }, client),
          };
        }
        return write(resetState, client);
      },
    ],

    [
      'GET',
      /^\/destinations$/,
      async ({ url }) => {
        const names = listDestinationNames();
        const name = url.searchParams.get('name');
        if (name === null) return { status: 200, html: renderDestinationsPage(names) };
        if (name.trim() === '') {
          return {
            status: 422,
            html: renderDestinationsPage(names, { outcome: 'invalid', message: 'name must not be empty.' }),
          };
        }
        const info = await getDestinationInfo(name);
        return info
          ? { status: 200, html: renderDestinationPage(info) }
          : { status: 404, html: renderDestinationNotFoundPage(name.trim(), names) };
      },
    ],
  ];

  /** @param {Request} req @param {Response} res */
  return async function handle(req, res) {
    const requestId = randomUUID();
    const started = performance.now();
    const url = new URL(req.url ?? '/', 'http://localhost');
    /** @type {Client} */
    const client = req.headers[CLIENT_HEADER.toLowerCase()] === AGENT_CLIENT ? 'agent' : 'browser';

    /** @type {Reply} */
    let reply;
    try {
      reply = await route(routes, req, url, client);
    } catch (error) {
      if (error instanceof HttpError) {
        reply = { status: error.status, html: renderErrorPage(String(error.status), error.message), headers: error.headers };
      } else {
        log({ event: 'http.error', requestId, error: String(error), stack: /** @type {Error} */ (error).stack });
        reply = { status: 500, html: renderErrorPage('500', 'Internal error. The profile was not changed.') };
      }
    }

    res.writeHead(reply.status, {
      ...CORS_HEADERS,
      'Content-Type': 'text/html; charset=utf-8',
      'Cache-Control': 'no-store',
      'X-Request-Id': requestId,
      ...reply.headers,
    });
    res.end(req.method === 'HEAD' ? undefined : reply.html);

    log({
      event: 'http.request',
      requestId,
      method: req.method,
      path: url.pathname,
      client,
      status: reply.status,
      latencyMs: Math.round(performance.now() - started),
    });
  };
}

// The frontend is loaded from file:// (origin "null"), so allow any origin.
// Browser form posts need no preflight; the agent's requests carry
// X-Client, so they are preflighted and the answer is cached.
const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Expose-Headers': 'X-Request-Id',
};

/**
 * @param {Array<[string, RegExp, Handler]>} routes
 * @param {Request} req
 * @param {URL} url
 * @param {Client} client
 * @returns {Promise<Reply>}
 */
async function route(routes, req, url, client) {
  const method = req.method === 'HEAD' ? 'GET' : req.method;
  if (method === 'OPTIONS') {
    return {
      status: 204,
      html: '',
      headers: {
        'Access-Control-Allow-Methods': 'GET, POST',
        'Access-Control-Allow-Headers': `Content-Type, ${CLIENT_HEADER}`,
        'Access-Control-Max-Age': '600',
      },
    };
  }
  const matching = routes.filter(([, pattern]) => pattern.test(url.pathname));
  if (matching.length === 0) throw new HttpError(404, `No such page: ${url.pathname}`);
  const found = matching.find(([m]) => m === method);
  if (!found) {
    const allowed = matching.map(([m]) => m).join(', ');
    throw new HttpError(405, `${method} is not allowed here. Allowed: ${allowed}.`, { Allow: allowed });
  }
  const [, pattern, handler] = found;
  const params = /** @type {RegExpExecArray} */ (pattern.exec(url.pathname)).slice(1);
  return handler({ url, req, params, client });
}

/**
 * Reads an application/x-www-form-urlencoded body.
 * @param {Request} req
 * @returns {Promise<URLSearchParams>}
 */
async function readForm(req) {
  const type = (req.headers['content-type'] ?? '').split(';')[0].trim().toLowerCase();
  if (type !== 'application/x-www-form-urlencoded') {
    throw new HttpError(415, 'Send the body as application/x-www-form-urlencoded (a regular HTML form).');
  }
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > LIMITS.bodyBytes) throw new HttpError(413, `Request body exceeds ${LIMITS.bodyBytes} bytes.`);
    chunks.push(chunk);
  }
  return new URLSearchParams(Buffer.concat(chunks).toString('utf8'));
}

/** @type {Log} */
function logJson(event) {
  console.log(JSON.stringify({ time: new Date().toISOString(), ...event }));
}

// --- Entry point ------------------------------------------------------------

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const port = Number(process.env.PORT ?? 3000);
  const dataFile = process.env.DATA_FILE ?? join(import.meta.dirname, '..', 'data', 'profile.json');
  const handle = await createApp({ store: createFileStore(dataFile, logJson) });
  createServer(handle).listen(port, () => {
    logJson({ event: 'server.listening', url: `http://localhost:${port}`, dataFile });
  });
}
