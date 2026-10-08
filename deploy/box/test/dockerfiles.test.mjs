// A failed install fails the image build. `a && b && c || true` swallows a failure of ANY step, not only c: a pnpm install
// that hit an error (an ENOENT race, seen 2026-10-09 building the assistant) skipped the relink and still produced an
// image — one that could not start (`@onderling-app/household` not found). Only the prune may fail quietly, so its
// `|| true` sits in parentheses (as the relay's Dockerfile has it).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const DEPLOY = path.resolve(fileURLToPath(new URL('../..', import.meta.url)));
const dockerfiles = readdirSync(DEPLOY, { withFileTypes: true })
  .filter((d) => d.isDirectory() && existsSync(path.join(DEPLOY, d.name, 'Dockerfile')))
  .map((d) => path.join(DEPLOY, d.name, 'Dockerfile'));

/** Each RUN instruction, its continuation lines joined. */
const runs = (src) => src.replace(/\\\n/g, ' ').split('\n').filter((l) => /^\s*RUN\s/.test(l));

test('every Dockerfile under deploy/ is found', () => {
  assert.ok(dockerfiles.length >= 3, dockerfiles.join(', '));
});

test('no RUN lets an earlier step fail behind a trailing `|| true`', () => {
  const bad = [];
  for (const f of dockerfiles) {
    for (const run of runs(readFileSync(f, 'utf8'))) {
      // a top-level `|| true` after an `&&` chain: strip parenthesised groups first, then look for both
      const top = run.replace(/\([^()]*\)/g, '()');
      if (/&&/.test(top) && /\|\|\s*true\b/.test(top)) bad.push(`${path.relative(DEPLOY, f)}: ${run.trim().slice(0, 120)}`);
    }
  }
  assert.deepEqual(bad, [], `a failed step would still build an image:\n${bad.join('\n')}`);
});
