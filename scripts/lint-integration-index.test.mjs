/**
 * Self-test for the integration-index guard (a guard whose test is red is not a guard — guards.mjs runs
 * `vitest run scripts/`). Asserts the guard is GREEN on the current tree: the index matches disk.
 */
import { describe, it, expect } from 'vitest';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { INTEGRATION_TESTS, discoverCssTests } from './integration-index.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));

describe('integration-index guard', () => {
  it('the index is in sync with the on-disk *.css.test.js set', () => {
    const r = spawnSync(process.execPath, [path.join(HERE, 'lint-integration-index.mjs')], { encoding: 'utf8' });
    expect(r.stdout + r.stderr).toMatch(/in sync with disk/);
    expect(r.status).toBe(0);
  });

  it('every on-disk integration test is indexed (belt-and-braces, in-process)', () => {
    const indexed = new Set(INTEGRATION_TESTS.map((t) => t.file));
    const missing = discoverCssTests().filter((f) => !indexed.has(f));
    expect(missing, `not indexed: ${missing.join(', ')}`).toEqual([]);
  });
});
