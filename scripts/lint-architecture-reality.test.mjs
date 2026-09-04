import { describe, it, expect } from 'vitest';
import { findViolations } from './lint-architecture-reality.mjs';

describe('lint-architecture-reality', () => {
  it('flags plan language, decision history and named actors; ignores code fences', () => {
    const v = findViolations([
      'The rail is the one write path.',
      '*Direction, not yet built:* one ceremony that enrolls.',
      'Cloning was tried and withdrawn.',
      '```', 'not yet built inside a fence', '```',
      'Frits decided this.',
    ].join('\n'));
    expect(v.map((x) => x.line)).toEqual([2, 2, 3, 7]);
  });
  it('passes plain description', () => {
    expect(findViolations('A device is never restored as a copy of another.\nSealed circles rotate their key.')).toEqual([]);
  });
});
