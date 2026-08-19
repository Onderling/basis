/**
 * verbose.js — env-var gated logging + plaintext-leak detector.
 * See coding-plans/sdk-two-device-smoke.md (Q-Smoke.4, locked 2026-04-29).
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  logHop,
  isVerboseEnabled,
  setVerboseEnabled,
  findPlaintextLeak,
  shortId,
} from '../src/verbose.js';

describe('verbose — env-var gating', () => {
  let logSpy;

  beforeEach(() => {
    logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
  });

  afterEach(() => {
    setVerboseEnabled(false);
    logSpy.mockRestore();
  });

  it('is silent when RELAY_VERBOSE is not set', () => {
    setVerboseEnabled(false);
    expect(isVerboseEnabled()).toBe(false);

    logHop({
      kind: 'send',
      from: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
      to:   'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
      envelope: { _p: 'mesh', body: 'opaque' },
    });

    expect(logSpy).not.toHaveBeenCalled();
  });

  it('emits a per-hop line when RELAY_VERBOSE is on', () => {
    setVerboseEnabled(true);
    expect(isVerboseEnabled()).toBe(true);

    logHop({
      kind: 'send',
      from: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
      to:   'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
      envelope: { _p: 'mesh', body: 'AB12CD34EF56==' },  // base64-noise; no leak
    });

    expect(logSpy).toHaveBeenCalled();
    const lines = logSpy.mock.calls.map(c => c[0]);
    const hopLine = lines.find(l => l.includes('kind=send'));
    expect(hopLine).toBeTruthy();
    expect(hopLine).toMatch(/aaaaaaaaaaaa…/);
    expect(hopLine).toMatch(/bbbbbbbbbbbb…/);
    expect(hopLine).toMatch(/_p=mesh/);
    expect(hopLine).toMatch(/bytes=\d+/);
  });

  it('flags an unsealed payload as a potential leak', () => {
    setVerboseEnabled(true);

    logHop({
      kind: 'send',
      from: 'alice-pubkey-aaaaaaaa',
      to:   'bob-pubkey-bbbbbbbbbb',
      envelope: {
        _p: 'OW', _from: 'alice-pubkey-aaaaaaaa', _to: 'bob-pubkey-bbbbbbbbbb',
        payload: { text: 'Hello Bob, this is Alice — meeting at 3pm.' },
      },
    });

    const lines = logSpy.mock.calls.map(c => c[0]);
    const leak  = lines.find(l => l.includes('potential plaintext leak'));
    expect(leak).toBeTruthy();
    // It says WHICH contract broke, rather than gesturing at "looks like English".
    expect(leak).toMatch(/marker=unsealed-payload/);
    // Addressing info so an operator can correlate…
    expect(leak).toMatch(/from=alice-pubkey/);
    expect(leak).toMatch(/to=bob-pubkey/);
    // …and the excerpt is `shortId`-length, so the alarm cannot itself become the leak.
    const excerpt = JSON.parse(leak.slice(leak.indexOf('excerpt=') + 'excerpt='.length));
    expect(excerpt.length).toBeLessThanOrEqual(shortId('x'.repeat(200)).length);
    expect(leak).not.toContain('meeting at 3pm');
  });

  it('does NOT flag a genuinely sealed envelope — the shape SecurityLayer produces', () => {
    setVerboseEnabled(true);

    // `SecurityLayer.encrypt` replaces `payload` with `{ _box: <base64 nonce‖ciphertext> }` and
    // leaves the routing header in cleartext. That is the whole sealed contract, so this must be
    // silent no matter what the base64 happens to spell.
    const box =
      'eyJjaXBoZXJ0ZXh0IjoiTjlSeDhWN0pMcEttd0F1OERvVHlSNkZMbWFTcUxpbW' +
      'JjV3JhYzVRRG10b2VuMTNoeFhsRkVnNXJZcXVOSlJqVzg4NEN5UE52VkdSakZS' +
      'NXp4S0M3a3IzcWlncTl3M0F0Q3hBcEY9PSIsIm5vbmNlIjoieHJZc1ZQRVNVbm' +
      '1NeFNuajNNTk5PWk1pNFE2RlVTVWNWdyIsImVwaCI6IjV2VkVEZHowU2pHRG9G' +
      'aHAxQzJDU3JpaGVQNGZxR3pVNlBQVU5OcGFybTAifQ==';

    logHop({
      kind: 'send',
      from: 'alice', to: 'bob',
      envelope: {
        _v: 1, _p: 'OW', _id: 'abc', _re: null, _from: 'alice', _to: 'bob',
        _topic: null, _ts: 1, _sig: 'sig', payload: { _box: box },
      },
    });

    const lines = logSpy.mock.calls.map(c => c[0]);
    expect(lines.find(l => l.includes('potential plaintext leak'))).toBeFalsy();
  });

  it('flags readable structure smuggled beside the routing header', () => {
    const leak = findPlaintextLeak({
      _p: 'OW', _from: 'alice', _to: 'bob',
      payload: { _box: 'AAAA' },
      note: 'this is a secret love letter to bob',
    });
    expect(leak.marker).toBe('readable-outside-payload');
    expect(leak.excerpt).toContain('note');
  });

  it('flags a bare application object handed straight to the wire', () => {
    // No envelope around it at all — the `_put(bare payload)` case. Readable by the relay, so it
    // is a leak, and the canary should say so rather than judge the prose.
    const leak = findPlaintextLeak({ subtype: 'circle-chat-message', text: 'hoi allemaal' });
    expect(leak.marker).toBe('readable-outside-payload');
  });

  it('leaves plaintext-by-design and header-only bodies alone', () => {
    // HI is the agent-card hello: signed plaintext on purpose, not a leak.
    expect(findPlaintextLeak({ _p: 'HI', _from: 'alice', payload: { card: 'x' } })).toBeNull();
    // A bare sealed box — a `multi-deliver` payload the caller sealed itself.
    expect(findPlaintextLeak({ _box: 'AAAA' })).toBeNull();
    // Nothing but routing header.
    expect(findPlaintextLeak({ _p: 'OW', _from: 'alice', _to: 'bob' })).toBeNull();
    expect(findPlaintextLeak(null)).toBeNull();
    expect(findPlaintextLeak(123)).toBeNull();
  });
});

describe('verbose — shortId', () => {
  it('truncates long ids with an ellipsis', () => {
    expect(shortId('abcdefghijklmnopqrstuvwxyz')).toBe('abcdefghijkl…');
  });
  it('passes short ids through unchanged', () => {
    expect(shortId('alice')).toBe('alice');
  });
  it('renders nullish ids as "?"', () => {
    expect(shortId(null)).toBe('?');
    expect(shortId(undefined)).toBe('?');
  });
});
