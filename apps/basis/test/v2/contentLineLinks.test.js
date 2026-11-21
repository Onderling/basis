/**
 * The content line reads a lane's links (`parent` and `deps`) from the statements this device holds. A signed body
 * names its parent `parentHash`, not `parent`: one adapter, shared by both rails, read from REAL signed statements, so
 * a walk can never stop at the first link because of a field name.
 */
import { describe, it, expect } from 'vitest';
import { signSpine, frontier, AgentIdentity } from '@onderling/core';
import { VaultMemory } from '@onderling/vault';
import { linksIndex, lineRelation } from '../../src/v2/contentLine.js';

describe('the links adapter over real signed statements', () => {
  it('maps a body\'s parentHash and deps; a statement under a tip is behind it, a later one is not', async () => {
    const alice = await AgentIdentity.generate(new VaultMemory());
    const bob = await AgentIdentity.generate(new VaultMemory());
    const bodies = [];
    const add = (who, subject) => {
      const own = bodies.filter((b) => b.author === who.pubKey);
      const parent = own.length ? own[own.length - 1].hash : null;
      const deps = frontier(bodies).filter((h) => h !== parent);
      const s = signSpine(who, { kind: 'snapshot', circleId: 'c1', subject, payload: { item: { id: subject } }, parent, deps });
      bodies.push(s.body);
      return s.body.hash;
    };
    const a1 = add(alice, 'one');
    const b1 = add(bob, 'two');
    const a2 = add(alice, 'three');            // parent a1, deps [b1]
    const tips = frontier(bodies);             // the line an admin would draw now
    const later = add(bob, 'four');            // made after the line

    const linksOf = linksIndex(bodies);
    expect(linksOf(a2)).toEqual({ parent: a1, deps: [b1] });
    expect(linksOf(a1)).toEqual({ parent: null, deps: [] });
    expect(linksOf('not-held')).toBeNull();
    expect(lineRelation(a1, tips, linksOf)).toBe('behind');
    expect(lineRelation(b1, tips, linksOf)).toBe('behind');
    expect(lineRelation(later, tips, linksOf)).toBe('not-behind');
  });
});
