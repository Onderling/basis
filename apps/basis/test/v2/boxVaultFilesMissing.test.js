/**
 * The box: a missing vault file beside other state is a loss, not a first start; failed starts are counted in a row
 * (ledger L1115, Fable's review section 2 point 7).
 */
import { describe, it, expect } from 'vitest';
import { mkdtempSync, rmSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { vaultFilesMissing, startFailures, startBackoffMs, failureIsPermanent } from '../../src/v2/boxStorage.js';

const D = '/data';
const has = (...names) => (p) => names.some((n) => p === path.join(D, n));

describe('the box\'s vault files (L1115)', () => {
  it('no box-started mark: a first start (also one cut short half-way): go on', () => {
    expect(vaultFilesMissing(D, has())).toEqual([]);
    expect(vaultFilesMissing(D, has('vault.json', 'registry', 'agent-vaults'))).toEqual([]);   // killed before chat-vault.json
  });
  it('a folder that ran a box (its mark) with both vault files: go on', () => {
    expect(vaultFilesMissing(D, has('box-started', 'vault.json', 'chat-vault.json', 'registry'))).toEqual([]);
  });
  it('no mark but a registry row (a box from before the mark): it ran a box; an empty registry does not count', () => {
    const rows = (...names) => (dir) => (dir === path.join(D, 'registry') ? names : []);
    expect(vaultFilesMissing(D, has('vault.json', 'registry'), rows('0d94a5.json'))).toEqual(['chat-vault.json']);
    expect(vaultFilesMissing(D, has('vault.json', 'chat-vault.json', 'registry'), rows('0d94a5.json'))).toEqual([]);
    expect(vaultFilesMissing(D, has('vault.json', 'registry'), rows())).toEqual([]);   // a first start cut short
    expect(vaultFilesMissing(D, has('vault.json'), () => { throw new Error('ENOENT'); })).toEqual([]);
  });
  it('a folder that ran a box, its chat vault missing (a backup put back without it): a loss', () => {
    expect(vaultFilesMissing(D, has('box-started', 'vault.json', 'device-log'))).toEqual(['chat-vault.json']);
  });
});

describe('back-off and what holds (L1115)', () => {
  it('waits 1, 2, 4 … minutes, at most two hours', () => {
    expect([1, 2, 3, 4].map(startBackoffMs)).toEqual([60_000, 120_000, 240_000, 480_000]);
    expect(startBackoffMs(20)).toBe(2 * 60 * 60_000);
  });
  it('only a key that fails to decrypt cannot pass by itself', () => {
    expect(failureIsPermanent(Object.assign(new Error('a key'), { cause: new Error('VaultEncrypted: decrypt failed') }))).toBe(true);
    expect(failureIsPermanent(Object.assign(new Error('a key'), { cause: new Error('EIO: read failed') }))).toBe(false);
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
      // a failure further than the window from the last starts a new run
      expect(f.note('content-key', new Date('2026-11-21T10:00:00Z'))).toMatchObject({ count: 1, since: '2026-11-21T10:00:00.000Z' });
      f.clear();
      expect(f.read()).toBe(null);
      expect(f.note('content-key').count).toBe(1);
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });
});
