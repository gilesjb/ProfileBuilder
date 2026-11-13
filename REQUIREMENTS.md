# Profile Builder — Functional Requirements

Profile Builder is a single-page web app that helps a traveler build a lasting travel profile by chatting with an assistant. This document covers **what** the application must do. It does not cover how it is built.

Requirement IDs are prefixed by area. **Must** means required. **Should** means a nice-to-have, built only if time allows.

## 1. Conversation

| ID | Requirement | Priority |
|----|-------------|----------|
| CHAT-1 | The user can send free-text messages about their travel preferences to an assistant. | Must |
| CHAT-2 | The assistant replies conversationally to every user message. | Must |
| CHAT-3 | Assistant replies stream: text appears in the UI as it is generated, not all at once when the reply ends. | Must |
| CHAT-4 | The conversation shows user and assistant messages in order, and the two are visually distinct. | Must |
| CHAT-5 | The assistant asks follow-up questions that help fill in the travel profile. | Must |
| CHAT-6 | The user cannot send a new message while an assistant reply is still streaming, or the app handles that case clearly. | Must |
| CHAT-7 | If the assistant cannot respond (e.g. the language model is unavailable, misconfigured, or returns an error), the user sees a clear error message. Their message and the earlier conversation are kept. | Must |

## 2. Profile extraction

| ID | Requirement | Priority |
|----|-------------|----------|
| PROF-1 | The app extracts structured travel-preference fields from the conversation as it goes. | Must |
| PROF-2 | The profile is a defined set of fields. Each field has a known meaning and a known type of value. *(The exact fields are a design decision recorded elsewhere.)* | Must |
| PROF-3 | Fields are added or updated only from what the user actually said. The assistant does not invent preferences the user never stated. | Must |
| PROF-4 | If the model returns malformed or invalid extraction output, the stored profile is not corrupted. Invalid data is discarded. | Must |
| PROF-5 | When the user explicitly corrects a preference ("actually, I prefer trains"), the profile is updated to match. | Should |

## 3. Profile view

| ID | Requirement | Priority |
|----|-------------|----------|
| VIEW-1 | The app includes a read-only view of the traveler's current preferences, as a regular part of the app (not a debug route). | Must |
| VIEW-2 | The view shows every populated field in a human-readable form. | Must |
| VIEW-3 | The view makes it clear when the profile is empty or a field has no value yet. | Must |
| VIEW-4 | The view updates as soon as the profile changes, at least by the end of each assistant turn. | Must |
| VIEW-5 | The view updates during a turn, as fields are extracted, without waiting for the reply to finish. | Should |
| VIEW-6 | The user cannot edit the profile directly in the view. Changes happen only through the conversation. | Must |

## 4. Persistence

| ID | Requirement | Priority |
|----|-------------|----------|
| PERS-1 | The profile survives a page reload and is shown again after the reload. | Must |
| PERS-2 | The app supports exactly one user and one profile. There is no sign-in or account selection. | Must |
| PERS-3 | Unresolved profile conflicts (see §6) are not lost on reload. Either they persist, or the conversation re-raises them. | Should |

## 5. Destination information

| ID | Requirement | Priority |
|----|-------------|----------|
| DEST-1 | Whenever the conversation mentions a specific destination, the app looks it up in its destination information source. | Must |
| DEST-2 | For each known destination, the source provides: name, best seasons (spring/summer/fall/winter), what it is known for, average daily budget in USD at budget, mid-range, and luxury levels, and optional visa notes. | Must |
| DEST-3 | The source covers at least 5 destinations. | Must |
| DEST-4 | When a lookup finds the destination, the assistant uses that information to ask informed follow-up questions. For example, it relates best seasons to the user's travel dates, budget levels to the user's budget, or "known for" to the user's interests. | Must |
| DEST-5 | When a lookup finds nothing, the assistant says it has no information on that destination. It does not make up facts about it, and the conversation carries on. | Must |
| DEST-6 | The destination information source is the only source of destination facts the assistant presents. | Must |

## 6. Conflict detection

| ID | Requirement | Priority |
|----|-------------|----------|
| CONF-1 | The app detects when new conversation contradicts a field already in the profile. Example: the profile says "vegetarian" and the user now mentions wanting a steakhouse. | Must |
| CONF-2 | A detected contradiction never silently overwrites the existing value. | Must |
| CONF-3 | Every detected contradiction is shown to the user, along with both the existing value and the new, conflicting information. | Must |
| CONF-4 | The user can resolve a conflict: keep the existing value, accept the new one, or clarify (e.g. "vegetarian, but my partner eats meat"). | Must |
| CONF-5 | Once the user resolves a conflict, the profile reflects their decision and the conflict stops being flagged. | Must |
| CONF-6 | An explicit, unambiguous correction from the user (see PROF-5) can be applied without being treated as a conflict. | Should |

## 7. Out of scope

The following are explicitly not required:

- Authentication, accounts, or multiple users
- Real travel data or third-party travel services
- Mobile or responsive layouts (desktop only; the layout just must not break at smaller widths)
- Bookings, payments, sharing, or search history
- Editing the profile directly outside the conversation

## 8. Open decisions

The assignment leaves these to the implementer. They are resolved in [DECISIONS.md](DECISIONS.md):

- Which fields make up the travel profile, and why.
- How proactive the assistant is: interviewing the user, or drafting a profile and asking for corrections.
- Where the profile view sits in the layout.
- Exactly how conflicts are surfaced and resolved (in the chat, flagged in the view, or both).
