// @ts-check
/**
 * The profile service's contract, defined as data.
 *
 * Everything that crosses the wire is derived from this module: the HTML
 * renderer uses it to build pages and forms, and the parse* functions use it
 * to validate form submissions. Read this file to know what flows between the
 * service and its consumers (the React UI and the LLM).
 */

/** @typedef {'list' | 'single'} FieldKind */

/** Profile fields (DECISIONS.md D1). `single` fields hold at most one value. */
export const PROFILE_FIELDS = /** @type {const} */ ({
  interests: { label: 'Interests', kind: 'list' },
  dietaryRestrictions: { label: 'Dietary restrictions', kind: 'list' },
  accessibilityNeeds: { label: 'Accessibility needs', kind: 'list' },
  companions: { label: 'Travel companions', kind: 'list' },
  accommodationPreferences: { label: 'Accommodation preferences', kind: 'list' },
  transportPreferences: { label: 'Transport preferences', kind: 'list' },
  homeBase: { label: 'Home base', kind: 'single' },
  passportCountry: { label: 'Passport country', kind: 'single' },
});

/** @typedef {keyof typeof PROFILE_FIELDS} FieldName */

export const FIELD_NAMES = /** @type {FieldName[]} */ (Object.keys(PROFILE_FIELDS));

/** @typedef {'add' | 'remove' | 'set'} ChangeOp */

/** Which change operations each kind of field accepts. */
export const OPS_BY_KIND = /** @type {const} */ ({
  list: ['add', 'remove'],
  single: ['set', 'remove'],
});

/**
 * How a conflict can be resolved:
 * - keep: discard the new information; the stored value stands.
 * - accept: apply the change that caused the conflict (structural conflicts only).
 * - replace: set the field to the submitted value(s).
 * @typedef {'keep' | 'accept' | 'replace'} Resolution
 */
export const RESOLUTIONS = /** @type {const} */ (['keep', 'accept', 'replace']);

export const LIMITS = Object.freeze({
  textLength: 200,
  evidenceLength: 500,
  listLength: 20,
  bodyBytes: 16 * 1024,
});

export const ROUTES = Object.freeze({
  home: '/',
  profile: '/profile',
  conflicts: '/profile/conflicts',
  /** @param {string} id */
  conflict: (id) => `/profile/conflicts/${id}`,
  reset: '/profile/reset',
  destinations: '/destinations',
});

/**
 * What a write did. Every write response carries one in its #result section,
 * and the HTTP status is derived from it.
 * @typedef {'applied' | 'unchanged' | 'conflict' | 'reported' | 'resolved'
 *   | 'reset' | 'invalid' | 'not-found'} OutcomeKind
 */
export const STATUS_BY_OUTCOME = Object.freeze({
  applied: 200,
  unchanged: 200,
  resolved: 200,
  reset: 200,
  reported: 201,
  'not-found': 404,
  conflict: 409,
  invalid: 422,
});

// --- Form submissions -------------------------------------------------------

/**
 * @template T
 * @typedef {{ ok: true, value: T } | { ok: false, errors: string[] }} Parsed
 */

/**
 * POST /profile — inputs: field, op, value, evidence (all required).
 * @typedef {{ field: FieldName, op: ChangeOp, value: string, evidence: string }} ProfileChange
 */

/**
 * POST /profile/conflicts — inputs: field, newInformation, evidence (all required).
 * @typedef {{ field: FieldName, newInformation: string, evidence: string }} ConflictReport
 */

/**
 * POST /profile/conflicts/{id} — inputs: resolution (required); value
 * (repeatable, or one per line; used by `replace`); evidence (optional).
 * @typedef {{ resolution: Resolution, values: string[], evidence: string }} ConflictResolution
 */

/**
 * @param {URLSearchParams} form
 * @returns {Parsed<ProfileChange>}
 */
export function parseProfileChange(form) {
  const errors = [];
  const field = parseField(form.get('field'), errors);
  const op = form.get('op');
  if (field) {
    const allowed = /** @type {readonly string[]} */ (OPS_BY_KIND[PROFILE_FIELDS[field].kind]);
    if (!op || !allowed.includes(op)) {
      errors.push(`op must be one of ${allowed.join(', ')} for ${field}.`);
    }
  }
  const value = parseText('value', form.get('value'), LIMITS.textLength, errors);
  const evidence = parseText('evidence', form.get('evidence'), LIMITS.evidenceLength, errors);
  if (errors.length > 0 || !field || !value || !evidence) return { ok: false, errors };
  return { ok: true, value: { field, op: /** @type {ChangeOp} */ (op), value, evidence } };
}

/**
 * @param {URLSearchParams} form
 * @returns {Parsed<ConflictReport>}
 */
export function parseConflictReport(form) {
  const errors = [];
  const field = parseField(form.get('field'), errors);
  const newInformation = parseText('newInformation', form.get('newInformation'), LIMITS.textLength, errors);
  const evidence = parseText('evidence', form.get('evidence'), LIMITS.evidenceLength, errors);
  if (errors.length > 0 || !field || !newInformation || !evidence) return { ok: false, errors };
  return { ok: true, value: { field, newInformation, evidence } };
}

/**
 * @param {URLSearchParams} form
 * @returns {Parsed<ConflictResolution>}
 */
export function parseConflictResolution(form) {
  const errors = [];
  const resolution = form.get('resolution');
  if (!resolution || !(/** @type {readonly string[]} */ (RESOLUTIONS)).includes(resolution)) {
    errors.push(`resolution must be one of ${RESOLUTIONS.join(', ')}.`);
  }
  const values = form
    .getAll('value')
    .flatMap((raw) => raw.split('\n'))
    .map(normalizeText)
    .filter((v) => v !== '');
  for (const v of values) {
    if (v.length > LIMITS.textLength) errors.push(`each value must be at most ${LIMITS.textLength} characters.`);
  }
  if (values.length > LIMITS.listLength) errors.push(`at most ${LIMITS.listLength} values are allowed.`);
  const evidence = normalizeText(form.get('evidence') ?? '');
  if (evidence.length > LIMITS.evidenceLength) {
    errors.push(`evidence must be at most ${LIMITS.evidenceLength} characters.`);
  }
  if (errors.length > 0) return { ok: false, errors };
  return { ok: true, value: { resolution: /** @type {Resolution} */ (resolution), values, evidence } };
}

/** Trims and collapses internal whitespace. */
export function normalizeText(/** @type {string} */ text) {
  return text.trim().replace(/\s+/g, ' ');
}

/** Case-insensitive comparison of normalized text. */
export function sameText(/** @type {string} */ a, /** @type {string} */ b) {
  return normalizeText(a).toLocaleLowerCase() === normalizeText(b).toLocaleLowerCase();
}

/**
 * @param {string | null} raw
 * @param {string[]} errors
 * @returns {FieldName | null}
 */
function parseField(raw, errors) {
  if (raw && (/** @type {string[]} */ (FIELD_NAMES)).includes(raw)) return /** @type {FieldName} */ (raw);
  errors.push(`field must be one of ${FIELD_NAMES.join(', ')}.`);
  return null;
}

/**
 * @param {string} name
 * @param {string | null} raw
 * @param {number} maxLength
 * @param {string[]} errors
 * @returns {string | null}
 */
function parseText(name, raw, maxLength, errors) {
  const text = normalizeText(raw ?? '');
  if (text === '') {
    errors.push(`${name} is required.`);
    return null;
  }
  if (text.length > maxLength) {
    errors.push(`${name} must be at most ${maxLength} characters.`);
    return null;
  }
  return text;
}
