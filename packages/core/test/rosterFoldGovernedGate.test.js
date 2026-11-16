/**
 * THE ROSTER FOLD'S GOVERNED GATE: the host may hand the fold one more predicate beside the rules gate,
 * `governedGate(statement, { admins })`, asked for another person's `evict` and `role` only. A statement it refuses
 * does not take effect (the circle's rule asked for a vote it did not have). Never asked for a person's own acts: a
 * self-leave, stepping down from one's own admin role, the caretaker's acknowledgement. Absent (the default) the fold
 * is exactly what it was: the kernel holds no policy.
 */
import { describe, it, expect } from 'vitest';
import { foldRoster } from '../src/security/rosterFold.js';
import { signSpine } from '../src/security/spineStatement.js';
import { AgentIdentity } from '../src/identity/AgentIdentity.js';
import { VaultMemory } from '@onderling/vault';

const body = (id, kind, subject, { payload, parent = null, deps = [] } = {}) =>
  signSpine(id, { kind, circleId: 'c', subject: subject.pubKey ?? subject, payload, parent, deps }).body;

async function circle() {
  const [founder, ann, bob] = await Promise.all([0, 1, 2].map(() => AgentIdentity.generate(new VaultMemory())));
  const annJoin = body(ann, 'join', ann);
  const bobJoin = body(bob, 'join', bob);
  return { founder, ann, bob, annJoin, bobJoin };
}

describe('the governed gate in the roster fold', () => {
  it('a refused eviction does not remove; without a gate it does', async () => {
    const { founder, bob, annJoin, bobJoin } = await circle();
    const evict = body(founder, 'evict', bob, { deps: [bobJoin.hash] });
    const stmts = [annJoin, bobJoin, evict];
    expect(foldRoster(stmts, { founders: [founder.pubKey] }).members).not.toContain(bob.pubKey);
    const asked = [];
    const gated = foldRoster(stmts, { founders: [founder.pubKey], governedGate: (s, ctx) => { asked.push([s.kind, ctx.admins.has(founder.pubKey)]); return false; } });
    expect(gated.members).toContain(bob.pubKey);
    expect(asked).toEqual([['evict', true]]);
  });

  it('a refused promotion does not make an admin; an allowed one does', async () => {
    const { founder, ann, annJoin, bobJoin } = await circle();
    const promote = body(founder, 'role', ann, { payload: { role: 'admin' }, deps: [annJoin.hash] });
    const stmts = [annJoin, bobJoin, promote];
    expect(foldRoster(stmts, { founders: [founder.pubKey], governedGate: () => false }).admins).not.toContain(ann.pubKey);
    expect(foldRoster(stmts, { founders: [founder.pubKey], governedGate: () => true }).admins).toContain(ann.pubKey);
  });

  it('never asked for a person\'s own acts: leaving, or stepping down from their own admin role', async () => {
    const { founder, ann, bob, annJoin, bobJoin } = await circle();
    const promote = body(founder, 'role', ann, { payload: { role: 'admin' }, deps: [annJoin.hash] });
    const stepDown = body(ann, 'role', ann, { payload: { role: 'member' }, parent: annJoin.hash, deps: [promote.hash] });
    const leave = body(bob, 'leave', bob, { parent: bobJoin.hash });
    const asked = [];
    const r = foldRoster([annJoin, bobJoin, promote, stepDown, leave], {
      founders: [founder.pubKey],
      governedGate: (s) => { asked.push(`${s.kind}:${s.author === s.subject ? 'own' : 'other'}`); return s.kind === 'role' && s.payload?.role === 'admin'; },
    });
    expect(asked).toEqual(['role:other']);              // only the founder's promotion of ann was asked
    expect(r.admins).not.toContain(ann.pubKey);         // her own step-down stood
    expect(r.members).not.toContain(bob.pubKey);        // his own leave stood
  });
});
