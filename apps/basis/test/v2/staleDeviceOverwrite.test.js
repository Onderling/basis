/**
 * A stale second device must not clobber a fresher change — story 6.2 of the multi-device user stories.
 *
 * The same shape as the bugs found on 2026-07-26 (a second operation re-derives from a partial base and silently
 * overwrites the first), on the multi-device axis: Anna changes the circle on her PHONE while her LAPTOP is offline
 * holding the old document; the laptop comes back.
 *
 * THE POLICY now rides the governance lane as a versioned admin statement (2026-09-26), so the property is the
 * lane's: a statement at a LOWER version never overwrites a higher one on any device, in any arrival order; two
 * statements at the same version fold the same way everywhere (deny-wins); and a third member converges on that
 * one answer. (Until then the policy arrived as a broadcast parked for a person to resolve — the retired path.)
 *
 * THE RULES document rides the same kind of lane (the rules-update rider); its half of 6.2 is pinned where its version
 * guard lives, apps/pinboard/test/rulesUpdateStaleVersion.test.js.
 *
 * Cast: Anna's phone (fresh) · Anna's laptop (stale) · Bram (a third member who must converge, not diverge).
 */
import { describe, it, expect } from 'vitest';
import { applyPolicyUpdates, makePolicyHeadStore, POLICY_UPDATE_KIND } from '../../src/v2/policyUpdateLane.js';

const admins = new Set(['anna']);
const stmt = (version, policy, hash) => ({ body: { kind: POLICY_UPDATE_KIND, author: 'anna', hash, payload: { policy, version } }, sig: 's' });
function device() {
  const m = new Map();
  const headStore = makePolicyHeadStore({ getItem: async (k) => m.get(k) ?? null, setItem: async (k, v) => { m.set(k, v); } });
  let policy = null;
  return {
    policy: () => policy,
    async receive(stored) {
      const rail = { storedStatements: () => stored, readVerifiedBodies: async () => ({ bodies: stored.map((s) => s.body) }) };
      return applyPolicyUpdates({ rail, circleId: 'c1', adminsOf: async () => admins, headStore, writePolicy: async (c, p) => { policy = p; } });
    },
  };
}

describe('6.2 — the policy: a stale device cannot overwrite a fresher change', () => {
  const fresh = stmt(3, { storagePosture: 'p2', llmTool: 'off' }, 'h-fresh');   // the phone, caught up, saved v3
  const stale = stmt(2, { storagePosture: 'p0', llmTool: 'cloud' }, 'h-stale'); // the laptop, behind, saved v2

  it('the fresher version wins, whichever arrives first', async () => {
    const a = device(); await a.receive([fresh]); await a.receive([fresh, stale]);
    const b = device(); await b.receive([stale]); await b.receive([stale, fresh]);
    expect(a.policy()).toEqual(fresh.body.payload.policy);
    expect(b.policy()).toEqual(fresh.body.payload.policy);
  });

  it('a third member converges on the same answer as the other two', async () => {
    const bram = device(); await bram.receive([stale, fresh]);
    expect(bram.policy()).toEqual(fresh.body.payload.policy);
  });

  it('two saves at the SAME version (the laptop never caught up) fold the same everywhere — deny-wins', async () => {
    const twin = stmt(3, { storagePosture: 'p0', llmTool: 'cloud' }, 'h-twin');
    const a = device(); await a.receive([fresh, twin]);
    const b = device(); await b.receive([twin]); await b.receive([twin, fresh]);
    expect(a.policy()).toEqual(b.policy());
    expect(a.policy()).toMatchObject({ storagePosture: 'p2', llmTool: 'off' });
  });
});
