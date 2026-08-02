/**
 * END-TO-END: two JOINERS reach each other in a three-member circle, over a REAL relay and REAL
 * sockets, with the global-address fallback OFF (B2).
 *
 * ── What was broken ─────────────────────────────────────────────────────────────────────────────
 * Per-circle addressing gives every member a different address in every circle, and a join teaches
 * exactly two devices about each other: the joiner proves its address to the admin, and the admin's
 * proven address rides back on the redeem response. Nothing taught two JOINERS each other's. So the
 * admin kept working and joiner↔joiner either fell back to each member's one global signing key —
 * the linkability the whole feature exists to remove — or, with the per-user fallback off (the
 * private default), was refused outright. To a person that is "messages sometimes don't arrive".
 *
 * ── Why this test is shaped the way it is ───────────────────────────────────────────────────────
 * Every piece of this has unit tests on both sides of every seam, and all of them passed while the
 * hole was open. So this boots THREE real app agents on a real relay, drives two real joins through
 * the real peer bridge, and then makes one joiner send to the other through the real fan — and it
 * does it with `allowAddressFallback: false`, so a member whose per-circle address is unknown is
 * NOT quietly reached over their global key. With the fallback on, this test passes even when the
 * announcement never happens, which is exactly how this class of bug survives.
 *
 * The re-announce case is here too, because it is the same operation (Q1, "re-prove in place") and
 * because the risk in it is invisible: an announcement that updates addressing but not the
 * boundary-authentication snapshot leaves a member reachable and then REFUSED — failing after
 * appearing to work. Delivery after a re-announce is the only assertion that covers both halves,
 * since a refused envelope simply never surfaces.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { startRelay } from '../../../../packages/relay/src/server.js';
import {
  bootRealAgentNode, connectNodesOverRelay, createCircle, joinExistingCircle,
  bindCircleAddresses, readRoster, until, teardown,
} from '../support/pairRealAgents.js';
import { bindCircleAddressKeysFor } from '../../src/v2/householdRosterPairing.js';
import { announceOwnCircleAddress } from '../../src/v2/circleAddressAnnounce.js';

const GROUP = 'buurt-joiner-addressing';
const rnd = () => Math.random().toString(36).slice(2, 8);

/** The two steps every shell performs after a join (`makeCircleReachable` + the harness half). */
async function settleMember(node, circleId) {
  await bindCircleAddresses([node], circleId);
  await bindCircleAddressKeysFor({ agent: node.agent, circleId });
}

const rowFor = (roster, webid) => roster.find((m) => m?.webid === webid) ?? null;

describe('joiner ↔ joiner addressing in a three-member circle (real relay, fallback OFF)', () => {
  let relay; let relayUrl;
  let admin; let bram; let cato;

  beforeAll(async () => {
    relay = await startRelay({ port: 0, log: false });
    relayUrl = `ws://127.0.0.1:${relay.port}`;

    // The setting this test exists to honour. `false` = "rather undeliverable than routed over my
    // one global key" — the product's private default.
    const opts = { agentOpts: { allowAddressFallback: false } };
    [admin, bram, cato] = await Promise.all([
      bootRealAgentNode('admin', opts), bootRealAgentNode('bram', opts), bootRealAgentNode('cato', opts),
    ]);
    await connectNodesOverRelay([admin, bram, cato], { relayUrl });

    await createCircle(admin, { groupId: GROUP, name: 'Buurt (addressing)' });
    await settleMember(admin, GROUP);

    const joinedB = await joinExistingCircle(admin, bram, { groupId: GROUP, handle: 'bram' });
    expect(joinedB.joined.ok, 'bram joined').toBe(true);
    await settleMember(bram, GROUP);

    const joinedC = await joinExistingCircle(admin, cato, { groupId: GROUP, handle: 'cato' });
    expect(joinedC.joined.ok, 'cato joined').toBe(true);
    await settleMember(cato, GROUP);

    // The admin's post-join propagation is fire-and-forget (a failed announcement must never fail a
    // join), so wait for the fact to land rather than for a promise.
    await until(async () => rowFor(await readRoster(bram, GROUP), cato.pubKey)?.circleAddress,
      { timeout: 15000 });
    await until(async () => rowFor(await readRoster(cato, GROUP), bram.pubKey)?.circleAddress,
      { timeout: 15000 });
    // …and both must then BIND what they learned, which is what the receive handler does; re-running
    // it here is idempotent and makes the wait above the only timing this test depends on.
    await bindCircleAddressKeysFor({ agent: bram.agent, circleId: GROUP });
    await bindCircleAddressKeysFor({ agent: cato.agent, circleId: GROUP });
  }, 90000);

  afterAll(async () => {
    try { await teardown(admin, bram, cato); } catch { /* best-effort */ }
    try { await relay?.stop(); } catch { /* best-effort */ }
  });

  it('each joiner holds the OTHER joiner\'s per-circle address — the exact one that device derives', async () => {
    const onBram = rowFor(await readRoster(bram, GROUP), cato.pubKey);
    const onCato = rowFor(await readRoster(cato, GROUP), bram.pubKey);

    expect(onBram, 'bram sees cato at all').toBeTruthy();
    expect(onCato, 'cato sees bram at all').toBeTruthy();
    // Anything other than the address the peer itself derives would mean a claim was recorded rather
    // than a proof — the one failure this whole mechanism is built to make impossible.
    expect(onBram.circleAddress).toBe(cato.agent.circleAddressFor(GROUP));
    expect(onCato.circleAddress).toBe(bram.agent.circleAddressFor(GROUP));
    // …and the key it must be bound to, or `bindCircleAddressKeys` silently skips the row and the
    // address is recorded but unusable.
    expect(onBram.pubKey).toBe(cato.pubKey);
    expect(onCato.pubKey).toBe(bram.pubKey);
  });

  it('the fallback really is off — a member with no per-circle address would be UNREACHABLE, not downgraded', async () => {
    // The guard on the guard. If this resolves to an address, every assertion below would also pass
    // with the announcement removed, and the test would be decorative.
    const { resolveMemberAddress } = await import('../../../stoop/src/lib/memberAddress.js');
    const stranger = { webid: 'webid:someone', pubKey: 'a-perfectly-good-global-key' };
    const res = await resolveMemberAddress(stranger, {
      circleId: GROUP, preferCircleAddress: true, allowFallback: false,
    });
    expect(res.addr, 'no circle address ⇒ no address at all').toBeNull();
    expect(res.via).toBe('blocked-by-setting');
  });

  it('bram → cato: a circle message crosses joiner to joiner, without touching either global key', async () => {
    const text = `joiner-to-joiner-${rnd()}`;
    const fan = await bram.agent.callSkill('stoop', 'broadcastKringMessage', {
      groupId: GROUP, msgId: `m-${rnd()}`, text,
    });
    // Two recipients: the admin and the other joiner. A member the fan could not address would be an
    // `errors[]` entry with `recipient-pubkey-unknown` — which is exactly what the bug produced.
    expect(fan.errors, `fan reported errors: ${JSON.stringify(fan.errors)}`).toEqual([]);
    expect(fan.sent, 'both other members were reachable').toBe(2);

    await until(() => cato.chatEvents.some((e) => e?.payload?.text === text), { timeout: 15000 });
    expect(cato.chatEvents.some((e) => e?.payload?.text === text), 'cato received it').toBe(true);
  }, 30000);

  it('cato → bram: and the same in the other direction', async () => {
    const text = `back-again-${rnd()}`;
    const fan = await cato.agent.callSkill('stoop', 'broadcastKringMessage', {
      groupId: GROUP, msgId: `m-${rnd()}`, text,
    });
    expect(fan.errors).toEqual([]);
    expect(fan.sent).toBe(2);
    await until(() => bram.chatEvents.some((e) => e?.payload?.text === text), { timeout: 15000 });
    expect(bram.chatEvents.some((e) => e?.payload?.text === text), 'bram received it').toBe(true);
  }, 30000);

  it('a RE-ANNOUNCE is accepted, and the re-announcing member stays both reachable AND authorized', async () => {
    const before = rowFor(await readRoster(cato, GROUP), bram.pubKey);
    expect(before.circleAddress).toBe(bram.agent.circleAddressFor(GROUP));

    const res = await announceOwnCircleAddress({ agent: bram.agent, circleId: GROUP });
    expect(res.announced, 'bram could prove an address to announce').toBe(true);
    expect(res.sent, 'the re-announce reached the circle').toBeGreaterThanOrEqual(1);

    // Accepted, not merely tolerated: the row still names the address bram derives, and still carries
    // the proof (a row that lost its proof could no longer be relayed on to a future member).
    const after = await until(async () => {
      const row = rowFor(await readRoster(cato, GROUP), bram.pubKey);
      return row?.circleAddressProof ? row : null;
    }, { timeout: 10000 });
    expect(after.circleAddress).toBe(bram.agent.circleAddressFor(GROUP));
    expect(typeof after.circleAddressProof).toBe('string');

    // The half that is easy to get wrong. Recording an address refreshes the sealing binding AND the
    // roster snapshot that decides who may speak; if only the first had happened, bram would now be
    // addressable and then refused as a stranger (`SENDER_NOT_AUTHORIZED`) — and a refused envelope
    // is silent, so only a delivery assertion can tell the two apart.
    const text = `after-re-announce-${rnd()}`;
    const fan = await bram.agent.callSkill('stoop', 'broadcastKringMessage', {
      groupId: GROUP, msgId: `m-${rnd()}`, text,
    });
    expect(fan.errors).toEqual([]);
    await until(() => cato.chatEvents.some((e) => e?.payload?.text === text), { timeout: 15000 });
    expect(cato.chatEvents.some((e) => e?.payload?.text === text), 'cato still receives from bram').toBe(true);

    // And cato's own view of who may speak is still a real one, not the "no roster recorded, allow
    // everything" degradation — otherwise the delivery above would prove nothing about authorization.
    const status = cato.agent.circleSenderAuthorization();
    expect(status.installed).toBe(true);
    expect(status.circles).toBeGreaterThanOrEqual(1);
  }, 45000);
});
