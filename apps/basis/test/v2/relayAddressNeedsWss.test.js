// Every place the app takes a relay address from (the device setting, a typed connection point, a contact card, an
// invite link, an invite it writes) uses the one rule `relayAddressRefusal`: plain ws only to the own machine or
// network. The transport refuses the rest anyway; these make the app drop or name it before it gets that far.
import { describe, it, expect } from 'vitest';
import { normalizeRelayUrl, resolveRelayUrl } from '../../src/v2/relayPref.js';
import { createConnectionPoints, isRelayUrl, pointAddErrorKey } from '../../src/v2/connectionPoints.js';
import { parseInviteDeepLink } from '../../src/v2/inviteDeepLink.js';

const PUBLIC_PLAIN = 'ws://relay.test:8787';
const PUBLIC_TLS = 'wss://relay.test';
const HOME_PLAIN = 'ws://192.168.2.20:8787';

describe('the app takes a relay address only over wss outside the own network', () => {
  it('isRelayUrl: wss anywhere, plain ws at home, nothing else', () => {
    expect(isRelayUrl(PUBLIC_TLS)).toBe(true);
    expect(isRelayUrl(HOME_PLAIN)).toBe(true);
    expect(isRelayUrl(PUBLIC_PLAIN)).toBe(false);
    expect(isRelayUrl('https://relay.test')).toBe(false);
  });

  it('the device setting drops a plain public address and falls through to the next candidate', () => {
    expect(normalizeRelayUrl(PUBLIC_PLAIN)).toBe('');
    expect(normalizeRelayUrl(HOME_PLAIN)).toBe(HOME_PLAIN);
    expect(resolveRelayUrl(PUBLIC_PLAIN, PUBLIC_TLS)).toBe(PUBLIC_TLS);
  });

  it('a typed point is refused with its own reason, and the screens show their own words for it', () => {
    const store = createConnectionPoints({ initial: null, save: () => {} });
    const r = store.addManually(PUBLIC_PLAIN);
    expect(r).toEqual({ ok: false, reason: 'plain-ws-public' });
    expect(pointAddErrorKey(r.reason)).toBe('circle.nearbyScreen.point_add_plain_ws');
    expect(pointAddErrorKey('invalid-url')).toBe('circle.nearbyScreen.point_add_invalid');
    expect(store.addManually(PUBLIC_TLS).ok).toBe(true);
    expect(store.addFromContact(PUBLIC_PLAIN).ok).toBe(false);
    expect(store.addFromJoin(PUBLIC_PLAIN, 'c1').ok).toBe(false);
  });

  it('an invite link naming a plain public relay names none', () => {
    const link = `https://onderling.org/basis/?join=onderling-invite%3Axyz&relay=${encodeURIComponent(PUBLIC_PLAIN)}`;
    expect(parseInviteDeepLink(link).relayUrl).toBe(null);
    const ok = `https://onderling.org/basis/?join=onderling-invite%3Axyz&relay=${encodeURIComponent(PUBLIC_TLS)}`;
    expect(parseInviteDeepLink(ok).relayUrl).toBe(PUBLIC_TLS);
  });
});
