// @ts-check
/**
 * Profile domain logic: applying changes, detecting and resolving conflicts.
 *
 * Pure functions with no I/O. Each takes the current state and returns
 * `{ state, outcome }`. When nothing changes (or the request is rejected) the
 * returned state is the same object that was passed in.
 */
import { FIELD_NAMES, LIMITS, PROFILE_FIELDS, normalizeText, sameText } from './contract.js';

/** @typedef {import('./contract.js').FieldName} FieldName */
/** @typedef {import('./contract.js').ProfileChange} ProfileChange */
/** @typedef {import('./contract.js').ConflictReport} ConflictReport */
/** @typedef {import('./contract.js').ConflictResolution} ConflictResolution */
/** @typedef {import('./contract.js').OutcomeKind} OutcomeKind */

/** @typedef {{ value: string, evidence: string, updatedAt: string }} ProfileValue */

/** Every field is an array; `single` fields hold at most one entry. */
/** @typedef {Record<FieldName, ProfileValue[]>} Profile */

/**
 * An open contradiction between a stored value and new information.
 * `proposed` is the change that triggered it (structural conflicts), or null
 * when the LLM reported a semantic contradiction.
 * @typedef {{
 *   id: string,
 *   field: FieldName,
 *   existing: string[],
 *   newInformation: string,
 *   evidence: string,
 *   proposed: ProfileChange | null,
 *   createdAt: string,
 * }} Conflict
 */

/** @typedef {{ profile: Profile, conflicts: Conflict[], nextConflictId: number }} State */

/** @typedef {{ kind: OutcomeKind, message: string, conflict?: Conflict }} Outcome */

/** @typedef {{ state: State, outcome: Outcome }} Transition */

/** @returns {State} */
export function emptyState() {
  const profile = /** @type {Profile} */ ({});
  for (const field of FIELD_NAMES) profile[field] = [];
  return { profile, conflicts: [], nextConflictId: 1 };
}

/**
 * Applies a change, or records a conflict if it would contradict a stored
 * value. Adding to a list never conflicts, and neither does removing a value:
 * a removal is the user retracting a preference, not new information
 * contradicting it. Replacing a stored single value with a different one
 * always conflicts (CONF-2).
 * @param {State} state
 * @param {ProfileChange} change
 * @param {Date} now
 * @returns {Transition}
 */
export function applyChange(state, change, now) {
  const { field, op, value } = change;
  const label = PROFILE_FIELDS[field].label;
  const current = state.profile[field];
  const isStored = current.some((v) => sameText(v.value, value));

  if (op === 'add') {
    if (isStored) return unchanged(state, `${label} already includes "${value}".`);
    if (current.length >= LIMITS.listLength) {
      return invalid(state, `${label} already has the maximum of ${LIMITS.listLength} values.`);
    }
    const next = withField(state, field, [...current, toValue(value, change.evidence, now)]);
    return { state: next, outcome: { kind: 'applied', message: `Added "${value}" to ${label}.` } };
  }

  if (op === 'set') {
    if (current.length === 0) {
      const next = withField(state, field, [toValue(value, change.evidence, now)]);
      return { state: next, outcome: { kind: 'applied', message: `Set ${label} to "${value}".` } };
    }
    if (isStored) return unchanged(state, `${label} is already "${value}".`);
    return recordConflict(state, field, `change to "${value}"`, change.evidence, change, now);
  }

  // op === 'remove'
  if (!isStored) return unchanged(state, `${label} does not include "${value}"; nothing to remove.`);
  const removed = withField(state, field, current.filter((v) => !sameText(v.value, value)));
  // Conflicts about the removed value have nothing left to contradict.
  const moot = removed.conflicts.filter((c) => c.field === field && c.existing.some((e) => sameText(e, value)));
  const next = { ...removed, conflicts: removed.conflicts.filter((c) => !moot.includes(c)) };
  const closed = moot.length ? ` Closed conflict${moot.length > 1 ? 's' : ''} ${moot.map((c) => c.id).join(', ')}, which depended on it.` : '';
  return { state: next, outcome: { kind: 'applied', message: `Removed "${value}" from ${label}.${closed}` } };
}

/**
 * Records a contradiction the LLM noticed but that isn't expressible as a
 * change (e.g. "wants a steakhouse" vs. a vegetarian diet).
 * @param {State} state
 * @param {ConflictReport} report
 * @param {Date} now
 * @returns {Transition}
 */
export function reportConflict(state, report, now) {
  const label = PROFILE_FIELDS[report.field].label;
  if (state.profile[report.field].length === 0) {
    return invalid(
      state,
      `${label} has no stored value, so nothing contradicts it. If this is a new preference, submit it as a profile change instead.`,
    );
  }
  return recordConflict(state, report.field, report.newInformation, report.evidence, null, now);
}

/**
 * @param {State} state
 * @param {string} id
 * @param {ConflictResolution} resolution
 * @param {Date} now
 * @returns {Transition}
 */
export function resolveConflict(state, id, resolution, now) {
  const conflict = state.conflicts.find((c) => c.id === id);
  if (!conflict) return { state, outcome: { kind: 'not-found', message: `There is no open conflict ${id}.` } };

  const { field } = conflict;
  const label = PROFILE_FIELDS[field].label;
  const evidence = resolution.evidence || conflict.evidence;
  const remaining = state.conflicts.filter((c) => c.id !== id);
  /** @param {ProfileValue[]} values @param {string} message @returns {Transition} */
  const resolved = (values, message) => ({
    state: { ...withField(state, field, values), conflicts: remaining },
    outcome: { kind: 'resolved', message: `Conflict ${id} resolved: ${message}` },
  });

  switch (resolution.resolution) {
    case 'keep':
      return resolved(state.profile[field], `kept ${label} as ${describe(state.profile[field])}.`);

    case 'accept': {
      const change = conflict.proposed;
      if (!change) {
        return invalid(state, `Conflict ${id} has no proposed change to accept; resolve it with keep or replace.`);
      }
      const values =
        change.op === 'remove'
          ? state.profile[field].filter((v) => !sameText(v.value, change.value))
          : [toValue(change.value, evidence, now)];
      return resolved(values, `${label} is now ${describe(values)}.`);
    }

    case 'replace': {
      if (PROFILE_FIELDS[field].kind === 'single' && resolution.values.length > 1) {
        return invalid(state, `${label} holds a single value; submit at most one.`);
      }
      const values = dedupe(resolution.values).map((v) => toValue(v, evidence, now));
      return resolved(values, `${label} is now ${describe(values)}.`);
    }
  }
}

/** @param {State} _state @returns {Transition} */
export function resetState(_state) {
  return { state: emptyState(), outcome: { kind: 'reset', message: 'Profile and conflicts cleared.' } };
}

/**
 * Validates persisted data. Throws on anything that doesn't match the State shape.
 * @param {unknown} raw
 * @returns {State}
 */
export function parseState(raw) {
  const fail = (/** @type {string} */ why) => {
    throw new Error(`Invalid stored state: ${why}`);
  };
  if (!isObject(raw) || !isObject(raw.profile) || !Array.isArray(raw.conflicts)) fail('wrong shape');
  const data = /** @type {{ profile: Record<string, unknown>, conflicts: unknown[], nextConflictId: unknown }} */ (raw);

  const state = emptyState();
  for (const field of FIELD_NAMES) {
    const values = data.profile[field] ?? [];
    if (!Array.isArray(values) || !values.every(isProfileValue)) fail(`bad values for ${field}`);
    if (PROFILE_FIELDS[field].kind === 'single' && values.length > 1) fail(`${field} has more than one value`);
    state.profile[field] = values;
  }
  for (const c of data.conflicts) {
    if (
      !isObject(c) ||
      typeof c.id !== 'string' ||
      !(/** @type {string[]} */ (FIELD_NAMES)).includes(/** @type {string} */ (c.field)) ||
      !Array.isArray(c.existing) ||
      typeof c.newInformation !== 'string' ||
      typeof c.evidence !== 'string' ||
      typeof c.createdAt !== 'string' ||
      !(c.proposed === null || isObject(c.proposed))
    ) {
      fail('bad conflict');
    }
  }
  state.conflicts = /** @type {Conflict[]} */ (data.conflicts);
  if (typeof data.nextConflictId !== 'number' || !Number.isInteger(data.nextConflictId)) fail('bad nextConflictId');
  state.nextConflictId = /** @type {number} */ (data.nextConflictId);
  return state;
}

// --- Helpers ----------------------------------------------------------------

/**
 * @param {State} state
 * @param {FieldName} field
 * @param {string} newInformation
 * @param {string} evidence
 * @param {ProfileChange | null} proposed
 * @param {Date} now
 * @returns {Transition}
 */
function recordConflict(state, field, newInformation, evidence, proposed, now) {
  const label = PROFILE_FIELDS[field].label;
  const stored = describe(state.profile[field]);
  const duplicate = state.conflicts.find((c) => c.field === field && sameText(c.newInformation, newInformation));
  if (duplicate) {
    return {
      state,
      outcome: {
        kind: 'conflict',
        message: `Not applied: this is already open as conflict ${duplicate.id}. Ask the user how to resolve it.`,
        conflict: duplicate,
      },
    };
  }

  /** @type {Conflict} */
  const conflict = {
    id: `c${state.nextConflictId}`,
    field,
    existing: state.profile[field].map((v) => v.value),
    newInformation: normalizeText(newInformation),
    evidence,
    proposed,
    createdAt: now.toISOString(),
  };
  const next = { ...state, conflicts: [...state.conflicts, conflict], nextConflictId: state.nextConflictId + 1 };
  const nextStep = `Ask the user which is right, then resolve conflict ${conflict.id}.`;
  return {
    state: next,
    outcome: proposed
      ? {
          kind: 'conflict',
          message: `Not applied: ${label} is currently ${stored}, and the requested change (${conflict.newInformation}) would overwrite it. It is open as conflict ${conflict.id}. ${nextStep}`,
          conflict,
        }
      : {
          kind: 'reported',
          message: `Recorded conflict ${conflict.id}: ${label} is currently ${stored}, which contradicts this new information: ${conflict.newInformation}. The stored value is unchanged. ${nextStep}`,
          conflict,
        },
  };
}

/** @param {State} state @param {FieldName} field @param {ProfileValue[]} values @returns {State} */
function withField(state, field, values) {
  return { ...state, profile: { ...state.profile, [field]: values } };
}

/** @param {string} value @param {string} evidence @param {Date} now @returns {ProfileValue} */
function toValue(value, evidence, now) {
  return { value, evidence, updatedAt: now.toISOString() };
}

/** @param {State} state @param {string} message @returns {Transition} */
function unchanged(state, message) {
  return { state, outcome: { kind: 'unchanged', message } };
}

/** @param {State} state @param {string} message @returns {Transition} */
function invalid(state, message) {
  return { state, outcome: { kind: 'invalid', message } };
}

/** @param {ProfileValue[]} values */
function describe(values) {
  return values.length === 0 ? 'empty' : values.map((v) => `"${v.value}"`).join(', ');
}

/** @param {string[]} values */
function dedupe(values) {
  return values.filter((v, i) => values.findIndex((w) => sameText(v, w)) === i);
}

/** @param {unknown} x @returns {x is Record<string, unknown>} */
function isObject(x) {
  return typeof x === 'object' && x !== null && !Array.isArray(x);
}

/** @param {unknown} x */
function isProfileValue(x) {
  return isObject(x) && typeof x.value === 'string' && typeof x.evidence === 'string' && typeof x.updatedAt === 'string';
}
