import { describe, it, expect } from 'vitest';
import { scanSource } from './lint-jsx-raw-text.mjs';

describe('lint-jsx-raw-text', () => {
  it('flags text after <> on the same line (the circle-screen crash)', () => {
    expect(scanSource("{ok ? (<>   {/* the composer */}\n<View />\n</>) : null}")).toHaveLength(1);
    expect(scanSource('<> <View />')).toHaveLength(1);
  });

  it('flags whitespace then a JSX comment after an opening tag', () => {
    expect(scanSource('<View style={s.row}>  {/* a note */}')).toHaveLength(1);
  });

  it('passes the shapes that are fine', () => {
    expect(scanSource([
      '{ok ? (<>',
      '  {/* the composer, on its own line */}',
      '  <View />',
      '</>) : null}',
      'const noop = () => {/* nothing */};',
      'items.map((x) => {/* nothing */});',
      '<View>{/* touching the tag */}</View>',
      '// a comment that quotes (<>   {/* x */}',
    ].join('\n'))).toEqual([]);
  });
});
