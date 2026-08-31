/**
 * NOTE (2026-08-31, locale consolidation): five expectations here changed text, not behaviour. These
 * strings were defined in BOTH shells' bundles with different wording — this projector is shared, so
 * the same status line read differently on a phone than in a browser. Consolidating to one source
 * forced a pick per string; the mobile phrasing won four ("{{ago}} ago" rather than "stale {{ago}}
 * ago", which is not English), and the web phrasing won "synced to {{ok}}/{{total}} peers", because
 * "synced to 3 of 5" does not say five of what. → plans/PLAN-locale-consolidation.md, ledger L68.
 */
/**
 * basis — sync-hint tests.  v0.6 sub-slices 6.1 + 6.2.
 */
import { describe, it, expect, beforeAll } from 'vitest';

import {
  formatSyncHints, formatLastSync, relativeAgo,
} from '../src/syncHints.js';
import { initLocalisation, t } from '../src/localisation.js';

beforeAll(async () => { await initLocalisation({ lng: 'en' }); });

const NOW = () => 1_700_000_000_000;

describe('relativeAgo', () => {
  it.each([
    [0,             '0s'],
    [30_000,        '30s'],
    [60_000,        '1m'],
    [3_500_000,     '58m'],
    [3_600_000,     '1h'],
    [86_399_000,    '23h'],
    [86_400_000,    '1d'],
    [86_400_000 * 7,'7d'],
  ])('delta %d ms → %s', (delta, expected) => {
    expect(relativeAgo(NOW() - delta, NOW())).toBe(expected);
  });

  it('clamps negative deltas to 0', () => {
    expect(relativeAgo(NOW() + 5_000, NOW())).toBe('0s');
  });
});

describe('formatSyncHints — central style', () => {
  it("emits empty string (server is the source of truth)", () => {
    expect(formatSyncHints({ style: 'central' }, t, NOW)).toBe('');
  });
});

describe('formatSyncHints — decentralized style', () => {
  it('shows "synced to N/M peers"', () => {
    expect(formatSyncHints({
      style: 'decentralized',
      peers:   ['webid:a', 'webid:b'],
      pending: [], unreachable: [],
    }, t, NOW)).toBe('synced to 2/2 peers');
  });

  it('appends pending count when > 0', () => {
    expect(formatSyncHints({
      style: 'decentralized',
      peers: ['webid:a'], pending: ['webid:b'], unreachable: [],
    }, t, NOW)).toBe('synced to 1/2 peers · 1 pending');
  });

  it('appends unreachable list when > 0', () => {
    expect(formatSyncHints({
      style: 'decentralized',
      peers: ['webid:a'], pending: [], unreachable: ['webid:b', 'webid:c'],
    }, t, NOW)).toBe('synced to 1/3 peers · 2 unreachable (webid:b, webid:c)');
  });

  it("returns 'saved locally; awaiting peer sync' when no peers at all (OQ-6.A catch-up)", () => {
    expect(formatSyncHints({
      style: 'decentralized', peers: [], pending: [], unreachable: [],
    }, t, NOW)).toBe('saved locally — awaiting peer sync');
  });
});

describe('formatSyncHints — pod-less style', () => {
  it("shows oldest last-seen across peers", () => {
    const lastSeen = {
      'webid:a': NOW() - 60_000,         // 1 min ago
      'webid:b': NOW() - 7_200_000,      // 2h ago  ← oldest
      'webid:c': NOW() - 3_600_000,      // 1h ago
    };
    expect(formatSyncHints({ style: 'pod-less', lastSeen }, t, NOW))
      .toBe('3 peers · last seen 2h ago');
  });

  it("empty lastSeen → 'no peers polled yet'", () => {
    expect(formatSyncHints({ style: 'pod-less', lastSeen: {} }, t, NOW))
      .toBe('no peers polled yet');
  });
});

describe('formatSyncHints — defensive cases', () => {
  it.each([null, undefined, 'not-an-object', 42])('returns "" for %j', (input) => {
    expect(formatSyncHints(input, t, NOW)).toBe('');
  });

  it('returns "" for unknown style', () => {
    expect(formatSyncHints({ style: 'galactic' }, t, NOW)).toBe('');
  });
});

describe('formatLastSync', () => {
  it('formats epoch ms as "stale Xh ago"', () => {
    expect(formatLastSync(NOW() - 7_200_000, t, NOW)).toBe('2h ago');
  });

  it('returns "" for non-number input', () => {
    expect(formatLastSync(undefined, t, NOW)).toBe('');
    expect(formatLastSync(null,      t, NOW)).toBe('');
    expect(formatLastSync('2h ago',  t, NOW)).toBe('');
    expect(formatLastSync(NaN,       t, NOW)).toBe('');
  });
});
