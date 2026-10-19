/**
 * IN A PERSONA'S CIRCLE, GOVERNANCE IS THE PERSONA'S — on every side authority is judged. A device is its general self in
 * circle X and persona W in circle Y; W is Y's admin. The shell hands governance the self PER CIRCLE (and, as the shells
 * do, the general persona's ref as the actor of a call): in Y, W proposes and enacts, its statements are signed by W's
 * per-circle key and name W — and nothing carries the general persona's ref. In X, the general self as before.
 */
import { describe, it, expect } from 'vitest';
import { AgentIdentity } from '@onderling/core';
import { VaultMemory } from '@onderling/vault';
import { bindCircleGovernance } from '../../src/v2/governanceAppWiring.js';
import { GOVERNANCE_KIND } from '../../src/v2/governanceLog.js';

const X = 'circle:thuis';
const Y = 'circle:werk';
const GENERAL = 'webid:anna';
const W = 'webid:anna-werk';

function fakeEventLog() {
  const entries = []; const byId = new Set();
  return {
    entries,
    query() { return entries.slice(); },
    appendSilentEntry({ circleId, kind, payload, id, ts }) {
      if (byId.has(id)) return entries.find((e) => e.id === id);
      byId.add(id);
      const entry = { id, type: kind, circleId, payload, ts, silent: true };
      entries.push(entry);
      return entry;
    },
  };
}

describe('governance, per self', () => {
  it("in W's circle W proposes, enacts and signs; the general persona's ref is on nothing", async () => {
    const generalKey = await AgentIdentity.generate(new VaultMemory());
    const wKey = await AgentIdentity.generate(new VaultMemory());
    const rosters = {
      [X]: [{ webid: GENERAL, role: 'admin', circleAddress: generalKey.pubKey }, { webid: 'webid:bram', role: 'member' }],
      [Y]: [{ webid: W, role: 'admin', circleAddress: wKey.pubKey }, { webid: 'webid:mel', role: 'member' }],
    };
    const removed = [];
    const callSkill = async (origin, op, args) => {
      if (op === 'listGroupMembers') return { members: rosters[args.groupId] ?? [] };
      if (op === 'listGroupRoster') return { members: rosters[args.groupId] ?? [] };
      if (op === 'removeMember') { removed.push([args.groupId, args.memberWebid]); return { ok: true }; }
      return {};
    };
    const eventLog = fakeEventLog();
    const gov = bindCircleGovernance({
      eventLog, callSkill,
      getPolicy: async () => ({ governance: { removeMember: 'any-admin' } }),
      // what the shells hand in now: the self of each circle (the agent's `circleSelf(cid).webid`)
      myRef: (cid) => (cid === Y ? W : GENERAL),
      genId: (() => { let n = 0; return () => `p-${n += 1}`; })(),
      circleIdentityFor: async (cid) => (cid === Y ? wKey : generalKey),
    });

    // the shell names the GENERAL ref as the actor, as the shells did — the self of the circle decides, not the caller
    await gov.propose({ circleId: Y, action: 'removeMember', subject: 'webid:mel', actor: { ref: GENERAL, role: 'admin' } });
    expect(removed, "W, Y's admin, enacted in Y").toEqual([[Y, 'webid:mel']]);
    expect(await gov.iAmAdmin?.(Y) ?? true, "W is Y's admin").toBe(true);
    const inY = eventLog.entries.filter((e) => e.type === GOVERNANCE_KIND && e.circleId === Y);
    expect(inY.length).toBeGreaterThan(0);
    for (const e of inY) {
      expect(e.payload.body.author, "signed by W's per-circle key").toBe(wKey.pubKey);
      expect(e.payload.body.payload.authorRef, 'naming W').toBe(W);
    }
    expect(JSON.stringify(inY).includes(`"${GENERAL}"`), "the general persona's ref is on nothing in Y").toBe(false);
    expect(JSON.stringify(inY).includes(generalKey.pubKey), "nor the general persona's key").toBe(false);

    // in X, the general self, as before
    await gov.propose({ circleId: X, action: 'removeMember', subject: 'webid:bram', actor: { ref: GENERAL, role: 'admin' } });
    expect(removed).toEqual([[Y, 'webid:mel'], [X, 'webid:bram']]);
    for (const e of eventLog.entries.filter((x) => x.type === GOVERNANCE_KIND && x.circleId === X)) expect(e.payload.body.payload.authorRef).toBe(GENERAL);
  });
});
