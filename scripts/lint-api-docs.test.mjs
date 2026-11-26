import { describe, it, expect } from 'vitest';
import { gapLines, firstDiffLine, driftMessage } from './lint-api-docs.mjs';

describe('lint-api-docs', () => {
  it('an undocumented export is named at its declaration as file:line, with what to do instead', () => {
    const model = { name: 'core', symbols: new Map([['foo', { file: '/repo/packages/core/src/a.js', declOffset: 6 }]]) };
    const msg = gapLines(model, ['foo'], () => 'x = 1\nexport function foo() {}\n', '/repo').join('\n');
    expect(msg).toMatch(/packages\/core\/src\/a\.js:2: foo/);
    expect(msg).toMatch(/Fix: /);
  });
  it('a drifted appendix file names its first differing line and the regeneration', () => {
    expect(firstDiffLine('a\nb\nc', 'a\nB\nc')).toBe(2);
    expect(firstDiffLine('a\nb', 'a\nb\nc')).toBe(3);
    const msg = driftMessage('core.md', 'a\nb', 'a\nB');
    expect(msg).toMatch(/docs\/api\/core\.md:2/);
    expect(msg).toMatch(/Fix: .*node scripts\/api-appendix\.mjs/);
  });
});
