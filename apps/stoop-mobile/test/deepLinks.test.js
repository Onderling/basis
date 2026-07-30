/**
 * deepLinks — Stoop V3 Phase 40.11.
 *
 * Coverage for `parseDeepLink` + `actionToNavigation`.
 */

import { describe, it, expect } from 'vitest';
import { parseDeepLink, actionToNavigation } from '../src/lib/deepLinks.js';
import { ROUTES } from '../src/navigation.js';

describe('parseDeepLink', () => {
  it('returns unknown for non-stoop:// URLs', () => {
    expect(parseDeepLink('https://example.com').kind).toBe('unknown');
    expect(parseDeepLink('').kind).toBe('unknown');
    expect(parseDeepLink(null).kind).toBe('unknown');
    expect(parseDeepLink('mailto:nope@example').kind).toBe('unknown');
  });

  it('parses stoop:// (root) and stoop://welcome', () => {
    expect(parseDeepLink('stoop://').kind).toBe('welcome');
    expect(parseDeepLink('stoop://welcome').kind).toBe('welcome');
  });

  it('parses stoop://feed', () => {
    expect(parseDeepLink('stoop://feed').kind).toBe('feed');
  });

  it('parses stoop://invite?token=<json> with embedded JSON token', () => {
    const token = { groupId: 'oosterpoort', signature: 'sig' };
    const url = `stoop://invite?token=${encodeURIComponent(JSON.stringify(token))}`;
    const r = parseDeepLink(url);
    expect(r.kind).toBe('invite');
    expect(r.params.token.groupId).toBe('oosterpoort');
  });

  it('rejects stoop://invite with malformed token', () => {
    const url = 'stoop://invite?token=' + encodeURIComponent('{not-json');
    expect(parseDeepLink(url).kind).toBe('unknown');
  });

  it('rejects stoop://invite without a token', () => {
    expect(parseDeepLink('stoop://invite').kind).toBe('unknown');
  });

  it('parses stoop://contact?uri=<...>', () => {
    const uri = 'onderling-contact://bob?webid=https%3A%2F%2Fid.example';
    const url = `stoop://contact?uri=${encodeURIComponent(uri)}`;
    const r = parseDeepLink(url);
    expect(r.kind).toBe('contact');
    expect(r.params.uri).toBe(uri);
  });

  it('parses stoop://chat?thread=<id>&peer=<peer>', () => {
    const r = parseDeepLink('stoop://chat?thread=t1&peer=p1');
    expect(r.kind).toBe('chat');
    expect(r.params).toEqual({ thread: 't1', peer: 'p1' });
  });

  it('parses stoop://chat with peer only', () => {
    const r = parseDeepLink('stoop://chat?peer=p1');
    expect(r.kind).toBe('chat');
    expect(r.params.peer).toBe('p1');
  });

  it('rejects stoop://chat without thread or peer', () => {
    expect(parseDeepLink('stoop://chat').kind).toBe('unknown');
  });

  it('parses stoop://post?id=<id>', () => {
    const r = parseDeepLink('stoop://post?id=p123');
    expect(r.kind).toBe('post');
    expect(r.params.id).toBe('p123');
  });

  it('parses stoop://group?id=<gid>', () => {
    const r = parseDeepLink('stoop://group?id=oosterpoort');
    expect(r.kind).toBe('group');
    expect(r.params.id).toBe('oosterpoort');
  });

  it('parses stoop://auth/callback?code=...', () => {
    const r = parseDeepLink('stoop://auth/callback?code=abc&state=xyz');
    expect(r.kind).toBe('auth_callback');
    expect(r.params).toEqual({ code: 'abc', state: 'xyz' });
  });

  it('handles trailing slashes and stray whitespace', () => {
    expect(parseDeepLink('  stoop://feed/  ').kind).toBe('feed');
    expect(parseDeepLink('STOOP://welcome').kind).toBe('welcome');
  });

  it('returns unknown for an unrecognised path', () => {
    expect(parseDeepLink('stoop://something-else').kind).toBe('unknown');
  });
});

describe('actionToNavigation', () => {
  it('maps invite → OnboardScan with pendingInvite', () => {
    const a = { kind: 'invite', params: { token: { groupId: 'g1', signature: 's' } } };
    const t = actionToNavigation(a);
    expect(t).toEqual({
      name: ROUTES.OnboardScan,
      params: { pendingInvite: { groupId: 'g1', signature: 's' } },
    });
  });

  it('maps contact → Shell/Contacts with pendingContact', () => {
    const t = actionToNavigation({ kind: 'contact', params: { uri: 'onderling-contact://x' } });
    expect(t.name).toBe(ROUTES.Shell);
    expect(t.params.screen).toBe(ROUTES.Contacts);
    expect(t.params.params.pendingContact).toBe('onderling-contact://x');
  });

  it('maps chat → ChatThread with thread + peer ids', () => {
    const t = actionToNavigation({ kind: 'chat', params: { thread: 't1', peer: 'p1' } });
    expect(t).toEqual({
      name: ROUTES.ChatThread,
      params: { threadId: 't1', peerId: 'p1' },
    });
  });

  it('maps post → ItemDetail', () => {
    const t = actionToNavigation({ kind: 'post', params: { id: 'p1' } });
    expect(t).toEqual({ name: ROUTES.ItemDetail, params: { itemId: 'p1' } });
  });

  it('maps group → Group', () => {
    const t = actionToNavigation({ kind: 'group', params: { id: 'g1' } });
    expect(t).toEqual({ name: ROUTES.Group, params: { groupId: 'g1' } });
  });

  it('maps auth_callback → SignIn', () => {
    const t = actionToNavigation({ kind: 'auth_callback', params: { code: 'abc' } });
    expect(t).toEqual({ name: ROUTES.SignIn, params: { code: 'abc' } });
  });

  it('maps welcome → Welcome (pre-shell)', () => {
    expect(actionToNavigation({ kind: 'welcome' })).toEqual({ name: ROUTES.Welcome, params: undefined });
  });
  it('maps feed → Shell/Feed', () => {
    const t = actionToNavigation({ kind: 'feed' });
    expect(t.name).toBe(ROUTES.Shell);
    expect(t.params.screen).toBe(ROUTES.Feed);
  });

  it('returns null for unknown', () => {
    expect(actionToNavigation({ kind: 'unknown' })).toBeNull();
    expect(actionToNavigation(null)).toBeNull();
  });
});
