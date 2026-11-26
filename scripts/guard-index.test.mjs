/**
 * Self-test for the guard-index generator (guards.mjs runs `vitest run scripts/`). Keeps `docs/guards.md`
 * in sync with the actual guards, and asserts every script guard yields a real claim (so the map stays
 * legible, not a wall of "—").
 */
import { describe, it, expect, vi } from 'vitest';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { scriptGuards, cleanClaim } from './guard-index.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));

describe('guard-index', () => {
  it('docs/guards.md is fresh (run `npm run guard-index` to refresh)', () => {
    const r = spawnSync(process.execPath, [path.join(HERE, 'guard-index.mjs'), '--check'], { encoding: 'utf8' });
    expect(r.stdout + r.stderr).toMatch(/fresh/);
    expect(r.status).toBe(0);
  });

  it('every script guard yields a non-empty claim (headers stay parseable)', () => {
    const missing = scriptGuards().filter((g) => !g.claim || g.claim === '—').map((g) => g.name);
    expect(missing, `guards whose header the index could not read a claim from: ${missing.join(', ')}`).toEqual([]);
  });

  // The index must not depend on the order the file system lists a directory in: that order differs between a
  // laptop and a CI runner, so an order-dependent index is fresh on one and stale on the other (seen 2026-11-26:
  // a PR fresh locally went red in the merge queue with the same files).
  it('the index is the same whatever order the file system lists directories in', async () => {
    vi.resetModules();
    const plain = (await import('./guard-index.mjs')).generate();
    vi.doMock('node:fs', async (orig) => {
      const fs = await orig();
      const readdirSync = (...a) => fs.readdirSync(...a).slice().reverse();
      return { ...fs, default: { ...fs.default, readdirSync }, readdirSync };
    });
    vi.resetModules();
    const reversed = (await import('./guard-index.mjs')).generate();
    vi.doUnmock('node:fs');
    vi.resetModules();
    expect(reversed).toBe(plain);
  });

  // Nor on the machine's locale: localeCompare follows it, and CI's locale is not a laptop's.
  it('the index is the same whatever the locale orders', async () => {
    vi.resetModules();
    const plain = (await import('./guard-index.mjs')).generate();
    const orig = String.prototype.localeCompare;
    String.prototype.localeCompare = function inverted(other) { return -orig.call(this, other); };
    try {
      vi.resetModules();
      expect((await import('./guard-index.mjs')).generate()).toBe(plain);
    } finally {
      String.prototype.localeCompare = orig;
    }
  });

  it('cleanClaim strips the id + leading separators', () => {
    expect(cleanClaim('G-C1 — one store per circle', 'G-C1')).toBe('one store per circle');
  });
});
