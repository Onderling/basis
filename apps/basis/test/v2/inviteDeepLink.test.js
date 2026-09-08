/**
 * The invite deep link, read back (2026-09-08). The app builds an https link carrying `?join=` and the
 * admin's relay; the native scanner only understood `onderling-invite://` and `?invite=`, so the app could
 * not read its own QR. One reader, both shells — this pins what it accepts.
 */
import { describe, it, expect } from 'vitest';
import { appBaseUrl, inviteDeepLink, parseInviteDeepLink } from '../../src/v2/inviteDeepLink.js';

const LOC = { origin: 'https://onderling.org', pathname: '/basis/index.html' };

describe('parseInviteDeepLink', () => {
  it('reads back exactly what inviteDeepLink writes, relay included', () => {
    const link = inviteDeepLink(LOC, 'onderling-invite://abc-123', 'wss://relay.onderling.org');
    expect(link.startsWith(`${appBaseUrl(LOC)}?join=`)).toBe(true);
    expect(parseInviteDeepLink(link)).toEqual({ inviteUri: 'onderling-invite://abc-123', relayUrl: 'wss://relay.onderling.org' });
  });

  it('a link without a relay, and the older ?invite= form, both parse', () => {
    expect(parseInviteDeepLink(inviteDeepLink(LOC, 'onderling-invite://abc'))).toEqual({ inviteUri: 'onderling-invite://abc', relayUrl: null });
    expect(parseInviteDeepLink('https://x.example/?invite=onderling-invite%3A%2F%2Fzz')).toEqual({ inviteUri: 'onderling-invite://zz', relayUrl: null });
  });

  it('a bare invite URI passes through — there is nothing to unpack and no relay to learn', () => {
    expect(parseInviteDeepLink('onderling-invite://abc')).toEqual({ inviteUri: 'onderling-invite://abc', relayUrl: null });
    expect(parseInviteDeepLink('  {"groupId":"g"}  ')).toEqual({ inviteUri: '{"groupId":"g"}', relayUrl: null });
  });

  it('a relay that is not a websocket endpoint names nothing — the invite still stands', () => {
    expect(parseInviteDeepLink('https://x.example/?join=inv&relay=https://evil.example')).toEqual({ inviteUri: 'inv', relayUrl: null });
  });

  it('anything that is not an invite is null, including a plain page and rubbish', () => {
    for (const bad of ['https://onderling.org/basis/', 'hello', '', null, undefined, 42]) {
      expect(parseInviteDeepLink(bad)).toBeNull();
    }
  });
});
