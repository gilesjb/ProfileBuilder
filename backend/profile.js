// @ts-check
/**
 * Profile domain logic: applying changes, and recording and resolving conflicts.
 *
 * Pure functions with no I/O. Each takes the current state and returns
 * `{ state, outcome }`. When nothing changes (or the request is rejected) the
 * returned state is the same object that was passed in.
 *
 * This module does not decide what counts as a contradiction. Only the LLM
 * can tell that "wants a steakhouse" contradicts "vegetarian", or that a new
 * home city is a move rather than a mistake. Changes the user states are
 * applied as given; contradictions the LLM notices are reported, and this
 * module keeps them: it persists them, removes duplicates, and closes them
 * once they are resolved or the value they refer to is gone.
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
 * An open contradiction, reported by the LLM, between the stored values of a
 * field and something the user said.
 * @typedef {{
 *   id: string,
 *   field: FieldName,
 *   existing: string[],
 *   newInformation: string,
 *   evidence: string,
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
 * Applies a change the user stated. `set` replaces a single value; `remove`
 * retracts a value. Open conflicts about a value that is replaced or removed
 * are closed, since the user has now said what's true.
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
    if (isStored) return unchanged(state, `${label} is already "${value}".`);
    const replaced = current.map((v) => v.value);
    const next = withField(state, field, [toValue(value, change.evidence, now)]);
    const message = replaced.length
      ? `Changed ${label} from ${quoteAll(replaced)} to "${value}".`
      : `Set ${label} to "${value}".`;
    return closeConflictsAbout(next, field, replaced, message);
  }

  // op === 'remove'
  if (!isStored) return unchanged(state, `${label} does not include "${value}"; nothing to remove.`);
  const next = withField(state, field, current.filter((v) => !sameText(v.value, value)));
  return closeConflictsAbout(next, field, [value], `Removed "${value}" from ${label}.`);
}

/**
 * Records a contradiction the LLM noticed between a stored value and
 * something the user said. The stored value is left unchanged (CONF-2).
 * @param {State} state
 * @param {ConflictReport} report
 * @param {Date} now
 * @returns {Transition}
 */
export function reportConflict(state, report, now) {
  const { field, evidence } = report;
  const label = PROFILE_FIELDS[field].label;
  if (state.profile[field].length === 0) {
    return invalid(
      state,
      `${label} has no stored value, so nothing contradicts it. If this is a new preference, submit it as a profile change instead.`,
    );
  }

  const newInformation = normalizeText(report.newInformation);
  const duplicate = state.conflicts.find((c) => c.field === field && sameText(c.newInformation, newInformation));
  if (duplicate) {
    return unchanged(state, `This is already open as conflict ${duplicate.id}. Ask the user how to resolve it.`);
  }

  /** @type {Conflict} */
  const conflict = {
    id: `c${state.nextConflictId}`,
    field,
    existing: state.profile[field].map((v) => v.value),
    newInformation,
    evidence,
    createdAt: now.toISOString(),
  };
  return {
    state: { ...state, conflicts: [...state.conflicts, conflict], nextConflictId: state.nextConflictId + 1 },
    outcome: {
      kind: 'reported',
      message:
        `Recorded conflict ${conflict.id}: ${label} is currently ${describe(state.profile[field])}, which contradicts this new information: ${newInformation}. ` +
        `The stored value is unchanged. Ask the user which is right, then resolve conflict ${conflict.id}.`,
      conflict,
    },
  };
}

/**
 * Closes a conflict. `keep` leaves the field as it is; `replace` sets it to
 * the given values (possibly none).
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
  let values = state.profile[field];
  if (resolution.resolution === 'replace') {
    if (PROFILE_FIELDS[field].kind === 'single' && resolution.values.length > 1) {
      return invalid(state, `${label} holds a single value; submit at most one.`);
    }
    const evidence = resolution.evidence || conflict.evidence;
    values = dedupe(resolution.values).map((v) => toValue(v, evidence, now));
  }
  return {
    state: { ...withField(state, field, values), conflicts: state.conflicts.filter((c) => c.id !== id) },
    outcome: {
      kind: 'resolved',
      message:
        resolution.resolution === 'keep'
          ? `Conflict ${id} resolved: kept ${label} as ${describe(values)}.`
          : `Conflict ${id} resolved: ${label} is now ${describe(values)}.`,
    },
  };
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
  state.conflicts = data.conflicts.map((c) => {
    if (
      !isObject(c) ||
      typeof c.id !== 'string' ||
      !(/** @type {string[]} */ (FIELD_NAMES)).includes(/** @type {string} */ (c.field)) ||
      !Array.isArray(c.existing) ||
      !c.existing.every((e) => typeof e === 'string') ||
      typeof c.newInformation !== 'string' ||
      typeof c.evidence !== 'string' ||
      typeof c.createdAt !== 'string'
    ) {
      return fail('bad conflict');
    }
    // Keep only known properties, which also drops fields from older versions.
    const { id, field, existing, newInformation, evidence, createdAt } = c;
    return /** @type {Conflict} */ ({ id, field, existing, newInformation, evidence, createdAt });
  });
  if (typeof data.nextConflictId !== 'number' || !Number.isInteger(data.nextConflictId)) fail('bad nextConflictId');
  state.nextConflictId = /** @type {number} */ (data.nextConflictId);
  return state;
}

// --- Helpers ----------------------------------------------------------------

/**
 * Closes open conflicts on `field` that refer to any of `values`: the user
 * has replaced or removed the value they were about.
 * @param {State} state
 * @param {FieldName} field
 * @param {string[]} values
 * @param {string} message
 * @returns {Transition}
 */
function closeConflictsAbout(state, field, values, message) {
  const moot = state.conflicts.filter((c) => c.field === field && c.existing.some((e) => values.some((v) => sameText(e, v))));
  if (moot.length === 0) return { state, outcome: { kind: 'applied', message } };
  const ids = moot.map((c) => c.id).join(', ');
  return {
    state: { ...state, conflicts: state.conflicts.filter((c) => !moot.includes(c)) },
    outcome: { kind: 'applied', message: `${message} Closed conflict${moot.length > 1 ? 's' : ''} ${ids}, which referred to the old value.` },
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
  return values.length === 0 ? 'empty' : quoteAll(values.map((v) => v.value));
}

/** @param {string[]} values */
function quoteAll(values) {
  return values.map((v) => `"${v}"`).join(', ');
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
