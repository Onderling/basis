/**
 * A broadcast invite must not carry the circle's relay endpoint.
 *
 * Frits' reasoning, 2026-07-27: an invite on a QR code goes to one person you are looking at; the same
 * invite broadcast into a room tells everyone in radio range which relay that circle uses. "Nothing for a
 * street party, a linkable group fact for a support group." The endpoint half shipped 2026-07-28; this
 * half did not, and for three days every broadcast invite leaked it.
 *
 * These are the guard, not the demonstration: the leak is closed, and this is what stops it re-opening
 * the next time a field is added to the invite object.
 */

import { describe, it, expect } from 'vitest';
import {
  prepareBroadcastInvite, stripForBroadcast, NOT_FOR_A_ROOM,
} from '../../src/v2/nearbyInvites.js';
import { encodeMembershipCodeUrl } from '../../src/core/wizards/createGroupState.js';
import { decodeInvite } from '../../src/core/wizards/joinGroupState.js';

const ALLOWS = { c1: true };
const decode = (uri) => { const s = {}; decodeInvite(uri, s); return s.invite; };

const fullInvite = (over = {}) => encodeMembershipCodeUrl({
  groupId: 'c1',
  code: 'CODE-1',
  expiresAt: Date.now() + 60 * 60_000,
  adminPeerAddr: 'AAAAadminpubkey',
  adminNknAddr: 'nkn-addr',
  podBacked: true,
  podUrl: 'https://pod.example/circle/',
  relayUrl: 'wss://relay.example:8787',
  rules: { quiet: true },
  capabilities: { media: 'opt-out' },
  ...over,
});

describe('stripForBroadcast', () => {
  it('removes the relay endpoint', () => {
    const r = stripForBroadcast(fullInvite());
    expect(r.ok).toBe(true);
    expect(r.stripped).toContain('relayUrl');
    expect(decode(r.uri).relayUrl).toBeUndefined();
  });

  it('removes the POD url too — where the data lives is the same class of fact', () => {
    // Frits, 2026-07-31: the relay says where a circle's messages pass, the pod says where its data
    // lives. A room gets neither.
    const after = decode(stripForBroadcast(fullInvite()).uri);
    expect(after.podUrl).toBeUndefined();
  });

  it('KEEPS podBacked — a joiner must know a circle keeps data in a pod to decide about it', () => {
    // the flag points at nobody; the url points at a place. Only the url is a disclosure.
    const after = decode(stripForBroadcast(fullInvite()).uri);
    expect(after.podBacked).toBe(true);
  });

  it('keeps everything a joiner still needs', () => {
    const before = decode(fullInvite());
    const after = decode(stripForBroadcast(fullInvite()).uri);
    for (const k of Object.keys(before)) {
      if (NOT_FOR_A_ROOM.includes(k)) continue;
      expect(after[k]).toEqual(before[k]);
    }
    // the join itself is untouched — same circle, same code
    expect(after.groupId).toBe('c1');
    expect(after.code).toBe('CODE-1');
  });

  it('preserves fields the field-whitelist encoder does not know about', () => {
    // the reason stripForBroadcast re-encodes generically rather than via encodeMembershipCodeUrl:
    // that whitelist silently dropped podBacked/podUrl until 2026-07-28, and a round-trip through it
    // would re-create the same silent loss for every future field.
    const withNovel = `onderling-invite://${globalThis.btoa(JSON.stringify({
      kind: 'membershipCode', groupId: 'c1', code: 'X', relayUrl: 'wss://r',
      podBacked: true, podUrl: 'https://pod/', somethingNew: 42,
    })).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')}`;
    const after = decode(stripForBroadcast(withNovel).uri);
    expect(after.somethingNew).toBe(42);
    expect(after.relayUrl).toBeUndefined();
    expect(after.podUrl).toBeUndefined();
  });

  it('is a no-op, byte for byte, when there was nothing to strip', () => {
    const uri = fullInvite({ relayUrl: undefined, podBacked: false, podUrl: undefined });
    const r = stripForBroadcast(uri);
    expect(r.stripped).toEqual([]);
    expect(r.uri).toBe(uri);
  });

  it('FAILS CLOSED on an invite it cannot parse', () => {
    // we cannot strip what we cannot read, so it must not be broadcast intact
    for (const bad of ['onderling-invite://!!!not-base64!!!', 'onderling-invite://', 'garbage']) {
      expect(stripForBroadcast(bad).ok).toBe(false);
    }
  });
});

describe('prepareBroadcastInvite', () => {
  it('publishes the stripped URI, not the one it was handed', () => {
    const r = prepareBroadcastInvite({ uri: fullInvite(), circleId: 'c1', allows: ALLOWS });
    expect(r.ok).toBe(true);
    expect(decode(r.invite.uri).relayUrl).toBeUndefined();
    expect(decode(r.invite.uri).podUrl).toBeUndefined();
    expect(decode(r.invite.uri).groupId).toBe('c1');
  });

  it('refuses an unreadable invite rather than putting it in the room', () => {
    const r = prepareBroadcastInvite({ uri: 'onderling-invite://!!!', circleId: 'c1', allows: ALLOWS });
    expect(r.ok).toBe(false);
    expect(r.reason).toBe('invite-unreadable');
  });

  it('still clamps the expiry — the strip did not displace the TTL ceiling', () => {
    const far = Date.now() + 24 * 60 * 60_000;
    const r = prepareBroadcastInvite({ uri: fullInvite({ expiresAt: far }), circleId: 'c1', expiresAt: far, allows: ALLOWS });
    expect(r.ok).toBe(true);
    expect(r.invite.expiresAt).toBeLessThan(far);
  });

  it('still refuses a circle that has not opted in to publishing', () => {
    const r = prepareBroadcastInvite({ uri: fullInvite(), circleId: 'c2', allows: ALLOWS });
    expect(r.ok).toBe(false);
    expect(r.reason).toBe('publish-not-allowed');
  });
});
