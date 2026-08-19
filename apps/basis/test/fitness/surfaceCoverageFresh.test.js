/**
 * FITNESS FUNCTION — the manifest↔surface coverage snapshot stays fresh.
 *
 * CLAUDE.md invariant #4: the manifest is the source of truth for surfaces;
 * after any manifest change, regenerate + commit the coverage snapshot
 * (`npm run coverage` → docs/surface-coverage.md). This makes that automatic by
 * running the REAL generator and diffing its output against the committed file.
 * A manifest edit that forgets to refresh the snapshot — or a manifest that
 * silently fails to import and drops out of coverage (the generator logs a skip
 * to stderr) — FAILS CI here.
 *
 * @vitest-environment node
 */
import { describe, it, expect } from 'vitest';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const appRoot = fileURLToPath(new URL('../../', import.meta.url));

function runGenerator() {
  // Capture stdout (the markdown) and stderr (skip notices) separately.
  let stdout = ''; let stderr = '';
  try {
    stdout = execFileSync('node', ['scripts/surface-coverage.mjs'], { cwd: appRoot, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  } catch (e) {
    stdout = e.stdout?.toString?.() ?? '';
    stderr = e.stderr?.toString?.() ?? '';
    throw new Error(`surface-coverage.mjs failed: ${stderr || e.message}`);
  }
  return { stdout, stderr };
}

describe('FITNESS: surface-coverage snapshot', () => {
  it('matches the committed docs/surface-coverage.md (run `npm run coverage` to refresh)', () => {
    const { stdout } = runGenerator();
    const committed = readFileSync(new URL('../../docs/surface-coverage.md', import.meta.url), 'utf8');
    expect(stdout.trim(), 'coverage snapshot is stale — run `npm run coverage` in apps/basis and commit').toBe(committed.trim());
  });

  it('composes every catalogue manifest without a silent skip', () => {
    // The generator prints `(skip <name>: …)` to stderr when a manifest fails to
    // import — a silently-dropped manifest hides coverage drift.
    const { stderr } = (() => {
      try {
        const out = execFileSync('node', ['scripts/surface-coverage.mjs'], { cwd: appRoot, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
        return { stdout: out, stderr: '' };
      } catch (e) { return { stdout: '', stderr: e.stderr?.toString?.() ?? e.message }; }
    })();
    const skips = stderr.split('\n').filter((l) => /\(skip /.test(l));
    expect(skips, `manifests dropped from coverage: ${skips.join(' | ')}`).toEqual([]);
  });
});
