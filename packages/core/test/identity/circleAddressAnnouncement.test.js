// Announcing the address you answer on in a circle — the record must be believable by someone who
// was NOT present when it was proven, because that is the whole point: a fresh joiner cannot reach
// the other members yet, so their announcement has to be CARRIED by someone who can (the admin).
// Carrying must not become vouching, which is what the proof is for.
import { describe, it, expect } from 'vitest';
import { Bootstrap } from '../../src/identity/Bootstrap.js';
import { deriveCircleAddress } from '../../src/identity/circleAddress.js';
import { signCircleLinkFromSeed } from '../../src/identity/circleLink.js';
import {
  CIRCLE_ADDRESS_ANNOUNCE_KIND,
  circleAddressAnnouncement,
  ownCircleAddressAnnouncement,
  ownCircleAddressAnnouncementFromSeed,
  verifyCircleAddressAnnouncement,
  verifyCircleAddressAnnouncements,
} from '../../src/identity/circleAddressAnnouncement.js';

const seedFor = (name) => Bootstrap.fromMnemonic(Bootstrap.create().mnemonic).deriveAgentSeed(name);
const CIRCLE = 'circle-42';

/** What a host's seams look like — the two functions `realAgent` already exposes. */
const seamsFor = (seed) => ({
  circleAddressFor:  (cid) => deriveCircleAddress(seed, cid),
  signCircleAddress: (cid, address) => signCircleLinkFromSeed(seed, cid, cid, address),
});

describe('per-circle address announcement', () => {
  it('one name for the wire kind, so the fan and the receiver cannot drift', () => {
    expect(CIRCLE_ADDRESS_ANNOUNCE_KIND).toBe('circle-address-announce');
  });

  it('a device can mint an announcement for its own address, and anyone can verify it', () => {
    const seed = seedFor('me');
    const a = ownCircleAddressAnnouncement({
      circleId: CIRCLE, memberWebid: 'webid:me', ...seamsFor(seed),
    });
    expect(a.circleAddress).toBe(deriveCircleAddress(seed, CIRCLE));
    // The verification a RELAY receiver does — it holds no secret of the announcer's, only the
    // record itself.
    expect(verifyCircleAddressAnnouncement(a, CIRCLE)).toEqual(a);
  });

  it('the seed-only variant produces exactly the same record', () => {
    const seed = seedFor('me');
    const viaSeams = ownCircleAddressAnnouncement({
      circleId: CIRCLE, memberWebid: 'webid:me', ...seamsFor(seed),
    });
    const viaSeed = ownCircleAddressAnnouncementFromSeed({
      derivationSeed: seed, circleId: CIRCLE, memberWebid: 'webid:me',
    });
    expect(viaSeed).toEqual(viaSeams);
  });

  it('a carrier who ALTERS the address invalidates it — relaying is not vouching', () => {
    const mine = ownCircleAddressAnnouncement({
      circleId: CIRCLE, memberWebid: 'webid:me', ...seamsFor(seedFor('me')),
    });
    const tampered = { ...mine, circleAddress: deriveCircleAddress(seedFor('attacker'), CIRCLE) };
    expect(verifyCircleAddressAnnouncement(tampered, CIRCLE)).toBeNull();
  });

  it('an address someone merely SAW cannot be announced by them — the proof needs the key behind it', () => {
    const victimSeed = seedFor('victim');
    const address = deriveCircleAddress(victimSeed, CIRCLE);   // a co-member has seen this
    const forged = circleAddressAnnouncement({
      circleId: CIRCLE,
      memberWebid: 'webid:attacker',
      circleAddress: address,
      // signed with the attacker's own key, over the right message
      circleAddressProof: signCircleLinkFromSeed(seedFor('attacker'), CIRCLE, CIRCLE, address),
    });
    expect(verifyCircleAddressAnnouncement(forged, CIRCLE)).toBeNull();
  });

  it('an announcement for another circle is refused on this circle\'s fan, however valid it is', () => {
    const other = ownCircleAddressAnnouncement({
      circleId: 'werk-7', memberWebid: 'webid:me', ...seamsFor(seedFor('me')),
    });
    // Valid on its own terms…
    expect(verifyCircleAddressAnnouncement(other)).toEqual(other);
    // …and still wrong here. A cross-circle write is exactly what per-circle addressing exists to
    // prevent, so "cryptographically fine" must not be enough.
    expect(verifyCircleAddressAnnouncement(other, CIRCLE)).toBeNull();
  });

  it('deny-by-default: anything missing or malformed is null, never a partial record', () => {
    const good = ownCircleAddressAnnouncement({
      circleId: CIRCLE, memberWebid: 'webid:me', ...seamsFor(seedFor('me')),
    });
    for (const missing of ['circleId', 'memberWebid', 'circleAddress', 'circleAddressProof']) {
      expect(verifyCircleAddressAnnouncement({ ...good, [missing]: '' })).toBeNull();
    }
    for (const junk of [null, undefined, 'a string', 42, {}, { circleId: CIRCLE }]) {
      expect(verifyCircleAddressAnnouncement(junk, CIRCLE)).toBeNull();
    }
  });

  it('the payload is a WHITELIST — a caller\'s UNKNOWN extra fields never reach the wire', () => {
    const shaped = circleAddressAnnouncement({
      circleId: CIRCLE, memberWebid: 'w', circleAddress: 'a', circleAddressProof: 'p',
      displayName: 'Bram',   // ← unknown field, dropped
    });
    expect(Object.keys(shaped).sort()).toEqual(
      ['circleAddress', 'circleAddressProof', 'circleId', 'memberWebid'],
    );
  });

  it('personaProperties (the RELEASE) is a KNOWN optional field — a non-empty object rides, junk is dropped', () => {
    // The release completes the roster projection (a released name reaches co-members). It is carried
    // only as a non-empty plain object; an empty object, an array, or a non-object drops away so the
    // wire shape stays byte-identical to a release-less announcement.
    const withRelease = circleAddressAnnouncement({
      circleId: CIRCLE, memberWebid: 'w', circleAddress: 'a', circleAddressProof: 'p',
      personaProperties: { realName: 'Bram de Wit' },
    });
    expect(withRelease.personaProperties).toEqual({ realName: 'Bram de Wit' });

    for (const junk of [{}, [], 'x', 42, null]) {
      const shaped = circleAddressAnnouncement({
        circleId: CIRCLE, memberWebid: 'w', circleAddress: 'a', circleAddressProof: 'p',
        personaProperties: junk,
      });
      expect(shaped).not.toHaveProperty('personaProperties');
    }
  });

  it('a batch keeps what checks out and drops what does not — one bad row costs the others nothing', () => {
    const ok1 = ownCircleAddressAnnouncement({ circleId: CIRCLE, memberWebid: 'webid:a', ...seamsFor(seedFor('a')) });
    const ok2 = ownCircleAddressAnnouncement({ circleId: CIRCLE, memberWebid: 'webid:b', ...seamsFor(seedFor('b')) });
    const bad = { ...ok1, circleAddressProof: 'nonsense' };
    expect(verifyCircleAddressAnnouncements([ok1, bad, ok2], CIRCLE)).toEqual([ok1, ok2]);
    expect(verifyCircleAddressAnnouncements(null, CIRCLE)).toEqual([]);
  });

  it('a device that cannot sign for an address announces nothing rather than announcing it unproven', () => {
    expect(ownCircleAddressAnnouncement({
      circleId: CIRCLE, memberWebid: 'webid:me',
      circleAddressFor: () => 'an-address',
      signCircleAddress: () => null,             // no key for it
    })).toBeNull();
    expect(ownCircleAddressAnnouncement({
      circleId: CIRCLE, memberWebid: 'webid:me',
      circleAddressFor: () => { throw new Error('vault locked'); },
      signCircleAddress: () => 'p',
    })).toBeNull();
    expect(ownCircleAddressAnnouncement({ circleId: CIRCLE, memberWebid: 'webid:me' })).toBeNull();
  });
});
