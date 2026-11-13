# Profile Builder — Architecture

This describes how Profile Builder is built to meet [REQUIREMENTS.md](REQUIREMENTS.md) and [DECISIONS.md](DECISIONS.md).

## 1. Overview

Profile Builder has two parts, and the contract between them is **HTML**.

```
 ┌──────────────── Browser (file://.../frontend/index.html) ───────────────┐
 │                                                                         │
 │   React UI ◄── parses HTML ──┐                                          │
 │   (chat, profile panel)      │                                          │
 │                              │  one fetch,                              │
 │   LLM loop ◄─ tool result ───┤  two consumers                           │
 │      │                       │                                          │
 │      │ streams (SSE)         │ fetch (GET / form-encoded POST)          │
 └──────┼───────────────────────┼──────────────────────────────────────────┘
        ▼                       ▼
   OpenRouter API        Profile service (Node, http://localhost:3000)
   (user's API key)      profile + conflicts + destinations, JSON file store
```

- **Profile service (backend).** A plain Node HTTP server. It owns the profile schema, validation, conflict detection, persistence, and `getDestinationInfo`. Every response is unstyled HTML with no JavaScript. Navigation uses `<a>` links and writes use `<form>`s, so you can also use the service directly in a browser.
- **Frontend.** A single HTML file opened from the filesystem. It holds the chat UI, all styling, and the LLM loop, and calls OpenRouter directly with a key the user supplies. It calls the backend with `fetch`.

The backend's HTML has **two consumers on the frontend**:

1. **React** parses it with `DOMParser` and uses it as its data model (the profile panel and conflict flags).
2. **The LLM** receives the same HTML as the result of its tool calls.

When the LLM calls a tool, the frontend makes one request and gives the response to both consumers. The model and the UI therefore always see the same data.

## 2. Constraints and their consequences

| Constraint | Consequence |
|---|---|
| No build step, minimal dependencies | The backend is plain JavaScript (ES modules) run with `node backend/server.js` on Node ≥ 22, with **zero npm dependencies**: `node:http`, `node:fs`, `node:test`. The frontend loads React and [`htm`](https://github.com/developit/htm) from a CDN at pinned versions, so templates need no compile step. |
| Frontend is opened from `file://` | Its origin is `null`, so the backend sends `Access-Control-Allow-Origin: *`. Browser form posts are "simple" requests and need no preflight. The agent's requests carry `X-Client: agent`, so the browser preflights them; the backend allows that header and lets the browser cache the answer for 10 minutes. |
| `file://` can't load local modules | The frontend is **one self-contained file** with inline `<script type="module">` and `<style>`. Imports from `https://` CDNs still work. |
| No code is shared between the two sides | The typed contract is the **HTML structure itself** (§4). The backend defines it as data in `contract.js` and renders it in `html.js`, and the frontend validates what it parses. |
| Plain JS, no compiler | The contract is enforced by runtime validation at every boundary (form input, stored data, and on the frontend, LLM tool arguments and parsed HTML). JSDoc typedefs on the core types plus `// @ts-check` let an editor type-check the code; nothing checks them at runtime. |

## 3. Backend

### 3.1 Module layout

```
backend/
  server.js         transport: routing, CORS, form-body parsing, status codes, logging
  contract.js       the contract as data: fields, ops, resolutions, routes, limits, form parsers
  profile.js        domain: applying changes, conflict rules, resolution, stored-state validation
  destinations.js   getDestinationInfo() and the hardcoded destination data
  store.js          persistence: load/validate/save the JSON file atomically
  html.js           rendering: domain objects → contract HTML (all markup lives here)
  *.test.js         node:test tests for conflict rules, form parsing, destinations, HTTP behavior
data/
  profile.json      runtime state (gitignored)
```

Dependencies point one way: `server` → `profile` / `destinations` / `store` / `html` → `contract`. `profile.js` has no I/O, so the conflict rules can be tested in isolation.

### 3.2 Profile model (from D1)

| Field | Kind | Example |
|---|---|---|
| `interests` | list | hiking, street food |
| `dietaryRestrictions` | list | vegetarian |
| `accessibilityNeeds` | list | avoids long stair climbs |
| `companions` | list | partner |
| `accommodationPreferences` | list | small hotels |
| `transportPreferences` | list | trains over flying |
| `homeBase` | single value | Boston |
| `passportCountry` | single value | US |

Each stored value records the user's words that justified it (`evidence`) and when it was set.

### 3.3 Routes

| Method & path | Purpose | Responses |
|---|---|---|
| `GET /` | Entry point with links to the profile and destinations | 200 |
| `GET /profile` | The current profile and open conflicts, plus the forms for changing them | 200 |
| `POST /profile` | Apply one change: `field`, `op` (`add`, `remove` or `set`), `value`, `evidence` | 200 applied or unchanged · 422 invalid |
| `POST /profile/conflicts` | Report a semantic contradiction: `field`, `newInformation`, `evidence` | 201 reported · 200 already open · 422 |
| `POST /profile/conflicts/{id}` | Resolve a conflict: `resolution` (`keep` or `replace`); `value` (repeatable, or one per line) for `replace`; optional `evidence` | 200 · 404 · 422 |
| `POST /profile/reset` | Clear the profile and conflicts (for testing and demos). Refused for the agent. | 200 · 403 agent |
| `GET /destinations` | List the known destinations, with a lookup form | 200 |
| `GET /destinations?name=…` | `getDestinationInfo(name)`. Matching ignores case, accents and extra whitespace, and accepts a few aliases (e.g. Lisboa, CDMX). | 200 found · 404 not found · 422 empty name |

Every write responds with the updated profile page plus a **result section** saying what happened. A caller always gets the current state back and never needs a second `GET`.

**Agent requests.** Requests from the agent's tools carry `X-Client: agent`. The frontend's tool code sets the header, so the model can't leave it off. The backend applies agent policy in one place: the agent may not reset the profile (403), and pages served to it omit the reset form. The header is a declaration by a cooperating client, not authentication. `User-Agent` was considered and rejected, because Chrome silently ignores attempts to set it from `fetch`.

For list fields `op` is `add` or `remove`; for single-value fields it is `set` or `remove`. Writes must be `application/x-www-form-urlencoded` (anything else gets a 415, and bodies over 16 KB get a 413). Unknown paths get a 404 and wrong methods a 405, each with an HTML error page.

### 3.4 Conflicts (`profile.js`)

**The LLM detects conflicts and the backend keeps them.** Only the model can tell that "wants a steakhouse" contradicts "vegetarian", or that a new home city is a move rather than a mistake. So the backend makes no judgment about contradictions. It applies every change submitted to it and records the contradictions the model reports.

We first had the backend detect "structural" conflicts itself, treating any `remove`, or a `set` that differed from the stored value, as a conflict. That was a poor proxy. "Clear my preferences" produced one conflict per value. "I've moved to Chicago" was flagged, even though it's an update, not a contradiction. In both cases the agent knows whether the user *stated* a change or it is *inferring* one, and the backend can't tell the difference.

Changes (`POST /profile`):
- `add` to a list: applied. Adding is never a conflict (UC-10).
- `set` on a single-value field: replaces the stored value.
- `remove`: deletes the value.
- When a `set` or `remove` replaces or deletes a value, open conflicts about that value are closed, because the user has now said what's true.

Conflicts (`POST /profile/conflicts`):
- The agent reports a contradiction between a stored value and something the user said. The stored value is left unchanged (CONF-2), and the conflict is saved with a snapshot of the stored values, the new information and the user's words.
- Reporting the same contradiction again returns the open conflict without creating a duplicate, so a retried turn is harmless.
- Reporting against an empty field is rejected (422), since nothing is contradicted.

Resolution (`POST /profile/conflicts/{id}`):
- `keep` closes the conflict and leaves the value as it is.
- `replace` sets the field to the submitted value(s), possibly none, and closes the conflict.
- A clarification ("the steakhouse is for my partner") becomes `keep` plus a separate `add` to another field.

**The trade-off.** CONF-2 ("never silently overwrite") now depends on the model following the guide: change a value only when the user says so, otherwise report a conflict. There is no backend safety net if the model wrongly treats a hint as a statement. Mistakes are still visible, though. Every change appears in the chat as a tool call, with the user's quoted words stored as evidence.

### 3.5 Persistence (`store.js`)

- The profile and conflicts are stored in `data/profile.json`, which is gitignored.
- Saves write a temporary file and rename it over the real one, so a crash can't leave a half-written file (PROF-4, UC-29).
- Writes are queued in-process so each one sees the previous one's result. There is a single process and a single user (PERS-2), so no further locking is needed.
- On startup the file is validated. If it is missing, the service starts empty. If it is corrupt, the file is moved aside, the problem is logged, and the service starts empty.

## 4. The HTML contract

`contract.js` defines the contract as data and `html.js` holds all the markup. The README documents it for reviewers. The markup follows these conventions:

- **Everything a consumer needs is inside `<main>`.** The `<nav>` is for people browsing the service. The frontend passes only `<main>` to the LLM, to save tokens.
- **Stable `id`s** identify sections and forms: `#result`, `#profile`, `#conflicts`, `#destination`, `#update-profile`, `#report-conflict`, `#reset-profile`, `#lookup-destination`.
- **`#result[data-outcome]`** says what a request did: `applied`, `unchanged`, `reported`, `resolved`, `forbidden`, `reset`, `invalid`, `not-found`, `found` or `error`.
- **`[data-field]`** marks a field. Profile fields also carry `data-kind` (`list` or `single`) and, when empty, `data-empty`.
- **`<data value="…">`** holds machine-readable values. Its text content is the human-readable form.
- **Conflicts** are `<article data-conflict="{id}" data-field="{field}">`, with their parts marked by `data-role`: `existing`, `new-information`, `evidence`.
- **Forms define the writes.** The `action` attribute and the input `name`s are the request contract.

We chose `data-*` attributes over microdata because they map directly onto `querySelector` and don't need microdata's nested-scope rules.

Illustrative fragment (the response to a reported conflict):

```html
<main>
<section id="result" data-outcome="reported">
<p>Recorded conflict c1: Dietary restrictions is currently "vegetarian", which contradicts this new
information: wants to book a famous steakhouse. The stored value is unchanged. Ask the user which is
right, then resolve conflict c1.</p>
</section>
<section id="profile">
<h1>Travel profile</h1>
<dl>
<dt>Interests</dt>
<dd data-field="interests" data-kind="list"><ul>
<li><data value="hiking">hiking</data> <small>(user said: <q>I love hiking</q>)</small></li>
</ul></dd>
<dt>Dietary restrictions</dt>
<dd data-field="dietaryRestrictions" data-kind="list"><ul>
<li><data value="vegetarian">vegetarian</data> <small>(user said: <q>I'm vegetarian</q>)</small></li>
</ul></dd>
…
</dl>
</section>
<section id="conflicts">
<h2>Open conflicts</h2>
<article id="conflict-c1" data-conflict="c1" data-field="dietaryRestrictions">
<h3>Conflict c1: Dietary restrictions</h3>
<p>Stored: <data data-role="existing" value="vegetarian">vegetarian</data></p>
<p>New information: <q data-role="new-information">wants to book a famous steakhouse</q></p>
<p>User said: <q data-role="evidence">we have to try that famous steakhouse</q></p>
<form method="post" action="/profile/conflicts/c1">…</form>
</article>
</section>
<section id="profile-actions">
<form id="update-profile" method="post" action="/profile">…</form>
…
</section>
</main>
```

- **For React:** the parser reads the `id`s, `data-*` attributes and `<data>` values, and validates the result. If expected elements are missing or malformed, the panel shows an error state and does not render partial data.
- **For the LLM:** the prose in `#result` and in conflict entries is written for the model to act on. A 404 from a destination lookup says plainly *"No information available for X"*, which leaves the model nothing to fill in (DEST-5).

## 5. Frontend

### 5.1 Structure

One file, `frontend/index.html`, with these internal sections:

- **Config:** the backend URL (`http://localhost:3000`) and the default OpenRouter model.
- **Contract parser:** HTML string → validated profile, conflicts and result. This is the only code that knows the markup.
- **Backend client:** `fetch` wrappers that return `{ status, html, parsed }`.
- **LLM client:** a streaming chat-completions call to OpenRouter that reads SSE and accumulates text and tool-call deltas.
- **Agent loop:** the system prompt, tool definitions and tool execution.
- **UI:** React with `htm` templates. Chat on the left, profile panel on the right (D3), and a settings form for the API key and model.

### 5.2 Tools exposed to the LLM

The model gets two generic tools. It uses the service the way a person uses it in a browser:

| Tool | What it does |
|---|---|
| `getPage(path)` | `GET` a page: read the profile, follow links, look up a destination (`/destinations?name=Lisbon`). A `method="get"` form becomes a query string. |
| `submitForm(action, fields)` | `POST` a form's fields to its `action`. An array value becomes a repeated input. |

- **The HTML says what is possible.** The links and forms on each page tell the model what it can do, so the frontend holds no knowledge of profiles, conflicts or destinations. Backend capabilities can change without touching the tool definitions.
- **Arguments are paths, never URLs.** The frontend resolves them against `BACKEND_URL` and refuses anything that would leave the service (absolute URLs, `//host`, backslash tricks) before any request is made.
- **Each call carries `X-Client: agent`**, so the backend applies agent policy (§3.3).
- **Tool results** are `HTTP {status}` plus the response's `<main>` HTML. The model can tell found, reported, not-found and invalid apart from the status and `#result[data-outcome]`. Bad arguments and network failures come back as `Error: …` text the model can act on.
- **`getDestinationInfo`.** The assignment's function is not a tool name. Every `GET /destinations?name=…` calls `getDestinationInfo()` in the backend, and each lookup shows in the chat and the logs.

### 5.3 A conversation turn

1. The user sends a message. The input is disabled until the turn ends (CHAT-6).
2. The frontend fetches the home page (`GET /`) as the agent. The system prompt is a short preamble plus that page's `<main>` HTML. The home page carries **all the rules**: interview style, how to use the service, recording only stated preferences with evidence, conflict handling and destination lookups (`backend/guide.js`). Behavior is defined in one place, and anyone can read it in a browser.
3. It streams a completion from OpenRouter, rendering text tokens as they arrive (CHAT-3). Tool calls arrive in fragments and are assembled.
4. If the model called tools, each one runs against the backend in order. It is shown in the chat with its method, path, fields and result while the agent works, and the rows fade out once the reply is complete (they stay after an error or Stop). Every call is also logged to the console. Any response containing `#profile` is parsed and **pushed to the panel immediately** (VIEW-5). The results go back to the model and the next completion streams. There are at most 8 rounds per turn.
5. The turn ends when a completion finishes with no tool calls.

Later turns replay earlier completed turns in full, tool calls and results included, so the model keeps what it learned (UC-19). A stopped turn contributes only its visible text, and a failed turn is left out. Retrying a failed turn repeats its writes, which is safe because the backend treats a repeated add as unchanged and returns the existing conflict for a repeated contradiction.

### 5.4 Frontend state

| State | Where |
|---|---|
| API key and model | `localStorage`, entered in the settings form. Never sent anywhere except OpenRouter. |
| Chat transcript | In memory only for now. A reload starts a new conversation; the profile itself persists in the backend. |
| Profile and conflicts | Not stored. Always re-read from the backend. |

## 6. Failure handling

| Failure | Behavior |
|---|---|
| No API key | The settings form is shown and the chat input is disabled. |
| OpenRouter returns 401 or 403 | "Invalid API key" with a link to the settings. The user's message is kept (UC-28). |
| OpenRouter returns 429 or 5xx, or the network fails | An inline error with a Retry button. The message is kept. |
| The stream breaks partway | The partial reply is marked incomplete and the input is enabled again (UC-29). Changes already applied stay; each one was a complete, atomic backend write. |
| The model sends malformed tool arguments | The frontend returns a tool error to the model and does not call the backend. |
| The backend rejects input | It returns 422 HTML explaining why. The model sees it and can correct itself, and the profile is unchanged (UC-30). |
| The backend is unreachable | The panel shows "Profile service not reachable at localhost:3000". Tool calls return an explicit error so the model doesn't make up data. |
| The backend's HTML doesn't match the contract | The panel shows a contract error. The last good state is kept. |

**Logging (nice-to-have).** The backend writes one JSON line to stdout per request (method, path, status, latency, request ID). The frontend logs one JSON entry to the console per LLM call (model, latency, token usage from OpenRouter, request ID) and per tool call.

## 7. Running it

```
node backend/server.js      # Node ≥ 22, no npm install needed (or: npm start)
open frontend/index.html    # then paste an OpenRouter key into Settings
npm test                    # targeted tests (node:test)
```

## 8. Trade-offs and risks

- **An HTML contract instead of JSON.** One representation works for a person in a browser, for the UI, and for the LLM, which removes any gap between what the model sees and what the user sees. The cost is that parsing is less direct than `JSON.parse`, and the markup needs discipline. This is mitigated by keeping all the markup in `html.js` and all the parsing in one frontend parser.
- **The API key lives in the browser.** Fine for a local, single-user tool, with nothing secret in the repo or the backend. A real product would route model calls through a server.
- **Native tool calling depends on the model.** Free OpenRouter models are inconsistent at calling tools, and the model may skip `getDestinationInfo`. Mitigations: strict prompt rules, validating tool arguments, and a recommended default model known to call tools reliably. Possible extra safeguard: the app spots known destination names in the user's message and pre-fetches them.
- **Conflict detection depends on the LLM.** The backend records conflicts but doesn't detect them (§3.4). Detection depends on the model reading `/profile` before it changes anything, which the guide requires at the start of every turn.
- **CDN dependencies at runtime.** React and `htm` load from esm.sh at pinned versions. The frontend needs network access for OpenRouter anyway.
- **No styling on backend pages.** On purpose: they are a data interface. All presentation is in the frontend.
