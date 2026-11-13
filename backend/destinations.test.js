// @ts-check
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { getDestinationInfo, listDestinationNames } from './destinations.js';

describe('getDestinationInfo', () => {
  it('has at least 5 destinations, each with the required fields (DEST-2, DEST-3)', async () => {
    const names = listDestinationNames();
    assert.ok(names.length >= 5);
    for (const name of names) {
      const info = await getDestinationInfo(name);
      assert.ok(info, name);
      assert.ok(info.bestSeasons.length > 0 && info.knownFor.length > 0, name);
      const { budget, midRange, luxury } = info.averageDailyBudgetUSD;
      assert.ok(budget < midRange && midRange < luxury, name);
    }
  });

  it('matches regardless of case, accents, whitespace and aliases (UC-18)', async () => {
    assert.equal((await getDestinationInfo('  lisbon '))?.name, 'Lisbon');
    assert.equal((await getDestinationInfo('Reykjavík'))?.name, 'Reykjavik');
    assert.equal((await getDestinationInfo('mexico   city'))?.name, 'Mexico City');
    assert.equal((await getDestinationInfo('CDMX'))?.name, 'Mexico City');
  });

  it('returns null for unknown destinations (UC-16)', async () => {
    assert.equal(await getDestinationInfo('Ulaanbaatar'), null);
    assert.equal(await getDestinationInfo(''), null);
  });

  it('does not expose internal aliases or share mutable data', async () => {
    const info = await getDestinationInfo('Lisbon');
    assert.ok(info && !('aliases' in info));
    info.knownFor.push('mutated');
    assert.ok(!(await getDestinationInfo('Lisbon'))?.knownFor.includes('mutated'));
  });
});
