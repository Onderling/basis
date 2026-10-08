/**
 * A person's device always has a relay to dial.
 *
 * Mobile resolved its relay as (the saved setting, the build-time env) and nothing else — the env was set in no build,
 * so a phone with no saved relay dialled NO primary relay at all, and the public relay lived only in the box's docs and
 * the tests (found 2026-10-08 walking a phone whose saved value was a stale `ws://127.0.0.1:8787`). The default is now
 * ONE parameter, `relay.defaultUrl`, the LAST candidate: a saved/env relay wins, then a circle's recorded relay, and only
 * then the default. The settings field still shows only what was SAVED (it resolves without a default, on purpose).
 * The box is not in this: a headless node dials only what its operator set.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { DEFAULT_RELAY_URL, effectiveRelayUrl, resolveRelayUrl, relayDefaultFrom } from '../../src/v2/relayPref.js';
import { bootRelayUrl, bootRelayUrls } from '../../src/v2/connectionPoints.js';

describe('the default relay', () => {
  it('is the public relay, declared once', () => {
    expect(DEFAULT_RELAY_URL).toBe('wss://relay.onderling.org');
  });

  it('effectiveRelayUrl: nothing saved, no env → the default; a saved or env relay still wins', () => {
    expect(effectiveRelayUrl(null, '')).toBe(DEFAULT_RELAY_URL);
    expect(effectiveRelayUrl('ws://saved:1', 'wss://env.example')).toBe('ws://saved:1');
    expect(effectiveRelayUrl('', 'wss://env.example')).toBe('wss://env.example');
  });

  it('a composition can blank the default (tests stay hermetic): set but empty means NO default', () => {
    // The browser harness builds the app with VITE_CIRCLE_RELAY_DEFAULT='' — a "no-relay" project has no relay at all,
    // and no test can dial the production relay.
    expect(relayDefaultFrom('')).toBe('');
    expect(effectiveRelayUrl(null, '', '')).toBeNull();
    expect(relayDefaultFrom(undefined)).toBe(DEFAULT_RELAY_URL);
    expect(relayDefaultFrom(null)).toBe(DEFAULT_RELAY_URL);
    expect(relayDefaultFrom('ws://127.0.0.1:8788')).toBe('ws://127.0.0.1:8788');
  });

  it('resolveRelayUrl itself stays default-free — the settings field shows only what was saved', () => {
    expect(resolveRelayUrl(null, '')).toBeNull();
  });

  it('at boot it comes LAST: after the saved relay and after a circle\'s recorded relay', () => {
    const P = (url) => ({ url, kind: 'relay', adopted: true });
    expect(bootRelayUrl({ stored: null, list: [], fallback: DEFAULT_RELAY_URL })).toBe(DEFAULT_RELAY_URL);
    expect(bootRelayUrl({ stored: 'ws://saved:1', list: [], fallback: DEFAULT_RELAY_URL })).toBe('ws://saved:1');
    expect(bootRelayUrl({ stored: null, list: [P('ws://circle:2')], fallback: DEFAULT_RELAY_URL })).toBe('ws://circle:2');
    expect(bootRelayUrls({ stored: null, list: [], fallback: DEFAULT_RELAY_URL })).toEqual([DEFAULT_RELAY_URL]);
  });
});

describe('who dials it', () => {
  const read = (rel) => readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf8');
  it('web and mobile boot with the default as their fallback — the default a composition may blank', () => {
    for (const rel of ['../../web/v2/circleApp.js', '../../../basis-mobile/src/core/agentBundle.js']) {
      const src = read(rel);
      expect(src).toMatch(/relayDefaultFrom\(/);
      expect(src).toMatch(/fallback: RELAY_DEFAULT/);
    }
  });

  it('no browser under test can resolve the production hosts (both projects)', () => {
    const cfg = read('../../playwright.config.js');
    expect(cfg).toMatch(/MAP \*\.onderling\.org ~NOTFOUND/);
    expect(cfg.match(/launchOptions: HERMETIC_LAUNCH/g)?.length ?? 0).toBe(2);
  });

  it('the browser tests are built with the default blanked', () => {
    expect(read('../../playwright.config.js').match(/VITE_CIRCLE_RELAY_DEFAULT: ''/g)?.length ?? 0).toBeGreaterThanOrEqual(2);
  });
  it('the box does NOT dial it: with no ONDERLING_RELAY_URL it stays local-only, and its banner names the default', () => {
    const src = read('../../bin/device-runner.mjs');
    expect(src).toMatch(/const relayUrl = \(process\.env\.ONDERLING_RELAY_URL \?\? ''\)\.trim\(\);/);
    expect(src).toMatch(/DEFAULT_RELAY_URL/);
  });
});
