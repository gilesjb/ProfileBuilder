# Profile Builder — Use Cases & Expected Behavior

These use cases define how Profile Builder is verified against [REQUIREMENTS.md](REQUIREMENTS.md) and [DECISIONS.md](DECISIONS.md). Each one lists the requirements it covers, the setup, the steps to perform, and what should be observed.

**Notes**
- The assistant's wording is nondeterministic, so expected behavior describes outcomes you can observe, not exact text.
- Examples use **Lisbon** as a destination in the dataset and **Ulaanbaatar** as a real place that is *not* in it. Substitute whatever the final dataset contains.
- ★ marks cases that are good candidates for automated tests (deterministic once the model is stubbed). The rest are verified manually against a real model.

---

## A. Conversation basics

### UC-01 First visit with an empty profile
**Covers:** VIEW-1, VIEW-3, D3
**Setup:** No stored profile.
**Steps:** Open the app.
**Expected:**
- The chat is on the left and the profile panel is on the right.
- The panel clearly shows that the profile is empty (not a blank area and not an error).
- The message input is ready to use.

### UC-02 Streamed assistant reply
**Covers:** CHAT-1–4, CHAT-6
**Steps:** Send "Hi, I'd like help planning my travel preferences."
**Expected:**
- The user's message appears right away.
- The assistant's reply appears gradually as it streams, not all at once at the end.
- User and assistant messages look different and stay in order.
- While the reply is streaming, the user cannot send another message, or the app handles a second message in a clear way.

### UC-03 Empty message ★
**Covers:** CHAT-1
**Steps:** Try to send an empty or whitespace-only message.
**Expected:** Nothing is sent and the assistant is not called.

### UC-04 Guided interview
**Covers:** CHAT-5, D2
**Steps:** Have a short conversation, answering whatever the assistant asks.
**Expected:**
- Each assistant turn asks at most one or two focused questions.
- The questions go after profile fields that are still empty (interests, dietary/accessibility, logistics/companions).
- Fields that are already filled in are not asked about again.
- When the user changes the subject, the assistant follows them and does not force its next question.

---

## B. Profile extraction

### UC-05 Interests
**Covers:** PROF-1, VIEW-2, VIEW-4
**Steps:** Send "I love hiking and trying street food."
**Expected:** By the end of the turn, the panel shows hiking and food under Interests.

### UC-06 Dietary and accessibility needs
**Covers:** PROF-1, VIEW-2
**Steps:** Send "I'm vegetarian, and I can't manage lots of stairs."
**Expected:** The panel shows vegetarian under dietary restrictions and a stairs/mobility limitation under accessibility needs.

### UC-07 Logistics and companions
**Covers:** PROF-1, VIEW-2
**Steps:** Send "I usually travel with my partner, prefer trains to flying, fly out of Boston, and have a US passport."
**Expected:** The panel shows the companion (partner), transport preference (trains), home city (Boston), and passport country (US).

### UC-08 No invented preferences
**Covers:** PROF-3
**Steps:**
1. Send "I'm thinking about taking a trip sometime."
2. Mention Lisbon. The assistant brings up what Lisbon is known for (e.g. food), and the user replies without agreeing to it as an interest.
**Expected:**
- Step 1 adds no fields to the profile.
- Step 2 does not add Lisbon's "known for" items as the user's interests. Only preferences the user states themselves are recorded.

### UC-09 Information outside the profile scope
**Covers:** D1 (budget/trip style excluded)
**Steps:** Send "I'm on a pretty tight budget and like a slow pace."
**Expected:**
- No budget or pace field appears in the panel, and there is no error.
- The assistant may still use this information in the conversation.

### UC-10 Adding to a field is not a conflict ★
**Covers:** PROF-1, CONF-1 (false positive)
**Setup:** Interests = hiking.
**Steps:** Send "I also enjoy museums."
**Expected:** Interests become hiking and museums. No conflict is flagged.

### UC-11 Live panel updates (Should)
**Covers:** VIEW-5
**Steps:** Send a message that contains extractable preferences.
**Expected:** The panel updates while the reply is still streaming, before the turn finishes.

### UC-12 Panel is read-only
**Covers:** VIEW-6
**Steps:** Try to interact with the values in the profile panel.
**Expected:** The panel has no controls for editing values. The profile changes only through the chat.

---

## C. Persistence

### UC-13 Profile survives a reload ★
**Covers:** PERS-1
**Setup:** Several fields are filled in (e.g. from UC-05 to UC-07).
**Steps:** Reload the page.
**Expected:** The panel shows the same values as before the reload.

### UC-14 Single user
**Covers:** PERS-2
**Steps:** Open the app in a second tab.
**Expected:** There is no sign-in or profile picker. Both tabs show the same profile.

---

## D. Destination information

### UC-15 Known destination leads to informed follow-up
**Covers:** DEST-1, DEST-2, DEST-4, DEST-6
**Setup:** Passport country = US. Interests = food.
**Steps:** Send "I'm thinking about Lisbon."
**Expected:**
- The app looks up Lisbon.
- The assistant's follow-up uses the returned data, for example the best seasons or a link between Lisbon's "known for" items and the user's interest in food.
- If visa notes exist, the assistant relates them to the user's passport country.
- Every destination fact the assistant states matches the dataset (check the reply against the data).

### UC-16 Unknown destination ★
**Covers:** DEST-5, DEST-6
**Steps:** Send "What about Ulaanbaatar?"
**Expected:**
- The app looks it up and finds nothing.
- The assistant says it has no information on that destination.
- The assistant states no seasons, budgets, visa details, or attractions for it.
- The conversation goes on, e.g. the assistant asks another question or suggests discussing a different destination.

### UC-17 Several destinations in one message
**Covers:** DEST-1
**Steps:** Send "I'm torn between Lisbon and Ulaanbaatar."
**Expected:** Both are looked up. The assistant uses the data for Lisbon and says it has no information for Ulaanbaatar.

### UC-18 Destination name casing ★
**Covers:** DEST-1
**Steps:** Send "lisbon" in lower case.
**Expected:** It is treated the same as "Lisbon". (Alternate names such as "Lisboa" are not required.)

### UC-19 Destination information stays current
**Covers:** DEST-4
**Steps:** Ask a follow-up question about Lisbon a few turns after it first came up.
**Expected:** The assistant's answer still matches the dataset. It doesn't drift or contradict what it said earlier.

### UC-20 Every destination in the dataset
**Covers:** DEST-3
**Steps:** Ask about each destination in the dataset.
**Expected:** At least 5 destinations each return data that the assistant uses.

---

## E. Conflict detection & resolution

### UC-21 Conflict is detected and surfaced
**Covers:** CONF-1, CONF-2, CONF-3, D4
**Setup:** Dietary restrictions = vegetarian.
**Steps:** Send "I'd love to find a great steakhouse there."
**Expected:**
- The dietary value stays vegetarian.
- The assistant raises the contradiction in chat and asks the user to clarify.
- The panel marks the dietary field as conflicted and shows both the existing value (vegetarian) and the new information (steakhouse).

### UC-22 Resolve by keeping the existing value
**Covers:** CONF-4, CONF-5
**Setup:** The UC-21 conflict is unresolved.
**Steps:** Reply "No, I'm still vegetarian. I just heard it's a famous spot."
**Expected:** The dietary value stays vegetarian and the conflict flag is cleared.

### UC-23 Resolve by accepting the new value
**Covers:** CONF-4, CONF-5
**Setup:** The UC-21 conflict is unresolved.
**Steps:** Reply "I actually started eating meat again."
**Expected:** The dietary value is updated (vegetarian is removed) and the conflict flag is cleared.

### UC-24 Resolve by clarifying
**Covers:** CONF-4, CONF-5
**Setup:** The UC-21 conflict is unresolved.
**Steps:** Reply "The steakhouse is for my partner; I'm still vegetarian."
**Expected:**
- The dietary value stays vegetarian and the conflict flag is cleared.
- If companions weren't recorded yet, partner may be added.

### UC-25 Ignored conflict stays flagged
**Covers:** CONF-3, D4
**Setup:** The UC-21 conflict is unresolved.
**Steps:** Talk about something unrelated (e.g. accommodation preferences).
**Expected:**
- The conflict flag stays in the panel.
- The dietary value is unchanged.
- The assistant may bring the conflict up again later.

### UC-26 Unresolved conflict survives a reload ★
**Covers:** PERS-3
**Setup:** The UC-21 conflict is unresolved.
**Steps:** Reload the page.
**Expected:** The panel still shows the conflict with both values.

### UC-27 Explicit correction (Should)
**Covers:** PROF-5, CONF-6
**Setup:** Transport preference = flying.
**Steps:** Send "Actually, scratch that, I prefer trains."
**Expected:**
- Transport preference becomes trains (flying is removed) and no conflict is flagged. The user stated the change, so nothing needs confirming.
- Silently keeping "flying" is a failure.

### UC-28 Clear everything on request
**Covers:** PROF-5, CONF-6
**Setup:** Several fields filled in.
**Steps:** Send "Please clear all my preferences."
**Expected:**
- Every value is removed and no conflicts are created. A request is not a contradiction.
- Open conflicts about the removed values are closed.
- The assistant does not reset the profile wholesale: that is refused for the agent (see UC-36).

### UC-29 Single-value update ★
**Covers:** PROF-5, CONF-1 (false positive)
**Setup:** Home base = Boston.
**Steps:** Send "We just moved to Chicago."
**Expected:** Home base becomes Chicago with no conflict. A move is an update, not a contradiction.

---

## F. Errors & robustness

### UC-30 Model unavailable or misconfigured
**Covers:** CHAT-7
**Setup:** The model credentials are missing or invalid, or the provider cannot be reached.
**Steps:** Send a message.
**Expected:**
- A clear error is shown in the chat (no endless spinner and no blank reply).
- The user's message and the earlier conversation stay visible.
- The profile is unchanged.
- The user can try again once the problem is fixed.

### UC-31 Reply fails partway through
**Covers:** CHAT-7, PROF-4
**Setup:** The stream breaks after some text has arrived.
**Steps:** Send a message.
**Expected:**
- The partial reply is clearly marked as incomplete or failed.
- The input can be used again.
- The stored profile is not corrupted and is not left half-updated.

### UC-32 Malformed extraction output ★
**Covers:** PROF-4
**Setup:** The model is stubbed to return extraction output that is malformed or fails validation.
**Steps:** Send a message.
**Expected:**
- The invalid data is thrown away and the existing profile stays as it was.
- The conversation keeps working.

### UC-33 Agent tool calls are visible while it works
**Covers:** DEST-1 (observability)
**Steps:** Send a message that mentions a destination and a preference.
**Expected:**
- While the agent works, the chat lists each tool call (getPage / submitForm with path, fields and result), including the /destinations lookup.
- The rows fade out once the reply is complete. After an error or Stop they stay.
- Every call is logged as JSON in the browser console.

### UC-34 Off-site paths are refused ★
**Covers:** security
**Setup:** The model is stubbed to call getPage with an absolute URL (e.g. https://evil.example/).
**Expected:** No request leaves the browser. The model receives an error saying the path must be on the profile service.

### UC-35 Profile service not running
**Covers:** CHAT-7
**Setup:** Stop the backend.
**Steps:** Send a message; reload the page.
**Expected:**
- The chat says it can't reach the profile service and how to start it, with Retry.
- The panel says the same and keeps the last profile that loaded.

### UC-36 The agent cannot reset the profile ★
**Covers:** PERS-1
**Steps:** POST /profile/reset with X-Client: agent.
**Expected:** 403 with outcome forbidden, the profile unchanged, and the reset form left out of pages served to the agent.

---

## Traceability

| Requirement | Use cases |
|-------------|-----------|
| CHAT-1 | UC-02, UC-03 |
| CHAT-2–4 | UC-02 |
| CHAT-5 | UC-04 |
| CHAT-6 | UC-02 |
| CHAT-7 | UC-30, UC-31, UC-35 |
| PROF-1 | UC-05–07, UC-10 |
| PROF-2 | UC-05–07, UC-09 |
| PROF-3 | UC-08 |
| PROF-4 | UC-31, UC-32 |
| PROF-5 | UC-27–29 |
| VIEW-1 | UC-01 |
| VIEW-2 | UC-05–07 |
| VIEW-3 | UC-01 |
| VIEW-4 | UC-05 |
| VIEW-5 | UC-11 |
| VIEW-6 | UC-12 |
| PERS-1 | UC-13, UC-36 |
| PERS-2 | UC-14 |
| PERS-3 | UC-26 |
| DEST-1 | UC-15, UC-17, UC-18, UC-33 |
| DEST-2 | UC-15 |
| DEST-3 | UC-20 |
| DEST-4 | UC-15, UC-19 |
| DEST-5 | UC-16, UC-17 |
| DEST-6 | UC-15, UC-16 |
| CONF-1 | UC-10, UC-21, UC-29 |
| CONF-2 | UC-21 |
| CONF-3 | UC-21, UC-25 |
| CONF-4–5 | UC-22–24 |
| CONF-6 | UC-27, UC-28 |
