/**
 * The guard's own test: it passes on the tree as it stands, and it CAN go red — a fixture under the basis app that
 * keeps its own interval is refused, a comment that names one is not.
 */
import { describe, it, expect } from 'vitest';
import { execFileSync } from 'node:child_process';
import { writeFileSync, mkdirSync, rmSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const SCRIPT = path.join(path.dirname(fileURLToPath(import.meta.url)), 'lint-host-tick.mjs');
const ROOT = path.dirname(path.dirname(SCRIPT));

function run() {
  try { return { ok: true, out: execFileSync(process.execPath, [SCRIPT], { cwd: ROOT, encoding: 'utf8' }) }; }
  catch (err) { return { ok: false, out: String(err.stderr ?? '') }; }
}

describe('lint-host-tick', () => {
  it('passes on the repo as it stands — one clock per host', () => {
    const r = run();
    expect(r.ok, r.out).toBe(true);
    expect(r.out).toMatch(/one clock per host/);
  });

  it('FAILS when app code keeps its own interval, and names the file and line', () => {
    const dir = path.join(ROOT, 'apps', 'basis', 'src', '.guard-fixture-host-tick');
    mkdirSync(dir, { recursive: true });
    writeFileSync(path.join(dir, 'ownLoop.js'), "// setInterval( in a comment is prose\nexport const loop = () => setInterval(() => {}, 60_000);\n");
    try {
      const r = run();
      expect(r.ok, 'the guard refuses a second clock').toBe(false);
      expect(r.out).toMatch(/\.guard-fixture-host-tick\/ownLoop\.js:2 keeps its own interval/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
