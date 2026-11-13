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
| No build step, minimal dependencies | The backend runs TypeScript with Node's built-in type stripping (Node ≥ 22.18) and has **zero npm dependencies**: `node:http`, `node:fs`, `node:test`. The frontend loads React and [`htm`](https://github.com/developit/htm) from a CDN at pinned versions, so templates need no compile step. |
| Frontend is opened from `file://` | Its origin is `null`, so the backend sends `Access-Control-Allow-Origin: *`. Writes are form-encoded POSTs with no custom headers, which are "simple" requests and need no CORS preflight. |
| `file://` can't load local modules | The frontend is **one self-contained file** with inline `<script type="module">` and `<style>`. Imports from `https://` CDNs still work. |
| No code is shared between the two sides | The typed contract is the **HTML structure itself** (§4). The backend defines it in one module, and the frontend validates what it parses. |
| Type stripping, not compilation | Only erasable TypeScript: no `enum`, no parameter properties, `import type` for type-only imports, `.ts` extensions in import paths. Types are checked by the editor or an optional `npx tsc --noEmit`, never at runtime. Runtime validation is done explicitly at the boundaries. |

## 3. Backend

### 3.1 Module layout

```
backend/
  server.ts         transport: routing, CORS, form-body parsing, status codes, logging
  profile.ts        domain: field schema, applying updates, conflict rules, resolution
  destinations.ts   getDestinationInfo() and the hardcoded destination data
  store.ts          persistence: load/validate/save the JSON file atomically
  html.ts           rendering: domain objects → contract HTML (the contract lives here)
  *.test.ts         node:test tests for profile rules, destinations, form parsing, rendering
data/
  profile.json      runtime state (gitignored)
```

Dependencies point one way: `server` → `profile` / `destinations` / `store` / `html`. `profile.ts` has no I/O, so the conflict rules can be tested in isolation.

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
| `POST /profile` | Apply one change: `field`, `op` (`add`, `remove` or `set`), `value`, `evidence` | 200 applied · 409 conflict recorded · 422 invalid |
| `POST /profile/conflicts` | Report a semantic contradiction: `field`, `newInformation`, `evidence` | 201 · 422 |
| `POST /profile/conflicts/{id}` | Resolve a conflict: `resolution` (`keep` or `replace`), plus `value` for `replace` | 200 · 404 · 422 |
| `POST /profile/reset` | Clear the profile and conflicts (for testing and demos) | 200 |
| `GET /destinations` | List the known destinations, with a lookup form | 200 |
| `GET /destinations?name=…` | `getDestinationInfo(name)`. Matching ignores case and surrounding whitespace. | 200 found · 404 not found |

Every write responds with the updated profile page plus a **result section** saying what happened. A caller always gets the current state back and never needs a second `GET`.

### 3.4 Conflict rules (`profile.ts`)

Conflict handling lives in one module and has two detection paths that feed a single conflict store:

1. **Structural (deterministic, in the backend).**
   - `add` to a list: applied. Adding is never a conflict (UC-10).
   - `set` on an empty single-value field: applied.
   - `set` that differs from the stored value, or `remove` of a stored value: **not applied**. A conflict is recorded holding the existing value, the proposed value and the evidence. Response: 409.
2. **Semantic (LLM-reported).** The backend can't know that "steakhouse" contradicts "vegetarian". The LLM reports that kind of contradiction through `POST /profile/conflicts`. It is stored and shown exactly like a structural conflict.

Resolution:
- `keep` closes the conflict and leaves the value as it is.
- `replace` sets the field to `value` and closes the conflict.
- A clarification ("the steakhouse is for my partner") becomes `keep` plus a separate `add` to another field.

Explicit corrections (CONF-6) are **not** a shortcut. They go through the conflict path and get resolved on the user's next message. UC-27 explicitly allows this.

### 3.5 Persistence (`store.ts`)

- The profile and conflicts are stored in `data/profile.json`, which is gitignored.
- Saves write a temporary file and rename it over the real one, so a crash can't leave a half-written file (PROF-4, UC-29).
- Requests are handled one at a time in a single process, and there is a single user (PERS-2), so no locking is needed.
- On startup the file is validated. If it is missing, the service starts empty. If it is corrupt, the file is moved aside, the problem is logged, and the service starts empty.

## 4. The HTML contract

`html.ts` is the single source of truth. The README documents it for reviewers. The markup follows these conventions:

- **Microdata** marks the data: `itemscope` marks an entity and `itemprop` marks a field.
- **`<data value="…">`** holds machine-readable values. Its text content is the human-readable form.
- **Stable `id`s** identify sections and forms: `#profile`, `#conflicts`, `#result`, `#update-profile`.
- **Forms define the writes.** The `action` attribute and the input `name`s are the request contract.
- **The response is only the `<main>` content**, with no page chrome, to save tokens.

Illustrative fragment:

```html
<main>
  <section id="result" data-status="conflict">
    <p>Not applied: dietaryRestrictions already contains "vegetarian".
       Recorded as conflict c1. Ask the user how to resolve it.</p>
  </section>

  <section id="profile" itemscope>
    <h1>Travel profile</h1>
    <dl>
      <dt>Interests</dt>
      <dd itemprop="interests"><ul><li><data value="hiking">hiking</data></li></ul></dd>
      <dt>Home base</dt>
      <dd itemprop="homeBase" data-empty>Not specified</dd>
    </dl>
  </section>

  <section id="conflicts">
    <h2>Open conflicts</h2>
    <article id="conflict-c1" itemscope>
      <p><data itemprop="field" value="dietaryRestrictions">Dietary restrictions</data>:
         stored <data itemprop="existing" value="vegetarian">vegetarian</data>, but
         <q itemprop="newInformation">wants to find a great steakhouse</q>.</p>
      <form method="post" action="/profile/conflicts/c1">…</form>
    </article>
  </section>

  <form id="update-profile" method="post" action="/profile">…</form>
</main>
```

- **For React:** the parser reads `itemprop`/`data` and validates the result. If expected elements are missing or malformed, the panel shows an error state and does not render partial data.
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

| Tool | Backend call |
|---|---|
| `getDestinationInfo(name)` | `GET /destinations?name=…` |
| `updateProfile(field, op, value, evidence)` | `POST /profile` |
| `reportConflict(field, newInformation, evidence)` | `POST /profile/conflicts` |
| `resolveConflict(id, resolution, value?)` | `POST /profile/conflicts/{id}` |

Each tool result is the HTTP status line plus the `<main>` HTML. The model can therefore tell "not found" (404), "conflict" (409) and "invalid" (422) apart.

### 5.3 A conversation turn

1. The user sends a message. The input is disabled until the turn ends (CHAT-6).
2. The frontend fetches `GET /profile` and puts that HTML in the system prompt, along with the interviewing rules (D2), the destination rule (always call `getDestinationInfo` for a named place and use only its result), and the conflict rule.
3. It streams a completion from OpenRouter, rendering text tokens as they arrive (CHAT-3).
4. When the model calls tools, the frontend runs each one against the backend, **updates React state from the parsed response** (so the panel changes mid-turn, VIEW-5), and adds the HTML to the conversation as the tool result. Then it streams the next completion. There are at most 5 tool rounds per turn.
5. The turn ends when a completion finishes with no tool calls.

### 5.4 Frontend state

| State | Where |
|---|---|
| API key and model | `localStorage`, entered in the settings form. Never sent anywhere except OpenRouter. |
| Chat transcript | `localStorage`, so the conversation survives a reload. A "New conversation" action clears it. |
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
node backend/server.ts      # Node ≥ 22.18, no npm install needed
open frontend/index.html    # then paste an OpenRouter key into Settings
node --test backend/        # targeted tests
```

## 8. Trade-offs and risks

- **An HTML contract instead of JSON.** One representation works for a person in a browser, for the UI, and for the LLM, which removes any gap between what the model sees and what the user sees. The cost is that parsing is less direct than `JSON.parse`, and the markup needs discipline. This is mitigated by keeping all the markup in `html.ts` and all the parsing in one frontend parser.
- **The API key lives in the browser.** Fine for a local, single-user tool, with nothing secret in the repo or the backend. A real product would route model calls through a server.
- **Native tool calling depends on the model.** Free OpenRouter models are inconsistent at calling tools, and the model may skip `getDestinationInfo`. Mitigations: strict prompt rules, validating tool arguments, and a recommended default model known to call tools reliably. Possible extra safeguard: the app spots known destination names in the user's message and pre-fetches them.
- **Semantic conflict detection depends on the LLM.** Structural conflicts are deterministic. Semantic ones depend on the model noticing them, which is why the current profile is in every system prompt.
- **CDN dependencies at runtime.** React and `htm` load from esm.sh at pinned versions. The frontend needs network access for OpenRouter anyway.
- **No styling on backend pages.** On purpose: they are a data interface. All presentation is in the frontend.
