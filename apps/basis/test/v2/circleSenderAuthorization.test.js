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

/**
 * A roster row from BEFORE per-circle addresses were proved — an address, or nothing, but no
 * `circleAddressProof`. This is the TRANSITIONAL shape: the member has not demonstrated they can
 * sign per-circle, so their canonical key is still accepted (B6).
 */
const member = (name) => ({
  webid: name, pubKey: `${name}-identity`, circleAddress: `${name}-in-circle`,
});

/**
 * A row that carries the PROOF — the shape a join, a redeem response or an announcement writes.
 * This member has demonstrated per-circle signing, so their canonical key is refused from here on.
 */
const provenMember = (name) => ({ ...member(name), circleAddressProof: `${name}-proof` });

describe('who may speak at one of our per-circle addresses', () => {
  it('a member who has PROVED a per-circle address may speak with it', () => {
    const auth = createCircleSenderAuthorization();
    const anna = provenMember('anna');
    expect(auth.recordCircleRoster({
      circleId: 'buurt', ownAddress: OURS_IN_BUURT, members: [anna],
    })).toBeGreaterThanOrEqual(2);

    expect(auth.authorizeSender({ senderKey: anna.circleAddress, ownAddress: OURS_IN_BUURT }))
      .toEqual({ allow: true, reason: SENDER_REASON.MEMBER });
  });

  it('…and may NOT fall back to their canonical identity — that is the enforcement (B6)', () => {
    // The whole point. Before this, a member who simply kept signing canonically was accepted, so
    // per-circle signing was the polite option rather than a property — and the cross-circle
    // unlinkability decisions 1 and 4 exist to provide was never actually guaranteed to anyone.
    const auth = createCircleSenderAuthorization();
    const anna = provenMember('anna');
    auth.recordCircleRoster({ circleId: 'buurt', ownAddress: OURS_IN_BUURT, members: [anna] });

    expect(auth.authorizeSender({ senderKey: anna.pubKey, ownAddress: OURS_IN_BUURT }))
      .toEqual({ allow: false, reason: SENDER_REASON.CANONICAL_REFUSED });
    // Counted APART from a stranger: same refusal, completely different operator response. One is
    // an outsider probing the circle; the other is a member's own device on an old code path.
    expect(auth.refusedCanonicalSigners).toBe(1);
    expect(auth.refusedStrangers).toBe(0);
    // …and the key is not merely absent from the allow-list; the snapshot names it as excluded.
    expect(auth.snapshotFor(OURS_IN_BUURT).refusedCanonical).toEqual([anna.pubKey]);
    expect(auth.snapshotFor(OURS_IN_BUURT).keys).not.toContain(anna.pubKey);
  });

  it('a member whose row proves NO address keeps their canonical key — or they go undeliverable', () => {
    // The transitional set. Refusing here would not make them pseudonymous, it would make them
    // silent, which is a worse answer than the leak. It is a shrinking set, not a permanent door —
    // see the counting tests below.
    const auth = createCircleSenderAuthorization();
    const anna = member('anna');   // an address, but nothing proving it is hers
    auth.recordCircleRoster({ circleId: 'buurt', ownAddress: OURS_IN_BUURT, members: [anna] });

    expect(auth.authorizeSender({ senderKey: anna.pubKey, ownAddress: OURS_IN_BUURT }).allow).toBe(true);
    expect(auth.authorizeSender({ senderKey: anna.circleAddress, ownAddress: OURS_IN_BUURT }).allow).toBe(true);
  });

  it('a member proven on TWO addresses may speak with EITHER — the set, not just the first', () => {
    // The roster row can carry a SET of proven per-circle addresses (`circleAddresses`, primary
    // first — deriveRoster admits an address only on a verified proof): a second device, a restored
    // profile. Under the one-derivation rule each address IS the key that signs at it, so a member
    // speaking from their second address must not read as a stranger.
    const auth = createCircleSenderAuthorization();
    const anna = {
      ...provenMember('anna'),
      circleAddresses: ['anna-in-circle', 'anna-second-device-in-circle'],
    };
    auth.recordCircleRoster({ circleId: 'buurt', ownAddress: OURS_IN_BUURT, members: [anna] });

    expect(auth.authorizeSender({ senderKey: 'anna-in-circle', ownAddress: OURS_IN_BUURT }))
      .toEqual({ allow: true, reason: SENDER_REASON.MEMBER });
    expect(auth.authorizeSender({ senderKey: 'anna-second-device-in-circle', ownAddress: OURS_IN_BUURT }))
      .toEqual({ allow: true, reason: SENDER_REASON.MEMBER });
    // …while the canonical key stays refused (B6) and a stranger stays a stranger.
    expect(auth.authorizeSender({ senderKey: anna.pubKey, ownAddress: OURS_IN_BUURT }))
      .toEqual({ allow: false, reason: SENDER_REASON.CANONICAL_REFUSED });
    expect(auth.authorizeSender({ senderKey: 'mallory-key', ownAddress: OURS_IN_BUURT }).allow).toBe(false);
  });

  it('a refresh that DROPS an address from the set stops accepting it — the snapshot replaces', () => {
    const auth = createCircleSenderAuthorization();
    const twoAddrs = { ...provenMember('anna'), circleAddresses: ['anna-in-circle', 'anna-old-addr'] };
    auth.recordCircleRoster({ circleId: 'buurt', ownAddress: OURS_IN_BUURT, members: [twoAddrs] });
    expect(auth.authorizeSender({ senderKey: 'anna-old-addr', ownAddress: OURS_IN_BUURT }).allow).toBe(true);

    auth.recordCircleRoster({ circleId: 'buurt', ownAddress: OURS_IN_BUURT, members: [provenMember('anna')] });
    expect(auth.authorizeSender({ senderKey: 'anna-old-addr', ownAddress: OURS_IN_BUURT }).allow).toBe(false);
    expect(auth.authorizeSender({ senderKey: 'anna-in-circle', ownAddress: OURS_IN_BUURT }).allow).toBe(true);
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

  it('…including when OUR OWN row comes back proven — enforcement is about other people', () => {
    // Our own row is in the roster we just read, so the member walk sees it too. Our other devices
    // share this profile seed and may still be speaking canonically, and no unlinkability of ours is
    // protected by us refusing to hear from us. The exception is deliberate and is the only one.
    const auth = createCircleSenderAuthorization();
    const me = { ...provenMember('me'), pubKey: 'our-canonical-key' };
    auth.recordCircleRoster({
      circleId: 'buurt', ownAddress: OURS_IN_BUURT, members: [me, provenMember('anna')],
      selfKeys: ['our-circle-key', 'our-canonical-key'],
    });
    expect(auth.authorizeSender({ senderKey: 'our-canonical-key', ownAddress: OURS_IN_BUURT }).allow).toBe(true);
    expect(auth.snapshotFor(OURS_IN_BUURT).refusedCanonical).toEqual(['anna-identity']);
    // …and we are not counted as part of the transition either: our own row is not a member we are
    // waiting on, and inflating the number would make it useless as a thing to watch go down.
    expect(auth.snapshotFor(OURS_IN_BUURT).canonicalOnly).toBe(0);
  });
});

describe('the transitional set — members still allowed by their canonical key alone (B6)', () => {
  it('is counted, per circle and in total', () => {
    const auth = createCircleSenderAuthorization();
    auth.recordCircleRoster({
      circleId: 'buurt', ownAddress: OURS_IN_BUURT,
      members: [provenMember('anna'), member('bram'), member('cato')],
    });
    auth.recordCircleRoster({
      circleId: 'koor', ownAddress: OURS_IN_KOOR, members: [provenMember('dana'), member('eef')],
    });
    expect(auth.snapshotFor(OURS_IN_BUURT).canonicalOnly).toBe(2);
    expect(auth.snapshotFor(OURS_IN_KOOR).canonicalOnly).toBe(1);
    expect(auth.canonicalOnlyMembers, 'the whole transition, across every circle').toBe(3);
  });

  it('is warned about once per circle, and again only when the SIZE changes', () => {
    // A warning per envelope is noise, and noise is how a real one gets missed. A warning that
    // never repeats hides the shrink. So: once per size — silence means "unchanged".
    const warned = [];
    const auth = createCircleSenderAuthorization({ onCanonicalOnlyMembers: (i) => warned.push(i) });
    const roster = (members) => auth.recordCircleRoster({ circleId: 'buurt', ownAddress: OURS_IN_BUURT, members });

    roster([provenMember('anna'), member('bram'), member('cato')]);
    roster([provenMember('anna'), member('bram'), member('cato')]);   // unchanged ⇒ silent
    expect(warned).toEqual([{ ownAddress: OURS_IN_BUURT, circleId: 'buurt', count: 2, of: 3 }]);

    roster([provenMember('anna'), provenMember('bram'), member('cato')]);   // one healed
    expect(warned.length, 'a shrink is audible').toBe(2);
    expect(warned[1].count).toBe(1);
  });

  it('SHRINKS TO ZERO when a member announces — the same read, no coordination', () => {
    // This is the self-healing property, and it is the whole reason enforcement can be per member
    // with no flag day: the moment a row gains a proof, that member's canonical key stops being
    // accepted, and nothing anywhere had to be switched on.
    const warned = [];
    const auth = createCircleSenderAuthorization({ onCanonicalOnlyMembers: (i) => warned.push(i) });
    const bram = member('bram');

    auth.recordCircleRoster({ circleId: 'buurt', ownAddress: OURS_IN_BUURT, members: [provenMember('anna'), bram] });
    expect(auth.canonicalOnlyMembers).toBe(1);
    expect(auth.authorizeSender({ senderKey: bram.pubKey, ownAddress: OURS_IN_BUURT }).allow).toBe(true);

    // …bram's device announces its per-circle address; the roster is re-read and re-recorded.
    auth.recordCircleRoster({
      circleId: 'buurt', ownAddress: OURS_IN_BUURT, members: [provenMember('anna'), provenMember('bram')],
    });
    expect(auth.canonicalOnlyMembers, 'the transition is over for this circle').toBe(0);
    expect(auth.authorizeSender({ senderKey: bram.pubKey, ownAddress: OURS_IN_BUURT }))
      .toEqual({ allow: false, reason: SENDER_REASON.CANONICAL_REFUSED });
    expect(warned.length, 'and reaching zero is not itself a warning').toBe(1);
  });

  it('a proof with no address proves nothing — the row stays transitional', () => {
    // `hasProvenCircleAddress` needs BOTH halves. A proof alone cannot be checked against anything,
    // and treating it as a demonstration of per-circle signing would refuse a member's only key.
    const auth = createCircleSenderAuthorization();
    const ghosted = { webid: 'ghosted', pubKey: 'ghosted-identity', circleAddressProof: 'a-proof-of-what' };
    auth.recordCircleRoster({ circleId: 'buurt', ownAddress: OURS_IN_BUURT, members: [ghosted, member('anna')] });
    expect(auth.authorizeSender({ senderKey: 'ghosted-identity', ownAddress: OURS_IN_BUURT }).allow).toBe(true);
    expect(auth.snapshotFor(OURS_IN_BUURT).canonicalOnly).toBe(2);
  });
});

describe('ADVERSARIAL — the three ways someone tries to speak in a circle they may not', () => {
  const auth = () => {
    const a = createCircleSenderAuthorization();
    a.recordCircleRoster({
      circleId: 'buurt', ownAddress: OURS_IN_BUURT, members: [provenMember('anna'), provenMember('bram')],
    });
    a.recordCircleRoster({ circleId: 'koor', ownAddress: OURS_IN_KOOR, members: [provenMember('cato')] });
    return a;
  };

  it('a stranger is refused, however well they sign', () => {
    expect(auth().authorizeSender({ senderKey: 'mallory-key', ownAddress: OURS_IN_BUURT }))
      .toEqual({ allow: false, reason: SENDER_REASON.STRANGER });
  });

  it('a member of circle A is refused in circle B — with EITHER of their keys', () => {
    const a = auth();
    // The per-circle key: a different circle's snapshot, so it buys nothing here.
    expect(a.authorizeSender({ senderKey: 'anna-in-circle', ownAddress: OURS_IN_KOOR }).allow).toBe(false);
    // The canonical key: the very identity per-circle addressing exists to keep out of circle B.
    expect(a.authorizeSender({ senderKey: 'anna-identity', ownAddress: OURS_IN_KOOR }).allow).toBe(false);
  });

  it('a member of THIS circle is refused when they sign canonically', () => {
    const a = auth();
    expect(a.authorizeSender({ senderKey: 'anna-identity', ownAddress: OURS_IN_BUURT }))
      .toEqual({ allow: false, reason: SENDER_REASON.CANONICAL_REFUSED });
    expect(a.authorizeSender({ senderKey: 'bram-identity', ownAddress: OURS_IN_BUURT }).allow).toBe(false);
    // …while the circle's real traffic is untouched. A check that refuses everything is an outage.
    expect(a.authorizeSender({ senderKey: 'anna-in-circle', ownAddress: OURS_IN_BUURT }).allow).toBe(true);
    expect(a.authorizeSender({ senderKey: 'bram-in-circle', ownAddress: OURS_IN_BUURT }).allow).toBe(true);
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
    expect(auth.snapshotFor(OURS_IN_BUURT).canonicalOnly).toBe(1);
    expect(auth.snapshotFor('unknown')).toBeNull();
  });
});
