import { describe, it, expect } from 'vitest';
import { pillProblems, hiddenProblems } from './lint-alpha-surface.mjs';

describe('lint-alpha-surface', () => {
  it('a literal pill list is named as file:line with what to use instead', () => {
    const [p, ...rest] = pillProblems('apps/x.js', "const a = 1;\nconst modes = ['chat', 'screen'];\n");
    expect(rest).toEqual([]);
    expect(p).toMatch(/apps\/x\.js:2: /);
    expect(p).toMatch(/Fix: .*alphaViewModes\(\)/);
    expect(pillProblems('apps/x.js', 'alphaViewModes()')).toEqual([]);
  });
  it('a hidden tab or action a projection still hands out names the projection and the fix', () => {
    const [p] = hiddenProblems({ kind: 'tab', shell: 'web', ids: ['a', 'h'], hidden: ['h'], projection: 'apps/basis/src/v2/tabProjection.js' });
    expect(p).toMatch(/tabProjection\.js/);
    expect(p).toMatch(/Fix: /);
    expect(hiddenProblems({ kind: 'tab', shell: 'web', ids: ['a'], hidden: ['h'], projection: 'p.js' })).toEqual([]);
  });
});
