// @ts-check
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { after, before, describe, it } from 'node:test';
import { createApp } from './server.js';
import { createMemoryStore } from './store.js';

/** @type {import('node:http').Server} */
let server;
let base = '';

before(async () => {
  const handle = await createApp({ store: createMemoryStore(), log: () => {} });
  server = createServer(handle);
  await new Promise((resolve) => server.listen(0, () => resolve(undefined)));
  const address = /** @type {import('node:net').AddressInfo} */ (server.address());
  base = `http://localhost:${address.port}`;
});

after(() => server.close());

/** @param {string} path @param {Record<string, string>} fields */
function post(path, fields) {
  return fetch(base + path, { method: 'POST', body: new URLSearchParams(fields) });
}

/** @param {string} html */
function outcomeOf(html) {
  return html.match(/<section id="result" data-outcome="([^"]+)"/)?.[1];
}

describe('profile service over HTTP', () => {
  it('serves the profile with CORS headers for file:// pages', async () => {
    const res = await fetch(`${base}/profile`);
    assert.equal(res.status, 200);
    assert.equal(res.headers.get('access-control-allow-origin'), '*');
    assert.match(res.headers.get('content-type') ?? '', /text\/html/);
    assert.match(await res.text(), /<section id="profile">/);
  });

  it('applies changes the agent submits, and keeps reported conflicts until resolved', async () => {
    const set = await post('/profile', { field: 'homeBase', op: 'set', value: 'Boston', evidence: 'I live in Boston' });
    assert.equal(set.status, 200);
    assert.equal(outcomeOf(await set.text()), 'applied');

    const report = await post('/profile/conflicts', {
      field: 'homeBase',
      newInformation: 'mentioned their place in Chicago',
      evidence: 'back at my place in Chicago',
    });
    assert.equal(report.status, 201);
    const html = await report.text();
    assert.equal(outcomeOf(html), 'reported');
    assert.match(html, /<dd data-field="homeBase" data-kind="single"><ul>\n<li><data value="Boston">/);
    assert.match(html, /<article id="conflict-c1" data-conflict="c1" data-field="homeBase">/);

    const resolve = await post('/profile/conflicts/c1', { resolution: 'replace', value: 'Chicago' });
    assert.equal(resolve.status, 200);
    const resolved = await resolve.text();
    assert.match(resolved, /<data value="Chicago">/);
    assert.match(resolved, /No open conflicts/);
  });

  it('rejects invalid input with 422 and lists the errors', async () => {
    const res = await post('/profile', { field: 'budget', op: 'add', value: 'cheap' });
    assert.equal(res.status, 422);
    const html = await res.text();
    assert.equal(outcomeOf(html), 'invalid');
    assert.match(html, /field must be one of/);
  });

  it('rejects non-form bodies with 415', async () => {
    const res = await fetch(`${base}/profile`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '{}',
    });
    assert.equal(res.status, 415);
  });

  it('returns 404 for an unknown conflict', async () => {
    assert.equal((await post('/profile/conflicts/c99', { resolution: 'keep' })).status, 404);
  });

  it('looks up destinations: 200 when known, 404 with a plain statement when not', async () => {
    const found = await fetch(`${base}/destinations?name=kyoto`);
    assert.equal(found.status, 200);
    assert.match(await found.text(), /<article id="destination" data-name="Kyoto">/);

    const missing = await fetch(`${base}/destinations?name=Ulaanbaatar`);
    assert.equal(missing.status, 404);
    assert.match(await missing.text(), /No information available for &quot;Ulaanbaatar&quot;/);
  });

  it('answers unknown routes with 404 and wrong methods with 405', async () => {
    assert.equal((await fetch(`${base}/nope`)).status, 404);
    const res = await fetch(`${base}/profile`, { method: 'DELETE' });
    assert.equal(res.status, 405);
    assert.equal(res.headers.get('allow'), 'GET, POST');
  });

  it('allows the agent header in preflight and caches the answer', async () => {
    const res = await fetch(`${base}/profile`, {
      method: 'OPTIONS',
      headers: { 'Access-Control-Request-Method': 'POST', 'Access-Control-Request-Headers': 'x-client' },
    });
    assert.equal(res.status, 204);
    assert.match(res.headers.get('access-control-allow-headers') ?? '', /X-Client/);
    assert.equal(res.headers.get('access-control-max-age'), '600');
  });

  it('hides the reset form from the agent and refuses its reset requests', async () => {
    const asAgent = { 'X-Client': 'agent' };
    await post('/profile', { field: 'interests', op: 'add', value: 'museums', evidence: 'I like museums' });

    const page = await (await fetch(`${base}/profile`, { headers: asAgent })).text();
    assert.doesNotMatch(page, /id="reset-profile"/);
    assert.match(await (await fetch(`${base}/profile`)).text(), /id="reset-profile"/);

    const res = await fetch(`${base}/profile/reset`, { method: 'POST', headers: asAgent, body: new URLSearchParams() });
    assert.equal(res.status, 403);
    const html = await res.text();
    assert.equal(outcomeOf(html), 'forbidden');
    assert.match(html, /<data value="museums">/);
  });

  it('reset clears the profile and conflicts', async () => {
    const res = await post('/profile/reset', {});
    assert.equal(res.status, 200);
    const html = await res.text();
    assert.match(html, /No open conflicts/);
    assert.doesNotMatch(html, /<data value=/);
  });
});
