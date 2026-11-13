# Profile Builder — Product Decisions

These resolve the open decisions in [REQUIREMENTS.md §8](REQUIREMENTS.md#8-open-decisions).

## D1. Profile fields

The profile holds three groups of fields:

| Group | Fields |
|-------|--------|
| **Interests** | What the traveler enjoys (e.g. food, hiking, architecture) |
| **Dietary & accessibility** | Dietary restrictions; mobility or accessibility needs |
| **Logistics & companions** | Who they travel with; accommodation preference; transport preference; home airport or city; passport country |

**Rationale**
- Interests map directly onto the destination `knownFor` data, so the assistant can relate each destination to the user.
- Dietary and accessibility needs are durable, high-stakes preferences, and they're the most likely to produce conflicts (e.g. vegetarian vs. steakhouse).
- Logistics and companions explain apparent contradictions ("the steakhouse is for my partner"). Passport country is what makes destination visa notes relevant.

**Excluded:** the trip style & budget group (budget tier, pace, preferred seasons, trip length). The trade-off: budget and season are what map onto the destination data's `averageDailyBudgetUSD` and `bestSeasons`, so follow-up questions will draw less on those fields.

## D2. Assistant proactivity: guided interview

The assistant runs a guided interview. It asks one or two focused questions at a time, aimed at fields that are still missing, while following the user's lead when they bring up something else. It does not draft a profile from guesses, because that would risk recording preferences the user never stated (PROF-3).

## D3. Layout: right side panel

The chat sits on the left and the profile view is always visible in a panel on the right. That way profile changes and conflict flags show up as the user chats (VIEW-4, VIEW-5).

## D4. Conflicts: raised in chat, flagged in the panel

When new input contradicts an existing field:

1. The existing value is **not** overwritten (CONF-2).
2. The assistant raises the contradiction in chat and asks the user to clarify (CONF-3).
3. The panel marks the field as conflicted and shows the existing value alongside the new information.
4. The user resolves it by replying in chat: keep the existing value, accept the new one, or give a clarification (CONF-4).
5. On resolution, the profile reflects the user's decision and the flag is cleared (CONF-5).
6. Unresolved conflicts persist across reloads (PERS-3).

**Rationale:** resolving through the conversation keeps the profile view read-only (VIEW-6), and it allows nuanced answers that Keep/Replace buttons can't express. The panel flag means a conflict can't slip by unnoticed if the user ignores the question in chat.

**What counts as a conflict** (refined during implementation): a conflict is something the user said that contradicts a stored value *without* the user saying that value is wrong, for example a steakhouse when the profile says vegetarian. When the user explicitly changes or retracts a preference ("I moved to Chicago", "remove my dogs", "clear my preferences"), that is the user deciding, and it is applied directly. Only the LLM can tell the two apart, so the assistant detects conflicts and the backend records and tracks them. See [ARCHITECTURE.md §3.4](ARCHITECTURE.md#34-conflicts-profilejs).
