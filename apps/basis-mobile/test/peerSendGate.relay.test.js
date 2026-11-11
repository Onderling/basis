/**
 * THE SEND GATE, CROSSED — a send to a member's per-circle address is circle traffic whether or not the caller says so.
 *
 * Before the gate, the circle travelled as an optional extra (`circleId`) beside a raw address, and any of ~40 callers
 * could forget it. Such a send left unscoped and signed with the canonical key: the member's device refused it (inside a
 * circle only the per-circle key may speak), or a transport that cannot carry per-circle addresses (live NKN) carried it
 * into the void. `peerSend` (realAgent) asks the roster index once: the address names its circle.
 *
 * Two phones (test/support/mobileNode.js) with NKN UP and accepting sends (`liveNknStub`), so a wrong route WOULD win.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { startJourneyRelay } from '../../basis/test/support/testRelay.js';
import { createCircle, joinExistingCircle } from '../../basis/test/support/pairRealAgents.js';
import { bootMobileNode, liveNknStub } from './support/mobileNode.js';

const G = 'gate-circle';
const until = async (pred, ms = 15_000) => {
  const t0 = Date.now();
  while (!(await pred())) { if (Date.now() - t0 > ms) return false; await new Promise((r) => { setTimeout(r, 100); }); }
  return true;
};

describe('the send gate: what the device knows decides the route', () => {
  let relay; let anna; let bob; let nknA; let nknB;
  beforeAll(async () => {
    relay = await startJourneyRelay();
    nknA = liveNknStub(); nknB = liveNknStub();
    anna = await bootMobileNode({ name: 'anna', relayUrl: relay.url, nknLib: nknA });
    bob = await bootMobileNode({ name: 'bob', relayUrl: relay.url, nknLib: nknB });
    bob.sendPeerRedeem = bob.bundle.sendPeerRedeem;
    await createCircle(anna, { groupId: G, name: 'Straat' });
    const j = await joinExistingCircle(anna, bob, { groupId: G, handle: 'bob' });
    if (!j.joined?.ok) throw new Error(`join failed: ${JSON.stringify(j.joined)}`);
    await anna.bundle.registerCirclePresence?.([G]);
    await bob.bundle.registerCirclePresence?.([G]);
    await anna.openCircle(G); await bob.openCircle(G);
  }, 120_000);
  afterAll(async () => { await anna?.dispose(); await bob?.dispose(); await relay?.close(); });

  it('a send to Anna\'s circle address that names NO circle leaves as Bob\'s circle self over the circle\'s relay, and lands', async () => {
    const annaInCircle = anna.agent.circleAddressFor(G);
    expect(annaInCircle, 'Anna has no circle address').toBeTruthy();
    const res = await bob.agent.sendPeerMessage(annaInCircle, { subtype: 'gate-probe', n: 1 });
    const landed = await until(() => anna.landed.unrouted.some((e) => e?.payload?.subtype === 'gate-probe' && e.payload.n === 1));
    expect(nknB.sent, 'Bob\'s send rode NKN').toEqual([]);
    expect(landed, `the probe did not land with Anna; result ${JSON.stringify(res)}; Anna refused ${JSON.stringify(anna.agent.inboundRefusals?.())}`).toBe(true);
    // the ONE decision record, in Bob's own copy-log door (what a person would hand over): codes only
    const text = bob.copyLog();
    const lines = text.split('\n').filter((l) => l.includes('agent/send.decision') && l.includes('"kind":"circle-member"'));
    expect(lines.length, `no circle-member decision in the copy-log text; decision lines: ${text.split('\n').filter((l) => l.includes('send.decision')).slice(-5).join(' | ')}`).toBeGreaterThanOrEqual(1);
    const rec = JSON.parse(lines.at(-1).slice(lines.at(-1).indexOf('{')));
    expect(rec).toMatchObject({ kind: 'circle-member', scope: 'circle', reason: 'roster-hit', chosen: 'relay', outcome: 'delivered' });
    expect(text).not.toContain(annaInCircle.slice(0, 16));
    expect(text).not.toContain(G);
    expect(text).not.toContain('ws://');
  }, 60_000);

  it('a caller that names ANOTHER circle for a member\'s circle address is refused, and nothing leaves', async () => {
    const annaInCircle = anna.agent.circleAddressFor(G);
    const relaySentBefore = nknB.sent.length;
    const res = await bob.agent.sendPeerMessage(annaInCircle, { subtype: 'gate-probe', n: 2 }, { circleId: 'some-other-circle' });
    expect(res).toMatchObject({ held: false, delivered: false, reason: 'circle-mismatch' });
    expect(nknB.sent.length).toBe(relaySentBefore);
    const landed = await until(() => anna.landed.unrouted.some((e) => e?.payload?.n === 2), 1500);
    expect(landed).toBe(false);
  }, 30_000);

  // THE PERSON KEY'S ALLOWLIST, recorded (not yet enforced): every person-path send says which entry let it through.
  const personDecisions = (node) => node.copyLog().split('\n')
    .filter((l) => l.includes('agent/send.decision') && l.includes('"kind":"person"'))
    .map((l) => JSON.parse(l.slice(l.indexOf('{'))));

  it('the join\'s two person-key sends are the invite exchange: Bob\'s request as the joiner, Anna\'s one answer', () => {
    expect(personDecisions(bob).some((r) => r.allowedBy === 'invite-exchange' && r.side === 'joiner'),
      `Bob's person decisions: ${JSON.stringify(personDecisions(bob))}`).toBe(true);
    expect(personDecisions(anna).some((r) => r.allowedBy === 'invite-exchange' && r.side === 'answer'),
      `Anna's person decisions: ${JSON.stringify(personDecisions(anna))}`).toBe(true);
  });

  it('a person-path send to a co-member\'s person key, kept nowhere as a contact, is recorded as allowedBy none', async () => {
    // Anna's person key: Bob reaches it (the join bound it), but holds it as no contact, no invite, no fallback. (A send to
    // an address NOBODY has registered never settles and writes no record, before this change too: a pass-2 blind spot.)
    const before = personDecisions(bob).length;
    await bob.agent.sendPeerMessage(anna.pubKey, { subtype: 'gate-probe', n: 3 }, { guarantee: 'now' }).catch(() => {});
    await until(() => personDecisions(bob).length > before, 10_000);
    const fresh = personDecisions(bob).slice(before);
    expect(fresh.at(-1), `no new person decision: ${JSON.stringify(fresh)}`).toMatchObject({ kind: 'person', allowedBy: 'none' });
  }, 30_000);
});
