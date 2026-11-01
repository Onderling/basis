/**
 * WHERE A RETIRED ADDRESS STOPPED. A re-key retires the address a person's whole history in a circle was signed with —
 * the circle's creation, the joins it admitted. The retirement names `upTo`, the hash of that address's last statement
 * in its own author chain (covered by the root's reveal), and the address then binds exactly that chain up to and
 * including it: the same on every device, in any arrival order; nothing it signs after binds anywhere. Local arrival
 * order cannot be that cut (a fresh device may hear the retirement first), nor causal depth (the signer picks its own
 * parents, so a thief could backdate).
 *
 * @vitest-environment node
 */
import { describe, it, expect } from 'vitest';
import { addressBindsOnRow, inAuthorChainUpTo } from '../../src/v2/membershipRail.js';

const OLD = 'addr-old';
const NEW = 'addr-new';
// Anna's chain under the old address: create ← join ← person-key ← (the cut); then a thief signs on with the old key
const create = { hash: 'h-create', author: OLD, parentHash: null };
const join = { hash: 'h-join', author: OLD, parentHash: 'h-create' };
const personKey = { hash: 'h-pk', author: OLD, parentHash: 'h-join' };
const thief = { hash: 'h-thief', author: OLD, parentHash: 'h-pk' };          // after the cut, chained on it
const backdated = { hash: 'h-back', author: OLD, parentHash: 'h-create' };   // after the cut, claiming an early parent
const chainOf = (...stmts) => { const m = new Map(stmts.map((s) => [s.hash, s])); return (h) => m.get(h) ?? null; };
const live = { circleAddress: OLD, circleAddresses: [OLD] };
const retired = { circleAddress: NEW, circleAddresses: [NEW], retiredAddresses: [{ address: OLD, atSeq: 99, upTo: 'h-pk' }] };

describe('a retired address binds exactly its own chain up to where it stopped', () => {
  it('the history before the cut binds — the founder\'s creation included — wherever the retirement sits in the log', () => {
    const all = chainOf(create, join, personKey, thief, backdated);
    for (const s of [create, join, personKey]) {
      // atSeq says the retirement landed FIRST (a fresh device catching the history up newest-first): no matter
      expect(addressBindsOnRow(retired, OLD, 0, { hash: s.hash, chainOf: all }), s.hash).toBe(true);
      expect(addressBindsOnRow(retired, OLD, 500, { hash: s.hash, chainOf: all }), s.hash).toBe(true);
    }
  });

  it('a thief\'s statement after the cut binds while the address is live, and nowhere once the retirement is known — chained on it or backdated', () => {
    const all = chainOf(create, join, personKey, thief, backdated);
    expect(addressBindsOnRow(live, OLD, 0, { hash: thief.hash, chainOf: all }), 'before the retirement the address is live').toBe(true);
    // delivered BEFORE the retirement landed (atSeq below it), or after: refused either way once it is known
    expect(addressBindsOnRow(retired, OLD, 0, { hash: thief.hash, chainOf: all })).toBe(false);
    expect(addressBindsOnRow(retired, OLD, 500, { hash: thief.hash, chainOf: all })).toBe(false);
    expect(addressBindsOnRow(retired, OLD, 0, { hash: backdated.hash, chainOf: all }), 'a backdated parent does not put it before the cut').toBe(false);
  });

  it('a gap in the chain decides nothing yet: unprovable before the cut → not bound (the next read, with the gap filled, binds it)', () => {
    expect(addressBindsOnRow(retired, OLD, 0, { hash: create.hash, chainOf: chainOf(personKey, create) }), 'the join between is missing').toBe(false);
    expect(addressBindsOnRow(retired, OLD, 0, { hash: create.hash, chainOf: chainOf(personKey, join, create) })).toBe(true);
  });

  it('without the chain at hand, a cut address binds nothing; a retirement without a cut keeps the position rule', () => {
    expect(addressBindsOnRow(retired, OLD, 0, { hash: create.hash })).toBe(false);
    const positional = { circleAddress: NEW, retiredAddresses: [{ address: OLD, atSeq: 10 }] };
    expect(addressBindsOnRow(positional, OLD, 5)).toBe(true);
    expect(addressBindsOnRow(positional, OLD, 15)).toBe(false);
  });

  it('the walk follows only the retired address\'s own chain', () => {
    const other = { hash: 'h-other', author: 'addr-someone', parentHash: 'h-create' };
    const pkViaOther = { hash: 'h-pk2', author: OLD, parentHash: 'h-other' };
    expect(inAuthorChainUpTo(chainOf(create, other, pkViaOther), OLD, 'h-pk2', 'h-create'), 'the chain left the author').toBe(false);
  });
});
