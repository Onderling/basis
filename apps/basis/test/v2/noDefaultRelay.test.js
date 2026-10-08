/**
 * There is no default relay.
 *
 * The relay is a setting a person makes (or an invite/enroll offer carries it), and a running agent may be GIVEN one as
 * an argument (env / boot flag) — never a literal in the code. The resolver is: the saved setting → the env/argument →
 * a circle's recorded points → none. A device with none of these stays on NKN/local; it does not dial anyone's relay.
 *
 * The browser tests stay hermetic on their own: Chromium resolves no host but this machine, so nothing under test can
 * reach a public relay (or NKN's hosts) whatever the code does.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import * as relayPref from '../../src/v2/relayPref.js';
import { bootRelayUrl, bootRelayUrls } from '../../src/v2/connectionPoints.js';

const read = (rel) => readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf8');

describe('no default relay', () => {
  it('nothing saved, no env, nothing recorded → no relay at all', () => {
    expect(relayPref.resolveRelayUrl(null, '')).toBeNull();
    expect(bootRelayUrl({ stored: null, list: [] })).toBeNull();
    expect(bootRelayUrls({ stored: null, list: [] })).toEqual([]);
  });

  it('the order stands: saved → env/argument → a circle\'s recorded relay', () => {
    const P = (url) => ({ url, kind: 'relay', adopted: true });
    expect(relayPref.resolveRelayUrl('ws://saved:1', 'wss://env.test')).toBe('ws://saved:1');
    expect(relayPref.resolveRelayUrl('', 'wss://env.test')).toBe('wss://env.test');
    expect(bootRelayUrl({ stored: null, list: [P('ws://circle:2')] })).toBe('ws://circle:2');
  });

  it('the relay module declares no default', () => {
    expect(relayPref.DEFAULT_RELAY_URL).toBeUndefined();
    expect(relayPref.effectiveRelayUrl).toBeUndefined();
    expect(read('../../src/v2/relayPref.js')).not.toMatch(/relay\.defaultUrl/);
  });

  it('web and mobile boot without a fallback relay', () => {
    for (const rel of ['../../web/v2/circleApp.js', '../../../basis-mobile/src/core/agentBundle.js']) {
      expect(read(rel)).not.toMatch(/fallback:\s*\w*RELAY/);
    }
  });
});

describe('the browser tests are hermetic', () => {
  it('no browser under test can resolve any host but this machine (both projects)', () => {
    const cfg = read('../../playwright.config.js');
    expect(cfg).toMatch(/MAP \* ~NOTFOUND, EXCLUDE localhost, EXCLUDE 127\.0\.0\.1/);
    expect(cfg.match(/launchOptions: HERMETIC_LAUNCH/g)?.length ?? 0).toBe(2);
  });
});
