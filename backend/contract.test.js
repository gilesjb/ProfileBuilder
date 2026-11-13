// @ts-check
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { parseConflictResolution, parseProfileChange } from './contract.js';

describe('parseProfileChange', () => {
  it('accepts a valid change and normalizes whitespace', () => {
    const parsed = parseProfileChange(
      new URLSearchParams({ field: 'interests', op: 'add', value: '  street   food ', evidence: 'I love street food' }),
    );
    assert.deepEqual(parsed, {
      ok: true,
      value: { field: 'interests', op: 'add', value: 'street food', evidence: 'I love street food' },
    });
  });

  it('rejects unknown fields, wrong ops for the field kind, and missing text', () => {
    const parsed = parseProfileChange(new URLSearchParams({ field: 'budget', op: 'add', value: '' }));
    assert.equal(parsed.ok, false);

    const wrongOp = parseProfileChange(new URLSearchParams({ field: 'homeBase', op: 'add', value: 'Boston', evidence: 'x' }));
    assert.equal(wrongOp.ok, false);
    assert.match(wrongOp.ok ? '' : wrongOp.errors.join(), /set, remove/);
  });

  it('rejects overlong values', () => {
    const parsed = parseProfileChange(
      new URLSearchParams({ field: 'interests', op: 'add', value: 'x'.repeat(201), evidence: 'x' }),
    );
    assert.equal(parsed.ok, false);
  });
});

describe('parseConflictResolution', () => {
  it('accepts values as repeated inputs or one per line', () => {
    const form = new URLSearchParams([
      ['resolution', 'replace'],
      ['value', 'vegan\n gluten-free '],
      ['value', 'halal'],
    ]);
    const parsed = parseConflictResolution(form);
    assert.ok(parsed.ok);
    assert.deepEqual(parsed.value.values, ['vegan', 'gluten-free', 'halal']);
  });

  it('rejects an unknown resolution', () => {
    assert.equal(parseConflictResolution(new URLSearchParams({ resolution: 'overwrite' })).ok, false);
  });
});
