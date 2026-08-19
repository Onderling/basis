/**
 * The roster access gate — a non-member peer is refused; a member peer gets an allowlist, never
 * this device's private view of the members.
 *
 * This pins the decision logic the `listGroupMembers` / `listGroupRoster` skills apply on the
 * replying device. The three-device suite exercises it over a REAL trail (joinThreeDevice's
 * roster); here the logic itself is pinned against representative rows, including the field that
 * MUST NOT leak — the local display cache — and the field that MAY (the member's own release).
 */
import { describe, it, expect } from 'vitest';
import {
  PEER_ROSTER_FIELDS, rosterCallerIsForeign, callerIsCircleMember,
  projectRosterRowForPeer, gateRosterReplyForPeer,
} from '../src/lib/rosterAccessGate.js';

// A roster row as `projectCircleRoster` builds it: functional fields + the local display cache +
// the member's own release. `displayName` is the cache that must never ride to a peer.
const row = (over = {}) => ({
  webid: 'webid:bram', id: 'webid:bram', pubKey: 'webid:bram',
  sealingPublicKey: 'seal-bram', circleAddress: 'bram@c1', circleAddressProof: 'proof-bram',
  role: 'member', handle: 'bram',
  displayName: 'Bram de Wit',            // ← local cache — PRIVATE to this device
  avatarUrl: 'https://x/bram.png',       // ← local cache — PRIVATE
  viewerNameOptIn: true,                  // ← this viewer's own preference — PRIVATE
  relation: 'contact', trustLevel: 'vertrouwd',   // ← this device's classification — PRIVATE
  personaProperties: { realName: 'B. de Wit', circle: 'oost' },   // ← the member's RELEASE — public to circle
  ...over,
});

describe('rosterCallerIsForeign', () => {
  it('a caller whose webid differs from our own is foreign; our own webid is local', () => {
    expect(rosterCallerIsForeign('webid:peer', 'webid:me')).toBe(true);
    expect(rosterCallerIsForeign('webid:me', 'webid:me')).toBe(false);
    // fail-open: with no localActor to compare against, we never classify anyone as foreign
    expect(rosterCallerIsForeign('webid:peer', null)).toBe(false);
    expect(rosterCallerIsForeign(null, 'webid:me')).toBe(false);
  });
});

describe('callerIsCircleMember', () => {
  const scoped = [row(), row({ webid: 'webid:cato', id: 'webid:cato', pubKey: 'webid:cato', handle: 'cato' })];
  it('matches a caller against webid / id / pubKey', () => {
    expect(callerIsCircleMember(scoped, 'webid:bram')).toBe(true);
    expect(callerIsCircleMember(scoped, 'webid:cato')).toBe(true);
  });
  it('a stranger is not a member; a null caller is not a member', () => {
    expect(callerIsCircleMember(scoped, 'webid:stranger')).toBe(false);
    expect(callerIsCircleMember(scoped, null)).toBe(false);
    expect(callerIsCircleMember(null, 'webid:bram')).toBe(false);
  });
});

describe('projectRosterRowForPeer — the allowlist', () => {
  it('keeps functional + released fields; drops every private-view field', () => {
    const out = projectRosterRowForPeer(row());
    // kept
    expect(out).toMatchObject({
      webid: 'webid:bram', pubKey: 'webid:bram', sealingPublicKey: 'seal-bram',
      circleAddress: 'bram@c1', circleAddressProof: 'proof-bram', role: 'member', handle: 'bram',
      personaProperties: { realName: 'B. de Wit', circle: 'oost' },
    });
    // dropped — the local cache and the viewer's private classifications
    expect(out).not.toHaveProperty('displayName');
    expect(out).not.toHaveProperty('avatarUrl');
    expect(out).not.toHaveProperty('viewerNameOptIn');
    expect(out).not.toHaveProperty('relation');
    expect(out).not.toHaveProperty('trustLevel');
    // and nothing outside the allowlist survives, whatever its name
    expect(Object.keys(out).every((k) => PEER_ROSTER_FIELDS.includes(k))).toBe(true);
  });

  it('the display cache never rides even when serialized whole', () => {
    expect(JSON.stringify(projectRosterRowForPeer(row()))).not.toContain('Bram de Wit');
  });
});

describe('gateRosterReplyForPeer — the whole decision', () => {
  const scoped = [row(), row({ webid: 'webid:cato', id: 'webid:cato', pubKey: 'webid:cato', handle: 'cato',
    displayName: 'Cato Jansen' })];

  it('a member peer gets allowlisted rows for everyone', () => {
    const r = gateRosterReplyForPeer(scoped, 'webid:cato');
    expect(r.ok).toBe(true);
    expect(r.members).toHaveLength(2);
    expect(JSON.stringify(r.members)).not.toContain('Bram de Wit');
    expect(JSON.stringify(r.members)).not.toContain('Cato Jansen');
    // but the RELEASE is there — that is what a member is entitled to
    expect(r.members[0].personaProperties.realName).toBe('B. de Wit');
  });

  it('a non-member peer is refused', () => {
    const r = gateRosterReplyForPeer(scoped, 'webid:stranger');
    expect(r.ok).toBe(false);
    expect(r.members).toEqual([]);
  });
});
