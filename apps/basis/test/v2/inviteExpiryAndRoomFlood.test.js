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
import { receiveInvite, prepareBroadcastInvite, INVITE_MESSAGE, INVITE_MAX_NAME, BROADCAST_INVITE_MAX_TTL_MS } from '../../src/v2/nearbyInvites.js';

const MIN = 60_000;
const codeOf = (uri) => { const st = {}; decodeInvite(uri, st); return st.invite.code; };

/** Move the clock by a constant offset for one call. Real timers are untouched (only the reading moves). */
async function atClockOffset(ms, fn) {
  const real = Date.now;
  Date.now = () => real() + ms;
  try { return await fn(); } finally { Date.now = real; }
}

describe('J-A6 — an invite stops working when it says it will (FIXED 2026-07-30)', () => {
  it('refuses a code once its own expiry has passed', async () => {
    const admin = await bootRealAgentNode('inviteExpiryAdmin');
    try {
      const groupId = 'ceiling-walk';
      await createCircle(admin, { groupId, name: 'Ceiling walk' });
      const call = (app, op, args) => admin.agent.callSkill(app, op, args);
      const built = await buildCircleInviteUri({ callSkill: call, circleId: groupId, adminPeerAddr: admin.pubKey });
      const code = codeOf(built.uri);

      // The broadcast copy is clamped to 15 minutes — that half was always sound.
      const published = prepareBroadcastInvite({
        uri: built.uri, circleId: groupId, expiresAt: built.expiresAt, allows: { [groupId]: true },
      });
      expect(published.invite.expiresAt - Date.now()).toBeLessThanOrEqual(BROADCAST_INVITE_MAX_TTL_MS);

      const redeem = (label, offset) => atClockOffset(offset, () => call('stoop', 'verifyMembershipCodeForPeer', {
        groupId, code, requesterWebid: `walker-${label}`, peerDisplay: `walker${label}`,
        rulesAccepted: '1',   // task #80 — these walkers simulate joiners who ticked the rules
      }));

      // Inside its life: admitted, as it should be.
      expect((await redeem('now', 0)).redemptionId).toBeTruthy();

      // Past the code's own expiry (1 h by default): refused. This is the fix — the redeem used to accept
      // anything inside `expiresAt + 24h`, so the enforced life of an invite was its TTL plus a day, and a
      // saved URI was a standing key.
      expect((await redeem('2h', 2 * 60 * MIN)).error).toBe('invalid-or-expired-code');
      expect((await redeem('25h', 25 * 60 * MIN)).error).toBe('invalid-or-expired-code');
    } finally {
      await teardown(admin);
    }
  }, 60_000);

  it('…but a small clock difference is still tolerated', async () => {
    // The allowance that remains is clock skew (2 min), not a second lifetime. An honest joiner whose
    // phone is a minute fast is not turned away at the door.
    const admin = await bootRealAgentNode('inviteSkewAdmin');
    try {
      const groupId = 'skew-walk';
      await createCircle(admin, { groupId, name: 'Skew walk' });
      const call = (app, op, args) => admin.agent.callSkill(app, op, args);
      const built = await buildCircleInviteUri({ callSkill: call, circleId: groupId, adminPeerAddr: admin.pubKey });
      const code = codeOf(built.uri);
      const r = await call('stoop', 'verifyMembershipCodeForPeer', {
        groupId, code, requesterWebid: 'skew-walker', peerDisplay: 'skewwalker', rulesAccepted: '1',
      });
      expect(r.redemptionId).toBeTruthy();
    } finally {
      await teardown(admin);
    }
  }, 60_000);

  it('the broadcast ceiling is still only a CLIENT rule — worth knowing', () => {
    // Not a defect any more, but not a defence either: `prepareBroadcastInvite` clamps the copy it
    // publishes, and nothing carries that ceiling into the redeem. What protects a shouted invite now is
    // the code's own expiry, which IS enforced. If a deployment wants a shorter life for broadcast
    // specifically, it has to mint the code with that TTL — clamping the display does not do it.
    expect(BROADCAST_INVITE_MAX_TTL_MS).toBeLessThanOrEqual(15 * MIN);
  });
});

describe('J-A8 — rotating the membership code kills the old one (FIXED 2026-07-30)', () => {
  it('a holder of the rotated-away code is refused immediately', async () => {
    const admin = await bootRealAgentNode('rotationWalkAdmin');
    try {
      const groupId = 'rotation-walk';
      await createCircle(admin, { groupId, name: 'Rotation walk' });
      const call = (app, op, args) => admin.agent.callSkill(app, op, args);
      const built = await buildCircleInviteUri({ callSkill: call, circleId: groupId, adminPeerAddr: admin.pubKey });
      const oldCode = codeOf(built.uri);

      const rotated = await call('stoop', 'rotateMyGroupCode', { groupId });
      expect(rotated.code).not.toBe(oldCode);

      // Rotation is the act an admin performs to close someone's way in, and it now does that. It used to
      // only add a newer row while the gate accepted any row inside `expiresAt + 24h` — so for a day after
      // rotating, the leaked code still admitted strangers.
      const withOld = await call('stoop', 'verifyMembershipCodeForPeer', {
        groupId, code: oldCode, requesterWebid: 'holder-of-old-code', peerDisplay: 'oldholder', rulesAccepted: '1',
      });
      expect(withOld.error).toBe('invalid-or-expired-code');

      // …and the fresh code works, so "rotation removes" is not satisfied by breaking rotation.
      const withNew = await call('stoop', 'verifyMembershipCodeForPeer', {
        groupId, code: rotated.code, requesterWebid: 'holder-of-new-code', peerDisplay: 'newholder', rulesAccepted: '1',
      });
      expect(withNew.redemptionId).toBeTruthy();
    } finally {
      await teardown(admin);
    }
  }, 60_000);
});

describe('J-A14 — the room refuses over-long content instead of shortening it (FIXED 2026-07-30)', () => {
  it('a 5000-character card line is REFUSED, not stored as 140 characters', () => {
    // Truncation mutates content and tells nobody: the reader sees a card that looks ordinary and is not
    // what its author sent. And the "not hostile just for being wordy" defence does not apply here —
    // `createCard` already refuses `line-too-long`, so a wordy neighbour is stopped at their own keyboard
    // with something they can act on. Anything arriving over-length did not come from an honest client.
    const card = receiveCard({
      subtype: CARD_MESSAGE,
      card: { label: 'Sam', line: 'x'.repeat(5000) },
    }, 'them');
    expect(card).toBeNull();
  });

  it('a 5000-character circle name on a broadcast invite is REFUSED, not stored as 60', () => {
    // A circle presented under a name nobody chose is worse than a circle that does not appear: the
    // person deciding whether to join reads the shortened name as the real one.
    const seen = receiveInvite({
      subtype: INVITE_MESSAGE,
      invite: {
        uri: 'onderling-invite://abc', circleId: 'circle',
        circleName: 'n'.repeat(5000), expiresAt: Date.now() + 5 * MIN,
      },
    }, 'them');
    expect(seen).toBeNull();
  });

  it('…and content that fits is untouched, so the rule is a ceiling and not a new obstacle', () => {
    const card = receiveCard({
      subtype: CARD_MESSAGE, card: { label: 'Sam', line: 'a short line' },
    }, 'them');
    expect(card.line).toBe('a short line');
  });
});

describe('J-A11 — a room bounds its asks, and one peer cannot order work on your device (FIXED 2026-07-30)', () => {
  it('a flood is capped per author, so 400 asks from three attackers do not all land', async () => {
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

    // Each of the three attackers gets a per-author allowance; nothing like 400 survives. The cap that
    // matters most is not the map size but the work: with drivers wired, every ask used to drive the
    // on-device matcher, which can call a language model — so a scripted peer could spend someone else's
    // compute by talking. The budget is checked BEFORE that runs.
    const kept = screen.model().asks.length;
    expect(kept).toBeGreaterThan(0);                 // an honest ask still arrives
    expect(kept).toBeLessThan(40);                   // …but a flood does not
    expect(screen.model().asksIgnored).toBeGreaterThan(300);   // and the room says so rather than hiding it

    // Still true, and still worth asserting: leaving the room forgets them.
    screen.close();
    expect(screen.model().asks.length).toBe(0);
  });
});
