/**
 * The roster authorize, on its own (Decision 1, step 3).
 *
 * The end-to-end proof that this is WIRED lives in `circleSenderAuthorization.relay.test.js` — a
 * real relay, real sockets, a real join and a real stranger. This file is the other half: the rules
 * it applies, including the ones the end-to-end test cannot reach (a roster it has never seen, a
 * member removed by a refresh, two circles at once).
 */
import { describe, it, expect } from 'vitest';
import { createCircleSenderAuthorization, SENDER_REASON } from '../../src/v2/circleSenderAuthorization.js';

const OURS_IN_BUURT = 'ours-in-buurt';
const OURS_IN_KOOR  = 'ours-in-koor';

const member = (name) => ({
  webid: name, pubKey: `${name}-identity`, circleAddress: `${name}-in-circle`,
});

describe('who may speak at one of our per-circle addresses', () => {
  it('a member of THIS circle may — by their per-circle key or their canonical one', () => {
    const auth = createCircleSenderAuthorization();
    const anna = member('anna');
    expect(auth.recordCircleRoster({
      circleId: 'buurt', ownAddress: OURS_IN_BUURT, members: [anna],
    })).toBeGreaterThanOrEqual(3);

    // What signs inside the circle (Decision 4)…
    expect(auth.authorizeSender({ senderKey: anna.circleAddress, ownAddress: OURS_IN_BUURT }))
      .toEqual({ allow: true, reason: SENDER_REASON.MEMBER });
    // …and the canonical key, which is a worse choice for them but is still a membership fact the
    // roster records. Refusing it would drop every roster row written before per-circle signing.
    expect(auth.authorizeSender({ senderKey: anna.pubKey, ownAddress: OURS_IN_BUURT }).allow).toBe(true);
  });

  it('a stranger may not, however well they sign', () => {
    const auth = createCircleSenderAuthorization();
    auth.recordCircleRoster({ circleId: 'buurt', ownAddress: OURS_IN_BUURT, members: [member('anna')] });

    expect(auth.authorizeSender({ senderKey: 'mallory-key', ownAddress: OURS_IN_BUURT }))
      .toEqual({ allow: false, reason: SENDER_REASON.STRANGER });
    expect(auth.refusedStrangers).toBe(1);
  });

  it('a member of ANOTHER circle may not — the snapshot is per circle', () => {
    const auth = createCircleSenderAuthorization();
    const anna = member('anna');
    const bram = member('bram');
    auth.recordCircleRoster({ circleId: 'buurt', ownAddress: OURS_IN_BUURT, members: [anna] });
    auth.recordCircleRoster({ circleId: 'koor',  ownAddress: OURS_IN_KOOR,  members: [bram] });

    expect(auth.authorizeSender({ senderKey: anna.circleAddress, ownAddress: OURS_IN_BUURT }).allow).toBe(true);
    expect(auth.authorizeSender({ senderKey: anna.circleAddress, ownAddress: OURS_IN_KOOR }).allow).toBe(false);
    expect(auth.authorizeSender({ senderKey: bram.circleAddress, ownAddress: OURS_IN_BUURT }).allow).toBe(false);
  });

  it('a refreshed roster REPLACES the old one — a removed member stops being able to speak', () => {
    const auth = createCircleSenderAuthorization();
    const anna = member('anna');
    const bram = member('bram');
    auth.recordCircleRoster({ circleId: 'buurt', ownAddress: OURS_IN_BUURT, members: [anna, bram] });
    expect(auth.authorizeSender({ senderKey: bram.circleAddress, ownAddress: OURS_IN_BUURT }).allow).toBe(true);

    auth.recordCircleRoster({ circleId: 'buurt', ownAddress: OURS_IN_BUURT, members: [anna] });
    expect(auth.authorizeSender({ senderKey: bram.circleAddress, ownAddress: OURS_IN_BUURT }).allow).toBe(false);
    expect(auth.authorizeSender({ senderKey: anna.circleAddress, ownAddress: OURS_IN_BUURT }).allow).toBe(true);
  });

  it('we may always speak to ourselves — our circle key and our canonical key both count', () => {
    const auth = createCircleSenderAuthorization();
    auth.recordCircleRoster({
      circleId: 'buurt', ownAddress: OURS_IN_BUURT, members: [member('anna')],
      selfKeys: ['our-circle-key', 'our-canonical-key'],
    });
    for (const k of ['our-circle-key', 'our-canonical-key', OURS_IN_BUURT]) {
      expect(auth.authorizeSender({ senderKey: k, ownAddress: OURS_IN_BUURT }).allow, k).toBe(true);
    }
  });
});

describe('what it deliberately does NOT refuse', () => {
  it('traffic that is not circle-scoped passes — that is where first contact lives', () => {
    const auth = createCircleSenderAuthorization();
    auth.recordCircleRoster({ circleId: 'buurt', ownAddress: OURS_IN_BUURT, members: [member('anna')] });
    // `ownAddress` is null when the envelope was sealed to our canonical identity: a contact, a
    // pairing, a join request from someone who is by definition not a member yet.
    expect(auth.authorizeSender({ senderKey: 'a-stranger', ownAddress: null }))
      .toEqual({ allow: true, reason: SENDER_REASON.NOT_CIRCLE_SCOPED });
  });

  it('an address whose roster we have NEVER read passes, and says so in a number', () => {
    // THE HONEST DEGRADATION. Refusing here would mean a circle whose roster read has not happened
    // yet — a cold boot, a circle never opened, a failed skill call — silently drops every message
    // from every member, which is indistinguishable from the app being broken. So the rule is
    // "refuse whenever a roster IS known", never on the strength of not knowing.
    const warned = [];
    const auth = createCircleSenderAuthorization({ onUnknownRoster: (i) => warned.push(i) });

    expect(auth.authorizeSender({ senderKey: 'anybody', ownAddress: 'ours-in-a-circle-we-never-read' }))
      .toEqual({ allow: true, reason: SENDER_REASON.ROSTER_UNKNOWN });
    expect(auth.unknownRosterAllowances).toBe(1);
    expect(warned).toEqual([{ ownAddress: 'ours-in-a-circle-we-never-read' }]);
  });

  it('the unknown-roster warning fires ONCE per address, not once per envelope', () => {
    const warned = [];
    const auth = createCircleSenderAuthorization({ onUnknownRoster: (i) => warned.push(i) });
    for (let i = 0; i < 5; i++) auth.authorizeSender({ senderKey: 'x', ownAddress: 'unread' });
    expect(warned.length).toBe(1);
    expect(auth.unknownRosterAllowances).toBe(5);   // the COUNT is per envelope; the noise is not
  });
});

describe('a roster read that came back empty records nothing', () => {
  it('because an empty member list is a failed skill call far more often than a real circle', () => {
    const auth = createCircleSenderAuthorization();
    expect(auth.recordCircleRoster({ circleId: 'buurt', ownAddress: OURS_IN_BUURT, members: [] })).toBe(0);
    expect(auth.circleAddressCount).toBe(0);
    // …so the circle stays in the "never read" state and its traffic is accepted, rather than being
    // locked out on the strength of a failure.
    expect(auth.authorizeSender({ senderKey: 'anna-in-circle', ownAddress: OURS_IN_BUURT }).allow).toBe(true);
  });

  it('and a row missing both keys contributes nothing', () => {
    const auth = createCircleSenderAuthorization();
    expect(auth.recordCircleRoster({
      circleId: 'buurt', ownAddress: OURS_IN_BUURT, members: [{ webid: 'ghost' }],
    })).toBe(0);
  });

  it('an absent own address records nothing at all', () => {
    const auth = createCircleSenderAuthorization();
    expect(auth.recordCircleRoster({ circleId: 'buurt', ownAddress: null, members: [member('anna')] })).toBe(0);
  });
});

describe('leaving a circle', () => {
  it('drops its snapshot, so nothing is authorized against a roster we no longer hold', () => {
    const auth = createCircleSenderAuthorization();
    auth.recordCircleRoster({ circleId: 'buurt', ownAddress: OURS_IN_BUURT, members: [member('anna')] });
    expect(auth.circleAddressCount).toBe(1);
    expect(auth.forgetCircleSenders('buurt')).toBe(true);
    expect(auth.circleAddressCount).toBe(0);
    expect(auth.forgetCircleSenders('buurt')).toBe(false);   // idempotent
  });

  it('snapshotFor is a diagnostic, and says which circle an address belongs to', () => {
    const auth = createCircleSenderAuthorization();
    auth.recordCircleRoster({ circleId: 'buurt', ownAddress: OURS_IN_BUURT, members: [member('anna')] });
    expect(auth.snapshotFor(OURS_IN_BUURT).circleId).toBe('buurt');
    expect(auth.snapshotFor(OURS_IN_BUURT).keys).toContain('anna-in-circle');
    expect(auth.snapshotFor('unknown')).toBeNull();
  });
});
