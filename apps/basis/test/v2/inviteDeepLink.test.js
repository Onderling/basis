// The invite deep link points at the app wherever it is served — root, a path, a file — never at a hardcoded root.
import { describe, it, expect } from 'vitest';
import { appBaseUrl, inviteDeepLink } from '../../src/v2/inviteDeepLink.js';

const at = (origin, pathname) => ({ origin, pathname });

describe('appBaseUrl', () => {
  it('site root', () => expect(appBaseUrl(at('https://onderling.org', '/'))).toBe('https://onderling.org/'));
  it('a path under the site (the hosted build)', () => expect(appBaseUrl(at('https://onderling.org', '/basis/'))).toBe('https://onderling.org/basis/'));
  it('a path without the trailing slash', () => expect(appBaseUrl(at('https://onderling.org', '/basis'))).toBe('https://onderling.org/'));
  it('index.html stripped', () => expect(appBaseUrl(at('https://onderling.org', '/basis/index.html'))).toBe('https://onderling.org/basis/'));
  it('localhost dev server', () => expect(appBaseUrl(at('http://localhost:5173', '/'))).toBe('http://localhost:5173/'));
});

describe('inviteDeepLink', () => {
  it('carries the invite and the relay, encoded the way the ?join reader decodes them', () => {
    const link = inviteDeepLink(at('https://onderling.org', '/basis/'), 'onderling-invite://abc/def', 'wss://relay.onderling.org');
    expect(link).toBe('https://onderling.org/basis/?join=onderling-invite%3A%2F%2Fabc%2Fdef&relay=wss%3A%2F%2Frelay.onderling.org');
    const u = new URL(link);
    expect(u.searchParams.get('join')).toBe('onderling-invite://abc/def');
    expect(u.searchParams.get('relay')).toBe('wss://relay.onderling.org');
  });
  it('no relay → no relay parameter', () => {
    expect(inviteDeepLink(at('https://x.org', '/'), 'onderling-invite://a')).toBe('https://x.org/?join=onderling-invite%3A%2F%2Fa');
  });
});
