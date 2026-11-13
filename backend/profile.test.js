// @ts-check
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { applyChange, emptyState, parseState, reportConflict, resolveConflict } from './profile.js';

const now = new Date('2026-01-01T00:00:00Z');

/** @typedef {import('./profile.js').State} State */
/** @typedef {import('./contract.js').ProfileChange} ProfileChange */

/** @param {State} state @param {Partial<ProfileChange> & Pick<ProfileChange, 'field' | 'op' | 'value'>} change */
function apply(state, change) {
  return applyChange(state, { evidence: 'user said so', ...change }, now);
}

function vegetarian() {
  return apply(emptyState(), { field: 'dietaryRestrictions', op: 'add', value: 'vegetarian' }).state;
}

describe('applyChange', () => {
  it('adds to a list field', () => {
    const { state, outcome } = apply(emptyState(), { field: 'interests', op: 'add', value: 'hiking' });
    assert.equal(outcome.kind, 'applied');
    assert.deepEqual(state.profile.interests.map((v) => v.value), ['hiking']);
  });

  it('treats adding another value as additive, not a conflict (UC-10)', () => {
    const start = apply(emptyState(), { field: 'interests', op: 'add', value: 'hiking' }).state;
    const { state, outcome } = apply(start, { field: 'interests', op: 'add', value: 'museums' });
    assert.equal(outcome.kind, 'applied');
    assert.equal(state.conflicts.length, 0);
    assert.deepEqual(state.profile.interests.map((v) => v.value), ['hiking', 'museums']);
  });

  it('ignores a duplicate add regardless of case and spacing', () => {
    const start = vegetarian();
    const { state, outcome } = apply(start, { field: 'dietaryRestrictions', op: 'add', value: 'Vegetarian' });
    assert.equal(outcome.kind, 'unchanged');
    assert.equal(state, start);
  });

  it('sets an empty single field', () => {
    const { state, outcome } = apply(emptyState(), { field: 'homeBase', op: 'set', value: 'Boston' });
    assert.equal(outcome.kind, 'applied');
    assert.deepEqual(state.profile.homeBase.map((v) => v.value), ['Boston']);
  });

  it('replaces a single field: deciding whether that is a contradiction is the LLM\'s job', () => {
    const start = apply(emptyState(), { field: 'homeBase', op: 'set', value: 'Boston' }).state;
    const { state, outcome } = apply(start, { field: 'homeBase', op: 'set', value: 'Chicago' });
    assert.equal(outcome.kind, 'applied');
    assert.match(outcome.message, /from "Boston" to "Chicago"/);
    assert.deepEqual(state.profile.homeBase.map((v) => v.value), ['Chicago']);
    assert.equal(state.conflicts.length, 0);
  });

  it('closes conflicts about a value the user has replaced', () => {
    const start = apply(emptyState(), { field: 'passportCountry', op: 'set', value: 'US' }).state;
    const withConflict = reportConflict(
      start,
      { field: 'passportCountry', newInformation: 'mentioned a Canadian passport', evidence: 'my Canadian passport' },
      now,
    ).state;
    const { state, outcome } = apply(withConflict, { field: 'passportCountry', op: 'set', value: 'Canada' });
    assert.match(outcome.message, /Closed conflict c1/);
    assert.equal(state.conflicts.length, 0);
  });

  it('removes a stored value without recording a conflict', () => {
    const start = apply(vegetarian(), { field: 'dietaryRestrictions', op: 'add', value: 'gluten-free' }).state;
    const { state, outcome } = apply(start, { field: 'dietaryRestrictions', op: 'remove', value: 'Vegetarian' });
    assert.equal(outcome.kind, 'applied');
    assert.equal(state.conflicts.length, 0);
    assert.deepEqual(state.profile.dietaryRestrictions.map((v) => v.value), ['gluten-free']);
  });

  it('closes conflicts that depended on a removed value, and only those', () => {
    const withConflict = reportConflict(
      apply(vegetarian(), { field: 'interests', op: 'add', value: 'hiking' }).state,
      { field: 'dietaryRestrictions', newInformation: 'wants a steakhouse', evidence: 'steak!' },
      now,
    ).state;
    const twoConflicts = reportConflict(
      withConflict,
      { field: 'interests', newInformation: 'hates walking', evidence: 'I hate walking' },
      now,
    ).state;
    const { state, outcome } = apply(twoConflicts, { field: 'dietaryRestrictions', op: 'remove', value: 'vegetarian' });
    assert.equal(outcome.kind, 'applied');
    assert.match(outcome.message, /Closed conflict c1/);
    assert.deepEqual(state.conflicts.map((c) => c.id), ['c2']);
  });

  it('does nothing when removing a value that is not stored', () => {
    const start = vegetarian();
    const { state, outcome } = apply(start, { field: 'dietaryRestrictions', op: 'remove', value: 'vegan' });
    assert.equal(outcome.kind, 'unchanged');
    assert.equal(state, start);
  });

});

describe('reportConflict', () => {
  const report = { field: /** @type {const} */ ('dietaryRestrictions'), newInformation: 'wants a steakhouse', evidence: 'steak!' };

  it('records a semantic conflict without changing the value (UC-21)', () => {
    const { state, outcome } = reportConflict(vegetarian(), report, now);
    assert.equal(outcome.kind, 'reported');
    assert.deepEqual(state.conflicts[0].existing, ['vegetarian']);
    assert.deepEqual(state.profile.dietaryRestrictions.map((v) => v.value), ['vegetarian']);
  });

  it('does not record the same conflict twice, so a retried turn is harmless', () => {
    const once = reportConflict(vegetarian(), report, now).state;
    const twice = reportConflict(once, { ...report, newInformation: '  Wants a  steakhouse ' }, now);
    assert.equal(twice.outcome.kind, 'unchanged');
    assert.equal(twice.state, once);
  });

  it('rejects a conflict against an empty field', () => {
    const start = emptyState();
    const { state, outcome } = reportConflict(start, report, now);
    assert.equal(outcome.kind, 'invalid');
    assert.equal(state, start);
  });
});

describe('resolveConflict', () => {
  /** @param {import('./contract.js').Resolution} resolution @param {string[]} [values] */
  function resolveSteakhouse(resolution, values = []) {
    const withConflict = reportConflict(
      vegetarian(),
      { field: 'dietaryRestrictions', newInformation: 'wants a steakhouse', evidence: 'steak!' },
      now,
    ).state;
    return resolveConflict(withConflict, 'c1', { resolution, values, evidence: '' }, now);
  }

  it('keep closes the conflict and leaves the value (UC-22)', () => {
    const { state, outcome } = resolveSteakhouse('keep');
    assert.equal(outcome.kind, 'resolved');
    assert.equal(state.conflicts.length, 0);
    assert.deepEqual(state.profile.dietaryRestrictions.map((v) => v.value), ['vegetarian']);
  });

  it('replace sets the field to the given values (UC-23)', () => {
    const { state } = resolveSteakhouse('replace', []);
    assert.equal(state.conflicts.length, 0);
    assert.deepEqual(state.profile.dietaryRestrictions, []);
  });

  it('replace on a single field rejects more than one value', () => {
    const start = apply(emptyState(), { field: 'homeBase', op: 'set', value: 'Boston' }).state;
    const withConflict = reportConflict(
      start,
      { field: 'homeBase', newInformation: 'said they live in Chicago', evidence: 'here in Chicago' },
      now,
    ).state;
    const { state, outcome } = resolveConflict(
      withConflict,
      'c1',
      { resolution: 'replace', values: ['Chicago', 'Denver'], evidence: '' },
      now,
    );
    assert.equal(outcome.kind, 'invalid');
    assert.equal(state, withConflict);
  });

  it('reports an unknown conflict id', () => {
    const { outcome } = resolveConflict(emptyState(), 'c42', { resolution: 'keep', values: [], evidence: '' }, now);
    assert.equal(outcome.kind, 'not-found');
  });
});

describe('parseState', () => {
  it('round-trips a valid state', () => {
    const state = reportConflict(
      vegetarian(),
      { field: 'dietaryRestrictions', newInformation: 'steakhouse', evidence: 'steak' },
      now,
    ).state;
    assert.deepEqual(parseState(JSON.parse(JSON.stringify(state))), state);
  });

  it('drops properties left over from older versions', () => {
    const state = reportConflict(vegetarian(), { field: 'dietaryRestrictions', newInformation: 'steak', evidence: 'steak' }, now).state;
    const stored = JSON.parse(JSON.stringify(state));
    stored.conflicts[0].proposed = null;
    assert.deepEqual(parseState(stored), state);
  });

  it('rejects malformed data', () => {
    assert.throws(() => parseState({ profile: { interests: 'hiking' }, conflicts: [], nextConflictId: 1 }));
    assert.throws(() => parseState(null));
  });
});
