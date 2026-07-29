/**
 * S6 · J-A6 / J-A8 / J-A11 / J-A14 — the expiry and flood attacks, walked 2026-07-29 from the desk.
 *
 * **These tests assert what the code does TODAY, and most of what they assert is WRONG.** They exist so the
 * findings are pinned somewhere that runs, and so that fixing any of them fails a test loudly rather than
 * silently changing behaviour nobody was watching. Each block says what the right behaviour would be.
 *
 * Walked with real agents (`test/support/pairRealAgents.js`) and the production room modules; the full write-up
 * is in the session results. Nothing here needs a radio: an attacker needs a saved invite URI, or the ability
 * to send a frame into a room, and every member of a circle has both.
 */
import { describe, it, expect } from 'vitest';
import { bootRealAgentNode, createCircle, teardown } from '../support/pairRealAgents.js';
import { buildCircleInviteUri } from '../../src/v2/circleInvite.js';
import { decodeInvite } from '../../src/core/wizards/joinGroupState.js';
import { createNearbyScreen } from '../../src/v2/nearbyScreen.js';
import { createAskChannel, ASK_MESSAGE } from '../../src/v2/nearbyAskChannel.js';
import { receiveCard, CARD_MESSAGE, CARD_MAX_LINE } from '../../src/v2/nearbyRoom.js';
import { receiveInvite, prepareBroadcastInvite, INVITE_MAX_NAME, BROADCAST_INVITE_MAX_TTL_MS } from '../../src/v2/nearbyInvites.js';

const MIN = 60_000;
const codeOf = (uri) => { const st = {}; decodeInvite(uri, st); return st.invite.code; };

/** Move the clock by a constant offset for one call. Real timers are untouched (only the reading moves). */
async function atClockOffset(ms, fn) {
  const real = Date.now;
  Date.now = () => real() + ms;
  try { return await fn(); } finally { Date.now = real; }
}

describe('J-A6 — the redeem gate does not know an invite was broadcast (ATTACK SUCCEEDS)', () => {
  it('accepts a code 16 minutes after the 15-minute broadcast ceiling, and after its OWN expiry', async () => {
    const admin = await bootRealAgentNode('inviteExpiryAdmin');
    try {
      const groupId = 'ceiling-walk';
      await createCircle(admin, { groupId, name: 'Ceiling walk' });
      const call = (app, op, args) => admin.agent.callSkill(app, op, args);
      const built = await buildCircleInviteUri({ callSkill: call, circleId: groupId, adminPeerAddr: admin.pubKey });
      const code = codeOf(built.uri);

      // The broadcast copy IS clamped to 15 minutes — that half is sound.
      const published = prepareBroadcastInvite({
        uri: built.uri, circleId: groupId, expiresAt: built.expiresAt, allows: { [groupId]: true },
      });
      expect(published.invite.expiresAt - Date.now()).toBeLessThanOrEqual(BROADCAST_INVITE_MAX_TTL_MS);

      const redeem = (label, offset) => atClockOffset(offset, () => call('stoop', 'verifyMembershipCodeForPeer', {
        groupId, code, requesterWebid: `walker-${label}`, peerDisplay: `walker${label}`,
      }));

      // WRONG: the broadcast ceiling has passed, and the redeem accepts anyway. The ceiling lives only in the
      // honest client's receive/actions layer (nearbyInvites.js); nothing carries it into the redeem, so a
      // saved URI is a standing key. RIGHT: the redeem refuses, and says the invite expired.
      expect((await redeem('16min', 16 * MIN)).redemptionId).toBeTruthy();

      // WRONG: the CODE's own expiry (1h by default) has passed too, and it still admits — the 24h grace
      // window in redeemMembershipCode / verifyMembershipCodeForPeer swallows it. RIGHT: an expired code is
      // expired; a hand-off grace window, if it is wanted, should not be the enforced life of every invite.
      expect((await redeem('2h', 2 * 60 * MIN)).redemptionId).toBeTruthy();

      // The only boundary that IS enforced: expiry + 24h.
      expect((await redeem('25h', 25 * 60 * MIN)).error).toBe('invalid-or-expired-code');
    } finally {
      await teardown(admin);
    }
  }, 60_000);
});

describe('J-A8 — rotating the membership code does not kill the old one (ATTACK SUCCEEDS)', () => {
  it('admits a holder of the rotated-away code for another 24 hours', async () => {
    const admin = await bootRealAgentNode('rotationWalkAdmin');
    try {
      const groupId = 'rotation-walk';
      await createCircle(admin, { groupId, name: 'Rotation walk' });
      const call = (app, op, args) => admin.agent.callSkill(app, op, args);
      const built = await buildCircleInviteUri({ callSkill: call, circleId: groupId, adminPeerAddr: admin.pubKey });
      const oldCode = codeOf(built.uri);

      const rotated = await call('stoop', 'rotateMyGroupCode', { groupId });
      expect(rotated.code).not.toBe(oldCode);

      // WRONG: rotation is the act an admin performs to close someone's way in, and for the next 24 hours it
      // does not. The gate accepts ANY code row for the circle inside `expiresAt + 24h`; rotation only writes
      // a newer row. RIGHT: rotation should be able to invalidate the previous code — the mid-handoff grace
      // window and a deliberate revocation are different needs and should not share one rule.
      const withOld = await call('stoop', 'verifyMembershipCodeForPeer', {
        groupId, code: oldCode, requesterWebid: 'holder-of-old-code', peerDisplay: 'oldholder',
      });
      expect(withOld.redemptionId).toBeTruthy();
    } finally {
      await teardown(admin);
    }
  }, 60_000);
});

describe('J-A14 — two room paths TRUNCATE instead of refusing', () => {
  it('a 5000-character card line is stored as 140 characters, silently', () => {
    const card = receiveCard({ subtype: CARD_MESSAGE, card: { label: 'Jan', line: 'x'.repeat(5000) } }, 'attacker');
    // WRONG: the receiver keeps a half-object it believes is complete — the one line of prose a person writes
    // about why they are here can be cut mid-word with nothing saying anything was removed. Note the SAME
    // object refuses an over-long `label` (below), so it is half strict and half lenient with no rule stated.
    // RIGHT: refuse the card, as the over-long label already is.
    expect(card.line.length).toBe(CARD_MAX_LINE);
    expect(receiveCard({ subtype: CARD_MESSAGE, card: { label: 'x'.repeat(41) } }, 'attacker')).toBeNull();
  });

  it("a 5000-character circle name on a broadcast invite is stored as 60 characters, silently", () => {
    const invite = receiveInvite({
      subtype: 'nearby-invite',
      invite: { uri: 'stoop-invite://abc', circleId: 'c', circleName: 'x'.repeat(5000), expiresAt: Date.now() + MIN },
    }, 'attacker');
    // WRONG, same shape as the card: the invite's `uri` and `circleId` are REFUSED when over-long, but the
    // name a room reads is trimmed. RIGHT: refuse it — a truncated circle name is a different circle's name.
    expect(invite.circleName.length).toBe(INVITE_MAX_NAME);
  });
});

describe('J-A11 — the room ask store is unbounded (ATTACK SUCCEEDS)', () => {
  it('keeps and renders every ask a stranger sends', async () => {
    let push = null;
    const channel = createAskChannel({ listPeers: () => [], sendTo: async () => {} });
    const screen = createNearbyScreen({
      subscribeToAsks: (fn) => { push = fn; return () => {}; },
      askChannel: channel,
      myRoomAddress: () => 'me',
      t: (k) => k,
    });
    screen.open();

    const N = 400;
    for (let i = 0; i < N; i += 1) {
      push(channel.receiveAsk({
        subtype: ASK_MESSAGE,
        ask: { id: `flood-${i}`, text: `need a thing ${i}`, tags: ['x'], expiresAt: Date.now() + 30 * MIN },
      }, `attacker-${i % 3}`));
    }
    await new Promise((r) => setTimeout(r, 20));

    // WRONG: nothing bounds the ask map (nearbyScreen.js) — expired asks are filtered on RENDER but never
    // evicted, and every ask received is also rendered. Ingest is quadratic too (emit() rebuilds the whole
    // model per ask), and with drivers wired each ask drives the on-device matcher (an LLM judge included).
    // RIGHT: a cap on how many asks a room may hold, eviction on expiry, and a per-peer ceiling before the
    // matcher runs — one scripted peer should not be able to fill a room or order work on your device.
    expect(screen.model().asks.length).toBe(N);

    // The one thing that IS bounded: leaving the room forgets them.
    screen.close();
    expect(screen.model().asks.length).toBe(0);
  });
});
