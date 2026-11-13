// @ts-check
/**
 * Renders domain objects as contract HTML. All markup lives here.
 *
 * Markup conventions (the contract both frontend consumers rely on):
 * - Everything a consumer needs is inside <main>; <nav> is for people only.
 * - Sections and forms have stable ids: #result, #home, #guide, #profile,
 *   #conflicts, #destination, #update-profile, #report-conflict, #reset-profile,
 *   #lookup-destination.
 * - #result[data-outcome] says what a request did (an OutcomeKind, or "error").
 * - [data-field] marks a field; profile fields also carry [data-kind] and,
 *   when they have no value, [data-empty].
 * - Machine-readable values are <data value="…">; the text is for humans.
 * - Conflicts are <article data-conflict="{id}" data-field="{field}">, with
 *   parts marked by [data-role]: existing, new-information, evidence, proposed.
 * - Forms define writes: their action and input names are the request
 *   contract (see contract.js).
 * - Pages served to the agent (X-Client: agent) omit forms it may not use.
 */
import { FIELD_NAMES, OPS_BY_KIND, PROFILE_FIELDS, RESOLUTIONS, ROUTES } from './contract.js';
import { GUIDE } from './guide.js';

/** @typedef {import('./profile.js').State} State */
/** @typedef {import('./profile.js').Conflict} Conflict */
/** @typedef {import('./profile.js').ProfileValue} ProfileValue */
/** @typedef {import('./destinations.js').DestinationInfo} DestinationInfo */
/** @typedef {{ outcome: string, message: string, errors?: string[] }} Result */
/** @typedef {import('./contract.js').Client} Client */

/** @param {Result} [result] */
export function renderHomePage(result) {
  const guide = GUIDE.map(
    ({ title, rules }) => `<h3>${esc(title)}</h3>\n<ul>\n${rules.map((r) => `<li>${esc(r)}</li>`).join('\n')}\n</ul>`,
  ).join('\n');
  return page(
    'Profile service',
    `${renderResult(result)}
<section id="home">
<h1>Profile service</h1>
<p>Stores a traveler's profile and provides destination information.</p>
<ul>
<li><a href="${ROUTES.profile}">Travel profile</a>: the current profile, any open conflicts, and the forms for changing them.</li>
<li><a href="${ROUTES.destinations}">Destinations</a>: the destinations this service has information on, and a lookup form.</li>
</ul>
</section>
<section id="guide">
<h2>Instructions for the assistant</h2>
${guide}
</section>`,
  );
}

/**
 * @param {State} state
 * @param {Result} [result]
 * @param {Client} [client]
 */
export function renderProfilePage(state, result, client = 'browser') {
  return page(
    'Travel profile',
    `${renderResult(result)}
${renderProfile(state)}
${renderConflicts(state.conflicts)}
${renderProfileForms(client)}`,
  );
}

/**
 * @param {string[]} names
 * @param {Result} [result]
 */
export function renderDestinationsPage(names, result) {
  return page(
    'Destinations',
    `${renderResult(result)}
<section id="destinations">
<h1>Destinations</h1>
<ul>
${names.map((n) => `<li><a href="${ROUTES.destinations}?name=${encodeURIComponent(n)}">${esc(n)}</a></li>`).join('\n')}
</ul>
${renderLookupForm()}
</section>`,
  );
}

/** @param {DestinationInfo} info */
export function renderDestinationPage(info) {
  const budget = info.averageDailyBudgetUSD;
  /** @type {Array<[string, string, string | undefined]>} */
  const notes = [
    ['visaNotes', 'Visa notes', info.visaNotes],
    ['dietaryNotes', 'Dietary notes', info.dietaryNotes],
    ['accessibilityNotes', 'Accessibility notes', info.accessibilityNotes],
  ];
  return page(
    info.name,
    `<section id="result" data-outcome="found"><p>Destination information for ${esc(info.name)}.</p></section>
<article id="destination" data-name="${esc(info.name)}">
<h1>${esc(info.name)}</h1>
<dl>
<dt>Country</dt>
<dd data-field="country">${esc(info.country)}</dd>
<dt>Best seasons</dt>
<dd data-field="bestSeasons">${renderList(info.bestSeasons)}</dd>
<dt>Known for</dt>
<dd data-field="knownFor">${renderList(info.knownFor)}</dd>
<dt>Average daily budget (USD)</dt>
<dd data-field="averageDailyBudgetUSD"><ul>
<li>Budget: <data data-tier="budget" value="${budget.budget}">$${budget.budget}</data></li>
<li>Mid-range: <data data-tier="midRange" value="${budget.midRange}">$${budget.midRange}</data></li>
<li>Luxury: <data data-tier="luxury" value="${budget.luxury}">$${budget.luxury}</data></li>
</ul></dd>
${notes
  .filter(([, , text]) => text)
  .map(([field, label, text]) => `<dt>${label}</dt>\n<dd data-field="${field}">${esc(text ?? '')}</dd>`)
  .join('\n')}
</dl>
</article>
${renderLookupForm()}`,
  );
}

/**
 * @param {string} name
 * @param {string[]} knownNames
 */
export function renderDestinationNotFoundPage(name, knownNames) {
  return renderDestinationsPage(knownNames, {
    outcome: 'not-found',
    message: `No information available for "${name}". The known destinations are: ${knownNames.join(', ')}.`,
  });
}

/**
 * For transport-level failures (unknown route, bad method, bad body, server error).
 * @param {string} title
 * @param {string} message
 */
export function renderErrorPage(title, message) {
  return page(title, renderResult({ outcome: 'error', message }));
}

// --- Sections ---------------------------------------------------------------

/** @param {Result} [result] */
function renderResult(result) {
  if (!result) return '';
  const errors = result.errors?.length
    ? `\n<ul>\n${result.errors.map((e) => `<li>${esc(e)}</li>`).join('\n')}\n</ul>`
    : '';
  return `<section id="result" data-outcome="${esc(result.outcome)}">
<p>${esc(result.message)}</p>${errors}
</section>`;
}

/** @param {State} state */
function renderProfile(state) {
  const fields = FIELD_NAMES.map((field) => {
    const { label, kind } = PROFILE_FIELDS[field];
    const values = state.profile[field];
    const attrs = `data-field="${field}" data-kind="${kind}"`;
    const body =
      values.length === 0
        ? `<dd ${attrs} data-empty>Not specified</dd>`
        : `<dd ${attrs}><ul>\n${values.map(renderProfileValue).join('\n')}\n</ul></dd>`;
    return `<dt>${esc(label)}</dt>\n${body}`;
  });
  return `<section id="profile">
<h1>Travel profile</h1>
<dl>
${fields.join('\n')}
</dl>
</section>`;
}

/** @param {ProfileValue} v */
function renderProfileValue(v) {
  return `<li><data value="${esc(v.value)}">${esc(v.value)}</data> <small>(user said: <q>${esc(v.evidence)}</q>)</small></li>`;
}

/** @param {Conflict[]} conflicts */
function renderConflicts(conflicts) {
  const body =
    conflicts.length === 0 ? '<p data-empty>No open conflicts.</p>' : conflicts.map(renderConflict).join('\n');
  return `<section id="conflicts">
<h2>Open conflicts</h2>
${body}
</section>`;
}

/** @param {Conflict} c */
function renderConflict(c) {
  const label = PROFILE_FIELDS[c.field].label;
  const existing = c.existing.length
    ? c.existing.map((v) => `<data data-role="existing" value="${esc(v)}">${esc(v)}</data>`).join(', ')
    : 'nothing';
  const proposed = c.proposed
    ? `\n<p data-role="proposed" data-op="${c.proposed.op}" data-value="${esc(c.proposed.value)}">Proposed change: ${esc(c.newInformation)}. Resolve with accept to apply it.</p>`
    : '';
  const resolutions = RESOLUTIONS.filter((r) => r !== 'accept' || c.proposed);
  return `<article id="conflict-${esc(c.id)}" data-conflict="${esc(c.id)}" data-field="${c.field}">
<h3>Conflict ${esc(c.id)}: ${esc(label)}</h3>
<p>Stored: ${existing}</p>
<p>New information: <q data-role="new-information">${esc(c.newInformation)}</q></p>
<p>User said: <q data-role="evidence">${esc(c.evidence)}</q></p>${proposed}
<form method="post" action="${ROUTES.conflict(esc(c.id))}">
<p><label>Resolution ${select('resolution', resolutions.map((r) => [r, r]))}</label></p>
<p><label>Value(s) for replace, one per line<br><textarea name="value" rows="2" cols="40"></textarea></label></p>
<p><label>User said <input name="evidence" size="40"></label></p>
<p><button type="submit">Resolve ${esc(c.id)}</button></p>
</form>
</article>`;
}

/** @param {Client} client */
function renderProfileForms(client) {
  const fieldOptions = FIELD_NAMES.map((f) => /** @type {[string, string]} */ ([f, `${PROFILE_FIELDS[f].label} (${f})`]));
  const ops = [...new Set(Object.values(OPS_BY_KIND).flat())].map((op) => /** @type {[string, string]} */ ([op, op]));
  const opHelp = Object.entries(OPS_BY_KIND)
    .map(([kind, allowed]) => `${kind} fields: ${allowed.join(', ')}`)
    .join('; ');
  return `<section id="profile-actions">
<h2>Change the profile</h2>
<form id="update-profile" method="post" action="${ROUTES.profile}">
<p><label>Field ${select('field', fieldOptions)}</label></p>
<p><label>Operation ${select('op', ops)}</label> <small>(${esc(opHelp)})</small></p>
<p><label>Value <input name="value" size="40" required></label></p>
<p><label>User said <input name="evidence" size="40" required></label></p>
<p><button type="submit">Submit change</button></p>
</form>
<h2>Report a contradiction</h2>
<form id="report-conflict" method="post" action="${ROUTES.conflicts}">
<p><label>Field ${select('field', fieldOptions)}</label></p>
<p><label>New information <input name="newInformation" size="40" required></label></p>
<p><label>User said <input name="evidence" size="40" required></label></p>
<p><button type="submit">Report conflict</button></p>
</form>
${client === 'agent' ? '' : renderResetForm()}
</section>`;
}

function renderResetForm() {
  return `<h2>Start over</h2>
<form id="reset-profile" method="post" action="${ROUTES.reset}">
<p><button type="submit">Clear profile and conflicts</button></p>
</form>`;
}

function renderLookupForm() {
  return `<form id="lookup-destination" method="get" action="${ROUTES.destinations}">
<p><label>Look up a destination <input name="name" required></label> <button type="submit">Look up</button></p>
</form>`;
}

// --- Primitives -------------------------------------------------------------

/**
 * @param {string} title
 * @param {string} main
 */
function page(title, main) {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>${esc(title)}</title>
</head>
<body>
<nav><a href="${ROUTES.home}">Home</a> | <a href="${ROUTES.profile}">Profile</a> | <a href="${ROUTES.destinations}">Destinations</a></nav>
<main>
${main}
</main>
</body>
</html>
`;
}

/** @param {readonly string[]} items */
function renderList(items) {
  return `<ul>${items.map((i) => `<li><data value="${esc(i)}">${esc(i)}</data></li>`).join('')}</ul>`;
}

/**
 * @param {string} name
 * @param {Array<[string, string]>} options [value, label] pairs
 */
function select(name, options) {
  return `<select name="${name}">${options.map(([v, l]) => `<option value="${esc(v)}">${esc(l)}</option>`).join('')}</select>`;
}

/** @param {string} text */
function esc(text) {
  return String(text)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}
