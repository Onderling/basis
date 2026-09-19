import { describe, it, expect } from 'vitest';
import { findGaps, code, SEAMS, SHELLS, BASELINE } from './shell-seams.mjs';

const files = (map) => (rel) => { if (!(rel in map)) throw new Error(`no ${rel}`); return map[rel]; };
const seams = [
  { id: 'a', pattern: /composeA\(/, why: 'A' },
  { id: 'b', pattern: /composeB\(/, why: 'B' },
];
const shells = [
  { name: 'one', files: ['one.js'] },
  { name: 'two', files: ['two-a.js', 'two-b.js'] },
];

describe('lint-shell-seams — every shell composes every seam', () => {
  it('green when each shell composes every seam, across its file SET', () => {
    const r = findGaps(files({ 'one.js': 'composeA(); composeB();', 'two-a.js': 'composeA();', 'two-b.js': 'composeB();' }), { seams, shells, baseline: [] });
    expect(r.gaps).toEqual([]);
    expect(r.stale).toEqual([]);
  });

  it('a shell that forgot a seam is a gap, named with where the guard looked', () => {
    const r = findGaps(files({ 'one.js': 'composeA();', 'two-a.js': 'composeA(); composeB();', 'two-b.js': '' }), { seams, shells, baseline: [] });
    expect(r.gaps).toEqual([{ shell: 'one', seam: 'b', why: 'B', files: ['one.js'] }]);
  });

  it('a seam mentioned only in a COMMENT does not count — the box explained the pair roster and never composed it', () => {
    const r = findGaps(files({ 'one.js': '// composeB() is wired below\n/* composeB( */\ncomposeA();', 'two-a.js': 'composeA(); composeB();', 'two-b.js': '' }), { seams, shells, baseline: [] });
    expect(r.gaps.map((g) => `${g.shell}:${g.seam}`)).toEqual(['one:b']);
    // Full-line comments and block comments are stripped; a trailing `// …` is not, on purpose — stripping to
    // end-of-line would eat the `//` inside 'wss://…' strings and hide real composition after a URL.
    expect(code('  // composeB(\n/* composeB( */\nx')).not.toMatch(/composeB\(/);
  });

  it('a baselined gap is tolerated and reported; a baseline entry whose seam landed is stale', () => {
    const baseline = [{ shell: 'one', seam: 'b', closes: 'a brief' }];
    const open = findGaps(files({ 'one.js': 'composeA();', 'two-a.js': 'composeA(); composeB();', 'two-b.js': '' }), { seams, shells, baseline });
    expect(open.gaps).toEqual([]);
    expect(open.known).toEqual(baseline);
    const closed = findGaps(files({ 'one.js': 'composeA(); composeB();', 'two-a.js': 'composeA(); composeB();', 'two-b.js': '' }), { seams, shells, baseline });
    expect(closed.stale).toEqual(baseline);
  });

  it('a seam scoped to some shells is not asked of the others — and the scoping is written beside the seam', () => {
    const scoped = [{ id: 'view', pattern: /paint\(/, shells: ['one'], why: 'a view' }];
    const r = findGaps(files({ 'one.js': 'paint();', 'two-a.js': '', 'two-b.js': '' }), { seams: scoped, shells, baseline: [] });
    expect(r.gaps).toEqual([]);
    const missing = findGaps(files({ 'one.js': '', 'two-a.js': '', 'two-b.js': '' }), { seams: scoped, shells, baseline: [] });
    expect(missing.gaps.map((g) => g.shell)).toEqual(['one']);
  });

  it('a missing file is a gap for every seam, never a green by absence', () => {
    const r = findGaps(files({ 'one.js': 'composeA(); composeB();', 'two-a.js': 'composeA();' }), { seams, shells, baseline: [] });
    expect(r.gaps.map((g) => `${g.shell}:${g.seam}`)).toEqual(['two:b']);
  });

  it('the declared shells and seams are non-empty and every baseline entry names a real shell + seam', () => {
    expect(SHELLS.length).toBe(3);
    expect(SEAMS.length).toBeGreaterThan(5);
    for (const b of BASELINE) {
      expect(SHELLS.map((s) => s.name)).toContain(b.shell);
      expect(SEAMS.map((s) => s.id)).toContain(b.seam);
      expect(b.closes).toMatch(/plans\//);
    }
  });
});
