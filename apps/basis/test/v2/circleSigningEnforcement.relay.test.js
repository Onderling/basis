/**
 * END-TO-END: per-circle signing is ENFORCED, not merely preferred — over a REAL relay, REAL sockets
 * and the REAL production send path (B6).
 *
 * ── What was wrong ──────────────────────────────────────────────────────────────────────────────
 * The roster authorize recorded BOTH keys a member's row carries: their per-circle signing key and
 * their canonical identity key. So a member who simply kept signing canonically was accepted, and
 * the cross-circle unlinkability decisions 1 and 4 exist to provide was the polite option rather
 * than a property of the system. "Prefers per-circle signing" and "enforces it" are the same code
 * until someone declines.
 *
 * ── What is enforced now, and why it needs no flag day ──────────────────────────────────────────
 * Per MEMBER, from their own roster row: a row carrying a PROVEN per-circle address means that
 * member has demonstrated they can sign per-circle, so their canonical key is refused from then on.
 * A row with no proof keeps its canonical key — refusing it would make that member silent rather
 * than pseudonymous — and is counted as the transitional set. Nothing is switched on anywhere.
 *
 * ── Why this test is shaped the way it is ───────────────────────────────────────────────────────
 * The unit tests next door construct the snapshot directly, so they would all pass with the feed
 * disconnected — the exact failure Decision 3 shipped. Here the ONLY thing done by hand is choosing
 * which of a real member's real addresses to send FROM: `agent.sendPeerMessage(peerAddress, …)`
 * carries no `sendAs`, so it is signed by that agent's canonical identity, which is precisely the
 * member-declines-to-use-per-circle-signing case. Everything else — the join, the proofs, the
 * roster, the relay, the seal, the refusal — is production code.
 *
 * `primeCircleSecurity` is called explicitly because it is the BOOT step both shells run and the
 * harness deliberately does not: the whole self-healing claim rests on it, so a test that skipped it
 * would be asserting a property nobody has.
 *
 * The founder is tested first and separately, because they are the one member who never redeems
 * anything and were therefore the likeliest permanent exception to an enforcement built on join
 * proofs. Two devices' views of them are checked, because they differ.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { startRelay } from '../../../../packages/relay/src/server.js';
import {
  bootRealAgentNode, connectNodesOverRelay, createCircle, joinExistingCircle,
  bindCircleAddresses, readRoster, until, teardown,
} from '../support/pairRealAgents.js';
import { bindCircleAddressKeysFor } from '../../src/v2/householdRosterPairing.js';
import { primeCircleSecurity, announceCircleAddresses } from '../../src/v2/circleSecurityPriming.js';

const CIRCLE_A = 'buurt-signing-enforced';
const CIRCLE_B = 'koor-signing-enforced';
const rnd = () => Math.random().toString(36).slice(2, 8);
const settle = (ms = 1200) => new Promise((r) => setTimeout(r, ms));

/** The two steps every shell performs after a join (`makeCircleReachable` + the harness half). */
async function settleMember(node, circleId) {
  await bindCircleAddresses([node], circleId);
  await bindCircleAddressKeysFor({ agent: node.agent, circleId });
}

/** The BOOT step — what a shell runs, and what heals a row that proves no address. */
// BOTH steps, in the shells' order — priming installs identities and rosters, and only AFTER the alias
// is bound does the device announce. Modelling boot as the primer alone made this file pass while the
// real shells failed: the announcement went out signed by the canonical key and every recipient refused
// it (measured 2026-08-02, three-party run). A boot helper that does less than boot is a test that
// agrees with itself.
const boot = async (node) => {
  const primed = await primeCircleSecurity({ agent: node.agent, onWarn: () => {} });
  const spoke = await announceCircleAddresses({ agent: node.agent, onWarn: () => {} });
  // one object, so callers keep reading `addressesAnnounced` as they did when the primer announced
  return { ...primed, addressesAnnounced: spoke.announced };
};

const rowFor = (roster, webid) => roster.find((m) => m?.webid === webid) ?? null;

/** A conforming `kring-chat-message` wire envelope — the shape the real fan produces. */
const chatEnvelope = (circleId, text) => ({
  type: 'p2p-chat', subtype: 'kring-chat-message',
  circleId, msgId: `m-${rnd()}`, ts: Date.now(), text, fromActor: 'test',
});

describe('per-circle signing is enforced per member (real relay, fallback OFF)', () => {
  let relay; let relayUrl;
  let admin; let bram; let cato;

  beforeAll(async () => {
    relay = await startRelay({ port: 0, log: false });
    relayUrl = `ws://127.0.0.1:${relay.port}`;

    // "Rather undeliverable than routed over my one global key" — the product's private default.
    // With the fallback ON, a member whose per-circle address is unknown is quietly reached at their
    // global one, and half of what this file asserts would be true for the wrong reason.
    const opts = { agentOpts: { allowAddressFallback: false } };
    [admin, bram, cato] = await Promise.all([
      bootRealAgentNode('admin', opts), bootRealAgentNode('bram', opts), bootRealAgentNode('cato', opts),
    ]);
    await connectNodesOverRelay([admin, bram, cato], { relayUrl });

    // Circle A: admin + bram. Circle B: admin + cato. Two circles with ONE member in common is the
    // arrangement the cross-circle assertion needs — bram and cato are strangers to each other's.
    // NOBODY boots here: the first tests are about the state a join alone leaves behind.
    await createCircle(admin, { groupId: CIRCLE_A, name: 'Buurt (enforced)' });
    await settleMember(admin, CIRCLE_A);
    const joinedB = await joinExistingCircle(admin, bram, { groupId: CIRCLE_A, handle: 'bram' });
    expect(joinedB.joined.ok, 'bram joined circle A').toBe(true);
    await settleMember(bram, CIRCLE_A);
    await settleMember(admin, CIRCLE_A);

    await createCircle(admin, { groupId: CIRCLE_B, name: 'Koor (enforced)' });
    await settleMember(admin, CIRCLE_B);
    const joinedC = await joinExistingCircle(admin, cato, { groupId: CIRCLE_B, handle: 'cato' });
    expect(joinedC.joined.ok, 'cato joined circle B').toBe(true);
    await settleMember(cato, CIRCLE_B);
    await settleMember(admin, CIRCLE_B);
  }, 120000);

  afterAll(async () => {
    try { await teardown(admin, bram, cato); } catch { /* best-effort */ }
    try { await relay?.stop(); } catch { /* best-effort */ }
  });

  /* ── The founder ─────────────────────────────────────────────────────────────────────────── */

  it('THE FOUNDER: their own row proves no address — they never redeemed anything', async () => {
    // The reason to check rather than assume. Enforcement is built on a proof captured at JOIN, and
    // the circle's creator never joins: `deriveRoster` supplies founders separately, with no keys at
    // all. If nothing healed this, the founder would be the one member permanently allowed to speak
    // canonically — an enforcement with a hole shaped exactly like whoever made the circle.
    const own = rowFor(await readRoster(admin, CIRCLE_A), admin.pubKey);
    expect(own, 'the founder is on their own roster').toBeTruthy();
    expect(own.circleAddressProof, 'and has proved nothing about their address yet').toBeFalsy();
  });

  it('THE FOUNDER: a joiner nonetheless holds them PROVEN — the redeem response carried it', async () => {
    // The half that was already closed (2026-07-30): the admin's proven per-circle address rides
    // back on the redeem response and is verified before it is written. So on the device where it
    // MATTERS — the other member's, which is the one that authorizes the founder's envelopes — the
    // founder is proven from the moment of the join, and is not an exception at all. The gap is in
    // the founder's own VIEW OF THEMSELVES, which nothing authorizes anything against.
    const asBramSeesThem = rowFor(await readRoster(bram, CIRCLE_A), admin.pubKey);
    expect(asBramSeesThem, 'bram knows the admin').toBeTruthy();
    expect(asBramSeesThem.circleAddress).toBe(admin.agent.circleAddressFor(CIRCLE_A));
    expect(typeof asBramSeesThem.circleAddressProof, 'proven, not claimed').toBe('string');
  });

  /* ── The joiner's own row: NO transition — proven at redeem ───────────────────────────────────
   *
   * This scenario USED to demonstrate a transitional "canonical-only" window: `recordRemoteRedemption`
   * wrote neither a signing key nor an address onto the joiner's OWN row, so that row was left-joined
   * a stray display-cache `pubKey` — NOT the joiner's circle-chat identity — and counted as a member
   * allowed by a canonical key alone until a later boot healed it. The joiner's-row-complete-at-redeem
   * change closed that window: the mirror now writes the joiner's own real `signingPublicKey` (their
   * chat identity) the moment they redeem. So the own row is recognised as SELF from the join, never
   * as a stray canonical key — the canonical-only set is zero without waiting for a boot. (The old
   * tests predicted exactly this and said "rewrite the demo, do not relax it".)
   */

  it("THE JOINER'S OWN ROW carries their real signing key AT REDEEM — no canonical-only window", async () => {
    const own = rowFor(await readRoster(bram, CIRCLE_A), bram.pubKey);
    expect(own, 'bram is on his own roster').toBeTruthy();
    // The batch that closed the window: the joiner's own row records THEIR chat identity at redeem
    // (projected onto `pubKey`), not a stray display-cache key. That is why it is recognised as self,
    // not as a canonical member.
    expect(own.pubKey, "his own row records HIS signing key, written at redeem").toBe(bram.pubKey);
    // …so nothing on his device authorizes by a canonical key alone — enforcement is total from the join.
    expect(bram.agent.circleSenderAuthorization().canonicalOnlyMembers,
      'no member allowed by a canonical key alone — the transition is already over at redeem').toBe(0);
  });

  it('BOOTING is idempotent for the joiner — the announce heals the ADDRESS, the count stays zero', async () => {
    // The self-healing announce still runs (this join presented no per-circle address, so the boot is
    // where the address+proof land on the own row). But the canonical-only set was already zero at
    // redeem and stays zero — a boot has nothing to fix about who may sign.
    expect(bram.agent.circleSenderAuthorization().canonicalOnlyMembers).toBe(0);

    await boot(bram);
    const own = await until(async () => {
      const row = rowFor(await readRoster(bram, CIRCLE_A), bram.pubKey);
      return row?.circleAddressProof ? row : null;
    }, { timeout: 10000 });
    expect(own.circleAddress).toBe(bram.agent.circleAddressFor(CIRCLE_A));

    await bindCircleAddressKeysFor({ agent: bram.agent, circleId: CIRCLE_A });
    expect(bram.agent.circleSenderAuthorization().canonicalOnlyMembers,
      'still zero — the row was self from the join; the boot only proved the address').toBe(0);
  }, 60000);

  it('THE FOUNDER: their own row SELF-HEALS the same way, through B2\'s re-announce', async () => {
    // `primeCircleSecurity` step 3 diffs each circle's own roster row against the address this
    // device derives and announces when they disagree — which for a founder they always do, on the
    // first boot after they created the circle. No founder-specific code path exists or is wanted.
    const primed = await boot(admin);
    expect(primed.circleIds, 'both circles were primed').toEqual(expect.arrayContaining([CIRCLE_A, CIRCLE_B]));
    expect(primed.addressesAnnounced, 'the founder had something to say in both').toBeGreaterThanOrEqual(2);

    for (const circleId of [CIRCLE_A, CIRCLE_B]) {
      const own = await until(async () => {
        const row = rowFor(await readRoster(admin, circleId), admin.pubKey);
        return row?.circleAddressProof ? row : null;
      }, { timeout: 10000 });
      expect(own.circleAddress, `the founder's own row in ${circleId}`)
        .toBe(admin.agent.circleAddressFor(circleId));
    }

    // Re-running is silent: the diff is now satisfied, so the steady state is no traffic at all.
    const again = await boot(admin);
    expect(again.addressesAnnounced, 'a healed founder does not re-announce every boot').toBe(0);
  }, 60000);

  it('AFTER BOOT the transitional set is empty on every device — enforcement is total here', async () => {
    // How big the transition is IN PRACTICE, for circles formed by today's code and devices that
    // have booted once: zero. Every member is then held to per-circle signing, with no exception
    // for the founder, the joiner, or anyone else.
    await boot(cato);
    await settle(1500);
    for (const [node, circles] of [[admin, [CIRCLE_A, CIRCLE_B]], [bram, [CIRCLE_A]], [cato, [CIRCLE_B]]]) {
      for (const c of circles) await bindCircleAddressKeysFor({ agent: node.agent, circleId: c });
      const status = node.agent.circleSenderAuthorization();
      expect(status.installed, `${node.label}: the authorizer is installed`).toBe(true);
      expect(status.canonicalOnlyMembers, `${node.label}: members allowed by canonical key alone`).toBe(0);
    }
  }, 60000);

  /* ── The positive control, before the adversarial ones ───────────────────────────────────── */

  it('POSITIVE CONTROL: the circle\'s real traffic still arrives, signed per-circle', async () => {
    // A check that refuses everything is not a check, it is an outage — and every assertion below
    // would pass in one.
    const text = `real-traffic-${rnd()}`;
    const fan = await admin.agent.callSkill('stoop', 'broadcastKringMessage', {
      groupId: CIRCLE_A, msgId: `m-${rnd()}`, text,
    });
    expect(fan.errors, `fan reported errors: ${JSON.stringify(fan.errors)}`).toEqual([]);
    await until(() => bram.chatEvents.some((e) => e?.payload?.text === text), { timeout: 15000 });
    expect(bram.chatEvents.some((e) => e?.payload?.text === text)).toBe(true);
  }, 30000);

  /* ── Adversarial ─────────────────────────────────────────────────────────────────────────── */

  it('ADVERSARIAL: a MEMBER signing canonically at a per-circle address is REFUSED', async () => {
    // The change, proved. `sendPeerMessage` carries no `sendAs`, so this envelope is signed by the
    // admin's canonical identity — a real member of this circle, declining per-circle signing, on
    // the real send path. Every cryptographic check passes; the roster refuses it anyway, because
    // that member has proved they can sign per-circle and the leak is therefore not on offer.
    const bramInA = bram.agent.circleAddressFor(CIRCLE_A);
    expect(typeof bramInA).toBe('string');

    const before = bram.agent.circleSenderAuthorization();
    const text = `canonical-in-circle-${rnd()}`;
    await admin.agent.sendPeerMessage(bramInA, chatEnvelope(CIRCLE_A, text));
    await settle(1500);

    const after = bram.agent.circleSenderAuthorization();
    // A FLOOR, not an exact figure: a refused envelope is never acknowledged, so the sender's own
    // retry/handshake machinery may present it more than once. Measured: the first refusal against
    // a peer costs two, every later one costs one. Asserting equality would be asserting a property
    // of the retry policy, which is not what this test is about.
    expect(after.refusedCanonicalSigners, 'refused, and named as a member\'s canonical key')
      .toBeGreaterThanOrEqual(before.refusedCanonicalSigners + 1);
    expect(after.refusedStrangers, 'and NOT confused with a stranger — the responses differ')
      .toBe(before.refusedStrangers);
    expect(bram.chatEvents.some((e) => e?.payload?.text === text),
      'it never reached the application at all').toBe(false);
  }, 30000);

  it('ADVERSARIAL: a member of circle A is a STRANGER in circle B, whichever key they use', async () => {
    // Per-circle snapshots. Bram is a real member with real keys and a real relay connection — in
    // another circle. Learning cato's per-circle address is the enumeration surface the design names
    // (an address is public once seen), so this hands it to bram directly rather than pretending
    // that knowing it is hard.
    const catoInB = cato.agent.circleAddressFor(CIRCLE_B);
    expect(typeof catoInB).toBe('string');
    bram.agent.registerPeerAddress(catoInB, cato.pubKey, { signingKey: catoInB });

    const before = cato.agent.circleSenderAuthorization();
    const text = `wrong-circle-${rnd()}`;
    await bram.agent.sendPeerMessage(catoInB, chatEnvelope(CIRCLE_B, text));
    await settle(1500);

    const after = cato.agent.circleSenderAuthorization();
    expect(after.refusedStrangers, 'refused as a stranger to circle B')
      .toBeGreaterThanOrEqual(before.refusedStrangers + 1);
    expect(cato.chatEvents.some((e) => e?.payload?.text === text)).toBe(false);
  }, 30000);

  it('ADVERSARIAL: …and the same member is still perfectly welcome in circle A', async () => {
    // The other half of "per circle": the refusal above must be about the circle, not about bram.
    const text = `still-welcome-${rnd()}`;
    const fan = await bram.agent.callSkill('stoop', 'broadcastKringMessage', {
      groupId: CIRCLE_A, msgId: `m-${rnd()}`, text,
    });
    expect(fan.errors).toEqual([]);
    await until(() => admin.chatEvents.some((e) => e?.payload?.text === text), { timeout: 15000 });
    expect(admin.chatEvents.some((e) => e?.payload?.text === text)).toBe(true);
  }, 30000);
});
