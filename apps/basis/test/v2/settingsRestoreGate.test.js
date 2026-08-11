import { describe, it, expect, vi } from 'vitest';
import {
  probeSettingsMedium,
  isSealingOpenFailure,
  isProbeSafeToAttach,
  SETTINGS_SHARED_PROBE_PATH,
} from '../../src/v2/settingsRestoreGate.js';

const mediumThatReads = (impl) => ({ read: vi.fn(impl) });

describe('settingsRestoreGate — probe-before-flush classification', () => {
  it('openable: read returns a value → we hold the key', async () => {
    const m = mediumThatReads(async () => JSON.stringify({ retention: 30 }));
    expect(await probeSettingsMedium(m)).toBe('openable');
    expect(m.read).toHaveBeenCalledWith(SETTINGS_SHARED_PROBE_PATH);
  });

  it('missing: read returns null → fresh / first device (a 404 is null upstream)', async () => {
    expect(await probeSettingsMedium(mediumThatReads(async () => null))).toBe('missing');
  });

  it('undecryptable: a sealing-layer secretbox failure → sealed under a different key', async () => {
    const m = mediumThatReads(async () => { throw new Error('sealing: secretbox open failed (wrong key or corrupt envelope)'); });
    expect(await probeSettingsMedium(m)).toBe('undecryptable');
  });

  it('undecryptable: a sealing-layer not-a-recipient failure → also a key mismatch', async () => {
    const m = mediumThatReads(async () => { throw new Error('sealing: not a recipient of this sealed resource'); });
    expect(await probeSettingsMedium(m)).toBe('undecryptable');
  });

  it('transport: a network failure is NOT a key mismatch — must never be accused as one', async () => {
    const m = mediumThatReads(async () => { throw new Error('NetworkError: failed to fetch'); });
    expect(await probeSettingsMedium(m)).toBe('transport');
  });

  it('transport: a 5xx is transport, not undecryptable', async () => {
    const m = mediumThatReads(async () => { throw new Error('500 Internal Server Error'); });
    expect(await probeSettingsMedium(m)).toBe('transport');
  });

  it('transport: a malformed / missing medium never claims a mismatch', async () => {
    expect(await probeSettingsMedium(null)).toBe('transport');
    expect(await probeSettingsMedium({})).toBe('transport');
  });
});

describe('isSealingOpenFailure — the decrypt-vs-transport discriminator', () => {
  it('matches the sealing: namespace only', () => {
    expect(isSealingOpenFailure(new Error('sealing: secretbox open failed'))).toBe(true);
    expect(isSealingOpenFailure(new Error('sealing: not a recipient of this sealed resource'))).toBe(true);
    expect(isSealingOpenFailure(new Error('sealing: unknown envelope version 3'))).toBe(true);
  });
  it('rejects transport / unknown errors and non-errors', () => {
    expect(isSealingOpenFailure(new Error('NetworkError'))).toBe(false);
    expect(isSealingOpenFailure(new Error('403 Forbidden'))).toBe(false);
    expect(isSealingOpenFailure({})).toBe(false);
    expect(isSealingOpenFailure(undefined)).toBe(false);
    expect(isSealingOpenFailure('sealing: not an Error object')).toBe(false);
  });
});

describe('isProbeSafeToAttach — only openable/missing may flush', () => {
  it('safe: openable + missing', () => {
    expect(isProbeSafeToAttach('openable')).toBe(true);
    expect(isProbeSafeToAttach('missing')).toBe(true);
  });
  it('unsafe: undecryptable + transport HOLD (no flush)', () => {
    expect(isProbeSafeToAttach('undecryptable')).toBe(false);
    expect(isProbeSafeToAttach('transport')).toBe(false);
  });
});

// ── #44 — the restore choices' substrate ────────────────────────────────────────────────────────

describe('probeSettingsMediumDetailed — the probe with the pod blob in hand', () => {
  it('openable carries the VALUE (capture-then-flush needs it before attachInner overwrites)', async () => {
    const blob = { 'retention.chat': 1000 };
    const { probeSettingsMediumDetailed } = await import('../../src/v2/settingsRestoreGate.js');
    const res = await probeSettingsMediumDetailed({ read: async () => blob });
    expect(res).toEqual({ status: 'openable', value: blob });
  });

  it('missing / undecryptable / transport carry null', async () => {
    const { probeSettingsMediumDetailed } = await import('../../src/v2/settingsRestoreGate.js');
    expect(await probeSettingsMediumDetailed({ read: async () => null })).toEqual({ status: 'missing', value: null });
    expect(await probeSettingsMediumDetailed({ read: async () => { throw new Error('sealing: secretbox open failed'); } }))
      .toEqual({ status: 'undecryptable', value: null });
    expect(await probeSettingsMediumDetailed({ read: async () => { throw new Error('fetch failed'); } }))
      .toEqual({ status: 'transport', value: null });
  });
});

describe('computeSettingsConflicts — the one differ both shells ride', () => {
  it('a conflict is a key BOTH sides hold with different values; one-sided keys are not conflicts', async () => {
    const { computeSettingsConflicts } = await import('../../src/v2/settingsRestoreGate.js');
    const conflicts = computeSettingsConflicts(
      { a: 1, b: 2, mineOnly: 9 },
      { a: 1, b: 3, theirsOnly: 7 },
    );
    expect(conflicts).toEqual([{ key: 'b', mine: 2, theirs: 3 }]);
  });

  it('null/absent blobs mean no conflicts', async () => {
    const { computeSettingsConflicts } = await import('../../src/v2/settingsRestoreGate.js');
    expect(computeSettingsConflicts(null, { a: 1 })).toEqual([]);
    expect(computeSettingsConflicts({ a: 1 }, null)).toEqual([]);
  });
});
