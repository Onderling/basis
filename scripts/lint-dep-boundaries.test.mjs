// Tests for the dependency-boundary fitness function (scripts/lint-dep-boundaries.mjs).
//   npm run test:deps   (root)  →  vitest run scripts/lint-dep-boundaries.test.mjs
//
// Covers: synthetic-violation detection, the two "must-NOT-flag" cases (within-package
// relative + @onderling/* bare), the real repo ⊆ baseline invariant, and the CEILING semantics
// (strict subset PASSES; a not-in-baseline violation FAILS).

import { describe, it, expect } from 'vitest';
import {
  classifyImport,
  parseSpecifiers,
  scanViolations,
  loadBaseline,
  diffAgainstBaseline,
  REPO_ROOT,
} from './lint-dep-boundaries.mjs';

const ROOT = '/repo';

describe('classifyImport — cross-package raw-src reach-ins', () => {
  it('FLAGS a relative import into another package\'s src/', () => {
    const v = classifyImport(
      '/repo/apps/foo/src/thing.js',
      '../../../packages/bar/src/baz.js',
      ROOT,
    );
    expect(v).not.toBeNull();
    expect(v.reachesInto).toBe('@onderling/bar');
    expect(v.file).toBe('apps/foo/src/thing.js');
    expect(v.category).toBe('runtime');
  });

  it('FLAGS a package reaching into a DIFFERENT package\'s src/', () => {
    const v = classifyImport(
      '/repo/packages/alpha/src/a.js',
      '../../beta/src/b.js',
      ROOT,
    );
    expect(v?.reachesInto).toBe('@onderling/beta');
  });

  it('does NOT flag a within-package relative import (own src/)', () => {
    expect(classifyImport('/repo/packages/alpha/src/a.js', './b.js', ROOT)).toBeNull();
    expect(classifyImport('/repo/packages/alpha/test/a.test.js', '../src/b.js', ROOT)).toBeNull();
    // climbing within the same package but not into src/ is also fine
    expect(classifyImport('/repo/packages/alpha/src/a.js', '../manifest.js', ROOT)).toBeNull();
  });

  it('does NOT flag a bare @onderling/* import (the public boundary)', () => {
    expect(classifyImport('/repo/apps/foo/src/thing.js', '@onderling/bar', ROOT)).toBeNull();
    expect(classifyImport('/repo/apps/foo/src/thing.js', '@onderling/bar/baz', ROOT)).toBeNull();
    expect(classifyImport('/repo/apps/foo/src/thing.js', 'node:fs', ROOT)).toBeNull();
  });

  it('does NOT flag a reach into another package OUTSIDE its src/ (e.g. manifest.js)', () => {
    expect(
      classifyImport('/repo/apps/foo/src/x.js', '../../../packages/bar/manifest.js', ROOT),
    ).toBeNull();
  });

  it('categorizes test / script importers distinctly', () => {
    const t = classifyImport('/repo/apps/foo/test/x.test.js', '../../../packages/bar/src/b.js', ROOT);
    const s = classifyImport('/repo/apps/foo/scripts/x.mjs', '../../../packages/bar/src/b.js', ROOT);
    expect(t.category).toBe('test');
    expect(s.category).toBe('script');
  });
});

describe('parseSpecifiers', () => {
  it('extracts import / export-from / require, ignoring comments', () => {
    const src = `
      import a from '../../packages/bar/src/a.js';
      export { b } from './b.js';
      const c = require('../../packages/baz/src/c.js');
      // import x from '../../packages/nope/src/x.js';
      /* require('../../packages/also-nope/src/y.js') */
      const url = 'http://example.com'; // not a specifier
    `;
    const specs = parseSpecifiers(src);
    expect(specs).toContain('../../packages/bar/src/a.js');
    expect(specs).toContain('./b.js');
    expect(specs).toContain('../../packages/baz/src/c.js');
    expect(specs).not.toContain('../../packages/nope/src/x.js');
    expect(specs).not.toContain('../../packages/also-nope/src/y.js');
  });
});

describe('CEILING semantics (diffAgainstBaseline)', () => {
  const baseline = {
    violations: [
      { file: 'apps/foo/src/a.js', specifier: '../../../packages/bar/src/x.js' },
      { file: 'apps/foo/src/b.js', specifier: '../../../packages/bar/src/y.js' },
    ],
  };

  it('PASSES on an exact match (no new)', () => {
    const cur = baseline.violations.map((v) => ({ ...v }));
    expect(diffAgainstBaseline(cur, baseline).newViolations).toHaveLength(0);
  });

  it('PASSES on a strict SUBSET (a violation was removed)', () => {
    const cur = [{ file: 'apps/foo/src/a.js', specifier: '../../../packages/bar/src/x.js' }];
    const diff = diffAgainstBaseline(cur, baseline);
    expect(diff.newViolations).toHaveLength(0);
    expect(diff.removed).toHaveLength(1);
  });

  it('FAILS on a violation NOT in the baseline (a new reach-in)', () => {
    const cur = [
      ...baseline.violations,
      { file: 'apps/foo/src/c.js', specifier: '../../../packages/bar/src/z.js' },
    ];
    const diff = diffAgainstBaseline(cur, baseline);
    expect(diff.newViolations).toHaveLength(1);
    expect(diff.newViolations[0].file).toBe('apps/foo/src/c.js');
  });
});

describe('real repo is within its baseline (check passes today)', () => {
  it('every current violation is in the tracked baseline', () => {
    const current = scanViolations(REPO_ROOT);
    const baseline = loadBaseline();
    const diff = diffAgainstBaseline(current, baseline);
    expect(diff.newViolations, `new (un-baselined) violations:\n` +
      diff.newViolations.map((v) => `  ${v.file} -> ${v.specifier}`).join('\n')).toHaveLength(0);
  });

  it('baseline total matches the scan and its category tallies', () => {
    const baseline = loadBaseline();
    const current = scanViolations(REPO_ROOT);
    expect(current.length).toBe(baseline.total);
    // Seed every category, exactly as `buildBaselineFile` does. Counting from `{}` makes an EMPTY
    // category vanish instead of reading zero, so a baseline written when one category happened to be
    // empty could never match a scan again — the tallies disagreed about representation, not about the
    // tree. Zero is a count; absent is not.
    const counts = current.reduce(
      (a, v) => ((a[v.category] = (a[v.category] ?? 0) + 1), a),
      { runtime: 0, script: 0, test: 0 },
    );
    expect(counts).toEqual(baseline.byCategory);
  });
});
