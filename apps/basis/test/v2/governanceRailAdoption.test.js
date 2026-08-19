import { describe, it, expect } from 'vitest';
import { AgentIdentity } from '@onderling/core';
import { VaultMemory } from '@onderling/vault';
import { bindCircleGovernance, makeGovernanceRail } from '../../src/v2/governanceAppWiring.js';
import { makeCircleGovernancePeerHandler } from '../../src/v2/circleLogReceiver.js';
import { GOVERNANCE_KIND } from '../../src/v2/governanceLog.js';

// RAIL ADOPTION: bindCircleGovernance rides the rail when a circle signer resolves — a propose becomes a
// SIGNED circle-scoped statement on the device log, the fan carries the statement, and the receiving device's
// rail-aware handler VERIFIES it before it lands. An unsigned bare event is refused at a rail receiver
// (no-backcompat: one path per type). Legacy compositions (no signer) stay byte-identical.

const CIRCLE = 'circle:adopt';

function fakeEventLog() {
  const entries = [];
  const byId = new Set();
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

/** A device: own log, own circle identity, a roster-serving callSkill (binding rows for BOTH members). */
async function device(ref, rosterRows) {
  const circleId = await AgentIdentity.generate(new VaultMemory());
  const eventLog = fakeEventLog();
  const callSkill = async (origin, op) => {
    if (op === 'listGroupRoster') return { members: rosterRows.filter((m) => m.webid !== ref) };  // excludes caller
    if (op === 'removeMember') return { ok: true };
    return {};
  };
  return { ref, circleId, eventLog, callSkill };
}

describe('slice 1 adoption — governance rides the rail', () => {
  it('a propose lands as a SIGNED statement (circle key author, signed authorRef), fans the statement, and the fold sees it', async () => {
    const aliceId = await AgentIdentity.generate(new VaultMemory());
    const roster = [];   // rows filled after both identities exist
    const alice = { ref: 'webid:alice', circleId: aliceId, eventLog: fakeEventLog() };
    roster.push({ webid: alice.ref, role: 'admin', circleAddress: aliceId.pubKey });
    const fanned = [];
    const gov = bindCircleGovernance({
      eventLog: alice.eventLog,
      callSkill: async (o, op) => (op === 'listGroupRoster' ? { members: [] } : { ok: true }),
      getPolicy: async () => ({ admins: [alice.ref], governance: { removeMember: 'member-vote' } }),
      myRef: alice.ref,
      genId: () => 'prop-1',
      broadcast: (channel, circleId, event) => fanned.push({ channel, circleId, event }),
      circleIdentityFor: async () => aliceId,
    });
    expect(gov.rail).toBeTruthy();
    await gov.propose({ circleId: CIRCLE, action: 'removeMember', subject: 'webid:mel', actor: { ref: alice.ref, role: 'admin' } });

    const stored = alice.eventLog.entries.filter((e) => e.type === GOVERNANCE_KIND);
    expect(stored.length).toBeGreaterThan(0);
    for (const e of stored) {
      expect(e.payload.sig).toBeTruthy();                          // SIGNED — no unsigned governance lands
      expect(e.payload.body.author).toBe(aliceId.pubKey);          // the CIRCLE key, not the webid
      expect(e.payload.body.payload.authorRef).toBe(alice.ref);    // the signed binding claim
    }
    expect(fanned.length).toBeGreaterThan(0);
    expect(fanned[0].event.sig).toBeTruthy();                      // the fan carries the STATEMENT

    const ctx = await gov.getContext(CIRCLE);
    expect(ctx.events.length).toBeGreaterThan(0);                  // the verified read feeds the fold
  });

  it('two devices: the fanned signed statement passes bob\'s rail receiver (binding via roster) and folds on his device', async () => {
    const aliceCid = await AgentIdentity.generate(new VaultMemory());
    const bobCid   = await AgentIdentity.generate(new VaultMemory());
    const rosterAll = [
      { webid: 'webid:alice', role: 'admin',  circleAddress: aliceCid.pubKey },
      { webid: 'webid:bob',   role: 'member', circleAddress: bobCid.pubKey },
    ];
    const mkCallSkill = (me) => async (o, op) => (op === 'listGroupRoster'
      ? { members: rosterAll.filter((m) => m.webid !== me) } : { ok: true });

    const bobLog = fakeEventLog();
    const bobRail = makeGovernanceRail({
      eventLog: bobLog, circleIdentityFor: async () => bobCid, myRef: 'webid:bob', callSkill: mkCallSkill('webid:bob'),
    });
    const changes = [];
    const bobReceiver = makeCircleGovernancePeerHandler({ eventLog: bobLog, rail: bobRail, onChange: (cid) => changes.push(cid) });

    // Alice proposes on HER device; the fan delivers the signed statement to bob.
    const aliceLog = fakeEventLog();
    const fanned = [];
    const aliceGov = bindCircleGovernance({
      eventLog: aliceLog, callSkill: mkCallSkill('webid:alice'), getPolicy: async () => ({ admins: ['webid:alice'], governance: { removeMember: 'member-vote' } }),
      myRef: 'webid:alice', genId: () => 'prop-2',
      broadcast: (channel, circleId, event) => fanned.push({ circleId, event }),
      circleIdentityFor: async () => aliceCid,
    });
    await aliceGov.propose({ circleId: CIRCLE, action: 'removeMember', subject: 'webid:mel', actor: { ref: 'webid:alice', role: 'admin' } });
    for (const f of fanned) {
      await bobReceiver('peer:alice', { subtype: 'circle-governance-broadcast', circleId: f.circleId, event: f.event });
    }
    expect(bobLog.entries.length).toBe(fanned.length);             // verified + landed (binding via roster row)
    expect(changes).toContain(CIRCLE);

    // Bob's own governance handle folds the ingested statements.
    const bobGov = bindCircleGovernance({
      eventLog: bobLog, callSkill: mkCallSkill('webid:bob'), getPolicy: async () => ({ admins: ['webid:alice'], governance: { removeMember: 'member-vote' } }),
      myRef: 'webid:bob', genId: () => 'x', circleIdentityFor: async () => bobCid,
    });
    const ctx = await bobGov.getContext(CIRCLE);
    expect(ctx.events.length).toBeGreaterThan(0);                  // bob's verified read sees alice's propose
  });

  it('a bare UNSIGNED event is refused at a rail receiver — nothing lands, nobody is notified', async () => {
    const bobCid = await AgentIdentity.generate(new VaultMemory());
    const bobLog = fakeEventLog();
    const bobRail = makeGovernanceRail({
      eventLog: bobLog, circleIdentityFor: async () => bobCid, myRef: 'webid:bob',
      callSkill: async () => ({ members: [] }),
    });
    const notified = [];
    const receiver = makeCircleGovernancePeerHandler({ eventLog: bobLog, rail: bobRail, notify: (c, e) => notified.push(e) });
    await receiver('peer:x', {
      subtype: 'circle-governance-broadcast', circleId: CIRCLE,
      event: { kind: 'governance', event: 'propose', proposalId: 'p9', action: 'removeMember', by: 'webid:x', at: 1 },
    });
    expect(bobLog.entries).toHaveLength(0);
    expect(notified).toHaveLength(0);
  });

  it('a composition WITHOUT circleIdentityFor is refused at bind — the unsigned legacy path is deleted', async () => {
    expect(() => bindCircleGovernance({
      eventLog: fakeEventLog(), callSkill: async () => ({ members: [] }),
      getPolicy: async () => ({}), myRef: 'webid:a', genId: () => 'prop-3',
    })).toThrow(/circleIdentityFor is required/);
  });
});

describe('the settings-consensus cutover — changePolicy on the log', () => {
  it('a multi-admin settings patch opens a changePolicy proposal; the co-admin\'s vote enacts it via the wired setPolicy', async () => {
    const aliceCid = await AgentIdentity.generate(new VaultMemory());
    const bobCid   = await AgentIdentity.generate(new VaultMemory());
    const rosterAll = [
      { webid: 'webid:alice', role: 'admin', circleAddress: aliceCid.pubKey },
      { webid: 'webid:bob',   role: 'admin', circleAddress: bobCid.pubKey },
    ];
    const mkCallSkill = (me) => async (o, op) => (op === 'listGroupRoster'
      ? { members: rosterAll.filter((m) => m.webid !== me) } : { ok: true });
    const policy = { admins: ['webid:alice', 'webid:bob'], consensusRequired: true, governance: { changePolicy: 'admin-quorum' } };
    const applied = [];
    // ONE shared log stands in for the fan (both admins' devices see the same events).
    const log = fakeEventLog();
    const mkGov = (me, cid) => bindCircleGovernance({
      eventLog: log, callSkill: mkCallSkill(me), getPolicy: async () => policy,
      myRef: me, genId: () => 'prop-set-1', circleIdentityFor: async () => cid,
      setPolicy: async (circleId, patch) => { applied.push({ circleId, patch }); return { ok: true }; },
    });
    const aliceGov = mkGov('webid:alice', aliceCid);
    const bobGov   = mkGov('webid:bob', bobCid);

    const patch = { theme: 'dark', consensusRequired: true, admins: policy.admins };
    await aliceGov.propose({ circleId: CIRCLE, action: 'changePolicy', subject: patch, actor: { ref: 'webid:alice', role: 'admin' } });
    expect(applied).toHaveLength(0);                                    // quorum not reached — nothing applied

    // Alice votes yes (the proposer's vote), then bob's yes completes the admin quorum → tally enacts.
    await aliceGov.vote({ circleId: CIRCLE, proposalId: 'prop-set-1', voter: 'webid:alice', choice: 'yes' });
    await bobGov.vote({ circleId: CIRCLE, proposalId: 'prop-set-1', voter: 'webid:bob', choice: 'yes' });
    expect(applied.length).toBeGreaterThan(0);                          // the enactor applied the patch
    expect(applied[0].patch).toEqual(patch);
    // Every stored governance entry is a SIGNED statement — the side-store is gone, the log is the record.
    for (const e of log.entries.filter((x) => x.type === 'governance')) expect(e.payload.sig).toBeTruthy();
  });
});
