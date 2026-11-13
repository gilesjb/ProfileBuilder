# Profile Builder

A single-page app that builds a traveler's lasting travel profile through conversation. You chat with an assistant. It records your preferences as structured fields, looks up the destinations you mention, and raises contradictions with you instead of silently overwriting what it already knows.

```
┌──────────────── frontend/index.html (opened from disk) ───────────────┐
│  Chat (streaming)                         │  Travel profile (live)    │
│  ── tool calls shown while the agent works│  values · conflicts       │
└──────────────┬────────────────────────────┴──────────────┬────────────┘
               │ SSE                                       │ fetch (HTML)
        OpenRouter API                       Profile service (Node, :3000)
        (your API key)                       profile · conflicts · destinations
```

## Run it (about 2 minutes)

You need **Node ≥ 22**, Chrome or Firefox, and an [OpenRouter API key](https://openrouter.ai/keys).

```sh
git clone <this repo> && cd profile-builder
npm start                  # profile service on http://localhost:3000 (no npm install: zero dependencies)
open frontend/index.html   # or double-click it; it runs straight from disk
```

Paste your OpenRouter key into the setup card and start chatting. You can try things like:

- "I'm vegetarian, I travel with my partner, and we're thinking about Lisbon."
- "What about Ulaanbaatar?" (not in the dataset)
- "We have to try a famous steakhouse." (contradicts "vegetarian")

Other commands:

```sh
npm test                   # 38 backend tests (node:test), < 1 s
```

To reset the profile, open http://localhost:3000/profile and use **Clear profile and conflicts**. The assistant itself is not allowed to do this.

### Configuration

| Setting | Where | Default |
|---|---|---|
| OpenRouter API key | Settings (gear icon), stored in the browser's `localStorage` | none, so the app asks for it |
| Model | Settings: any OpenRouter model ID | `anthropic/claude-haiku-5.5` |
| Service port | `PORT` env var | `3000` (if you change it, also change `BACKEND_URL` at the top of `frontend/index.html`) |
| Data file | `DATA_FILE` env var | `data/profile.json` (gitignored) |

**No environment variables are needed for the LLM.** The browser calls OpenRouter directly with the key you enter. The key is never written to the repo, a `.env` file or the backend. It is sent only to OpenRouter.

### Provider and model

I chose **OpenRouter** so any model can be swapped in from Settings without code changes, and because it accepts direct calls from a browser. The default is **Claude Haiku 5.5** (`$0.10 / $0.50` per million input/output tokens at the time of writing), picked for reliable tool calling at low cost. A full demo conversation costs a few cents. Free OpenRouter models also work, but they skip or garble tool calls more often, which shows up as missed destination lookups or 422s the model has to recover from.

### When credentials or services fail

Each failure gets its own message. Your message stays in the chat, and failed replies are left out of what's sent on retry.

| Situation | What you see |
|---|---|
| No key yet | A setup card in place of the chat |
| Invalid key (401) | "OpenRouter rejected your API key", with **Retry** and **Open settings** |
| Out of credits (402) | "Your OpenRouter account is out of credits" |
| Unknown model ID, or input flagged (400/403) | "OpenRouter rejected the request", plus OpenRouter's reason |
| Rate limited (429) / provider down (5xx) / offline | A specific message, with **Retry** |
| Stream drops partway | The partial reply is kept and marked incomplete, with **Retry** |
| Profile service not running | Chat: "Can't reach the profile service… start it with npm start". Panel: the same, keeping the last profile that loaded |

## How it works

The unusual part: **the backend's API is HTML.** The Node service serves plain, unstyled HTML pages with links and forms, and no JavaScript or CSS. You can use it directly in a browser. The frontend has two consumers of that same HTML:

1. **React** parses it with `DOMParser` and uses it as its data model for the profile panel.
2. **The LLM** reads it as the result of its tool calls.

One response feeds both, so the model and the UI can't disagree about the profile.

The model has two generic tools, `getPage(path)` and `submitForm(action, fields)`, and uses the service the way a person would in a browser. The links and forms tell it what it can do. The rules it must follow are served on the service's home page (`backend/guide.js`), and that page is the system prompt. All assistant behavior is therefore defined in one file in the service that owns the data, readable at http://localhost:3000/.

A turn goes like this:

1. Fetch the home page as the system prompt.
2. Stream a completion.
3. Run any tool calls against the service.
4. Push any returned profile straight to the panel, so it updates mid-turn.
5. Feed the results back to the model, and repeat until it answers without tools (at most 8 rounds).

### The destination tool

The assignment's `getDestinationInfo(name): Promise<DestinationInfo | null>` is implemented in `backend/destinations.js` with six destinations: Lisbon, Kyoto, Mexico City, Marrakech, Reykjavik and Cape Town. **It isn't exposed as a tool name.** Instead, the model calls `getPage('/destinations?name=Lisbon')`, and that route calls `getDestinationInfo()`. You can see this in the chat while the agent works, in the browser console (`tool.call` log lines) and in the service's stdout (`GET /destinations` requests from `client: agent`).

- **Unknown names** (`null`) return a 404 page that plainly says *"No information available for X"* and lists the known destinations. The guide forbids stating facts from the model's own knowledge.
- **Matching** ignores case, accents and extra whitespace, and accepts a few aliases (Lisboa, CDMX, Reykjavík).
- **Three extra fields** go beyond the assignment's schema: `country`, `dietaryNotes` and `accessibilityNotes`. They let the assistant connect a place to the profile, for example "Lisbon is very hilly, and you mentioned stairs are hard".

### The contract

Client and server share no code, because the frontend can't import modules from `file://`. The contract is the HTML structure. It is defined in one place and validated on both sides:

- **`backend/contract.js`** defines the contract as data: fields and their kinds, ops, resolutions, routes, limits, outcome→status mapping. It also holds the parsers that validate every form submission (422 with specific errors).
- **`backend/html.js`** holds all the markup. Its header documents the conventions: stable `id`s, `#result[data-outcome]`, `[data-field]`, `<data value>`, `[data-role]`.
- **`parseProfilePage()` in `frontend/index.html`** is the only frontend code that knows the markup. It throws instead of rendering partial data.

Other boundaries are validated too: stored data is checked on load (a corrupt file is moved aside), tool arguments are checked before any request, and LLM stream chunks are parsed defensively.

### Conflicts

**The LLM detects contradictions, and the backend keeps them.** Only the model can tell that "a steakhouse" contradicts "vegetarian", or that a new home city is a move rather than a mistake.

- **Explicit changes are applied.** "I moved to Chicago" or "remove my dogs" are submitted directly.
- **Hints are reported.** "We have to try that steakhouse" goes to `POST /profile/conflicts`, and the stored value stays unchanged.
- **The backend tracks conflicts.** It persists them (they survive a reload), drops duplicates (so retried turns are harmless), and closes them when they're resolved or when the value they refer to is replaced or removed.
- **The user sees them.** The panel flags the field and shows both sides. The assistant asks you about it in chat, and you resolve it by answering, with keep, replace or a clarification.

All of this logic is in `backend/profile.js`, plus the "Contradictions" rules in `backend/guide.js`.

## Decisions and trade-offs

| Decision | Why | Cost |
|---|---|---|
| **HTML as the API** | One representation for a person, the UI and the LLM, with no gap between what the model sees and what you see. The service is usable and debuggable in a plain browser. | Parsing HTML is less direct than `JSON.parse`, and the markup needs discipline. Mitigated by keeping all markup in one module and all parsing in one function. |
| **No build, no dependencies** | `npm start` and open a file. The backend uses only Node built-ins; the frontend loads React and `htm` from a CDN at pinned versions. | Plain JS with JSDoc and `// @ts-check` instead of TypeScript, so the types are checked in the editor, not in CI. The frontend needs network access for the CDN, which it needs for OpenRouter anyway. |
| **Frontend opened from `file://`** | Nothing to serve. | One self-contained file, since `file://` can't load local modules. The backend must send CORS headers for origin `null`. |
| **API key in the browser** | No secrets in the repo or the backend, and nothing to configure. | Fine for a local, single-user tool. A real product would proxy model calls through a server. |
| **Generic `getPage` / `submitForm` tools** | The backend decides what's possible. Its capabilities can change without touching tool schemas, and the tools can't drift from the contract. | Tool calls are more verbose, and `getDestinationInfo` isn't a visible tool name (see above). |
| **Rules served by the backend** | Behavior lives next to the data it governs and can be read in a browser. | The service owns chat-style policy (interview tone, plain text), which arguably belongs to the frontend. |
| **The LLM detects conflicts** | My first version had the backend flag any removal, or a changed single value, as a conflict. That flagged real updates ("I moved") and made "clear my preferences" produce 13 conflicts. | "Never silently overwrite" now depends on the model following the guide, with no backend safety net. Every change still has the user's quoted words stored as evidence and is logged. |
| **`X-Client: agent` header** | Lets the backend apply agent policy: the agent can't reset the profile (403) and isn't shown the reset form. The frontend sets it, so the model can't leave it off. | It's a declaration, not authentication. I tried `User-Agent` first, but Chrome silently drops it from `fetch`. The custom header also means preflight requests, which the browser caches for 10 minutes. |
| **Profile fields** | Interests, dietary and accessibility needs, companions, accommodation, transport, home base and passport country. These are durable, they connect to the destination data, and they're where contradictions show up. | Budget and travel style are left out (a product decision, see `DECISIONS.md`). The assistant uses them in conversation but doesn't store them, even though they'd connect to `averageDailyBudgetUSD` and `bestSeasons`. |

More detail: [`REQUIREMENTS.md`](REQUIREMENTS.md) (what), [`DECISIONS.md`](DECISIONS.md) (product choices), [`ARCHITECTURE.md`](ARCHITECTURE.md) (how), [`USE_CASES.md`](USE_CASES.md) (expected behavior and test plan).

## Repository layout

```
backend/
  server.js         transport: routing, CORS, form parsing, status codes, JSON request logs
  contract.js       the contract as data, plus form validation
  profile.js        domain: changes and conflicts (no I/O)
  guide.js          the assistant's instructions, served on the home page
  destinations.js   getDestinationInfo() and its data
  store.js          JSON file persistence with atomic writes
  html.js           all markup
  *.test.js         node:test
frontend/
  index.html        the whole frontend: contract parser, OpenRouter client, agent loop, React UI
```

## Observability

- **Backend:** one JSON line per request on stdout, with request ID, method, path, `client` (agent or browser), status and latency.
- **Frontend:** one JSON line per LLM call in the browser console (model, round, latency, OpenRouter request ID, finish reason, tool calls, token usage) and per tool call (tool, method, path, status, outcome, latency).

## Verification

- **Automated:** 38 backend tests cover the conflict rules, form validation, destination lookup, stored-state validation and HTTP behavior (status codes, CORS, preflight, agent policy).
- **End to end, scripted:** I drove headless Chrome over the DevTools Protocol against a mock OpenRouter that streams SSE, including fragmented tool calls. That covered streaming, Stop, a 401, a stream dropped partway with retry, the tool loop, the panel updating mid-turn, and the off-site path guard. These scripts aren't in the repo.
- **With the real model:** chatting, extraction and the clear/remove flow were tried by hand. *The full use-case pass in `USE_CASES.md` against the real model is still to do. See Known gaps.*

## Known gaps

- **The chat doesn't survive a reload.** The profile and open conflicts do, because the backend persists them. *Fix:* keep the transcript in `localStorage`. It's already shaped for this.
- **Destination lookups rely on the model.** If it skips calling `getPage` for a place, nothing catches it. *Fix:* app code spots known destination names in the user's message and pre-fetches them into the turn.
- **Conflict detection relies on the model** (see the trade-off above). *Fix:* an evaluation set of contradiction and non-contradiction conversations, run on every prompt or model change.
- **No frontend tests.** The parser and the agent loop were checked with the mock harness but have no automated tests. *Fix:* move the parser into a classic script that `node:test` can load with a DOM shim, and commit the mock harness.
- **Replies are plain text.** Markdown isn't rendered, and the guide asks the model not to use it.
- **Single-value fields** can't hold two values, such as a dual passport. The guide says to report that as a conflict, which is honest but clumsy.
- **The use-case pass against the real model** hasn't been done in full.

## With another day

1. **An eval harness.** Scripted conversations for each use case (destination known and unknown, each kind of conflict, corrections, out-of-scope fields), run against the real model, with assertions on tool calls and the final profile. This matters more than anything else on the list, because the most important behavior lives in the prompt.
2. Commit the mock-model browser tests, and add parser tests.
3. Chat persistence, and a "new conversation" button.
4. The destination pre-fetch safeguard.
5. Reconsider whether chat-style rules (tone, plain text) belong in the frontend, and keep only data rules in the service.
