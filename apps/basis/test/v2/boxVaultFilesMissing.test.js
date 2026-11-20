/**
 * The box: a missing vault file beside other state is a loss, not a first start; failed starts are counted in a row
 * (ledger L1115, Fable's review section 2 point 7).
 */
import { describe, it, expect } from 'vitest';
import { mkdtempSync, rmSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { vaultFilesMissing, startFailures } from '../../src/v2/boxStorage.js';

const D = '/data';
const has = (...names) => (p) => names.some((n) => p === path.join(D, n));

describe('the box\'s vault files (L1115)', () => {
  it('an empty folder is a first start', () => {
    expect(vaultFilesMissing(D, has())).toEqual([]);
  });
  it('both vault files beside the rest: go on', () => {
    expect(vaultFilesMissing(D, has('vault.json', 'chat-vault.json', 'registry', 'device-log'))).toEqual([]);
  });
  it('the chat vault missing beside a device log and the other vault: a loss', () => {
    expect(vaultFilesMissing(D, has('vault.json', 'device-log', 'household-items.json'))).toEqual(['chat-vault.json']);
  });
  it('both missing beside a box\'s content (a restored data folder without its vaults): a loss', () => {
    expect(vaultFilesMissing(D, has('registry', 'settings.json'))).toEqual(['vault.json', 'chat-vault.json']);
  });
});

describe('failed starts in a row (L1115)', () => {
  it('count up with the first one\'s time, and clear when the box comes up', () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'box-failures-'));
    try {
      mkdirSync(dir, { recursive: true });
      const f = startFailures(dir);
      const a = f.note('content-key', new Date('2026-11-20T10:00:00Z'));
      const b = f.note('host-key', new Date('2026-11-20T10:01:00Z'));
      expect(a).toMatchObject({ count: 1, since: '2026-11-20T10:00:00.000Z' });
      expect(b).toMatchObject({ count: 2, since: '2026-11-20T10:00:00.000Z', last: 'host-key' });
      f.clear();
      expect(f.read()).toBe(null);
      expect(f.note('content-key').count).toBe(1);
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });
});
