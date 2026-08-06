/**
 * Self-test for the guard-index generator (guards.mjs runs `vitest run scripts/`). Keeps `docs/guards.md`
 * in sync with the actual guards, and asserts every script guard yields a real claim (so the map stays
 * legible, not a wall of "—").
 */
import { describe, it, expect } from 'vitest';
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

  it('cleanClaim strips the id + leading separators', () => {
    expect(cleanClaim('G-C1 — one store per circle', 'G-C1')).toBe('one store per circle');
  });
});
