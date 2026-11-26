import { describe, it, expect } from 'vitest';
import { scanSource, redMessage } from './lint-mobile-buttons.mjs';

describe('lint-mobile-buttons', () => {
  it('counts a Pressable styled as a button, not a row or the family', () => {
    const src = [
      '<Pressable style={styles.btn} onPress={() => go()}><Text>x</Text></Pressable>',
      '<Pressable style={[styles.primaryButton, busy && styles.disabled]} onPress={save}>',
      '<Pressable style={styles.row} onPress={() => open()}>',
      '<Btn label="ok" onPress={() => go()} />',
      '<Pressable onPress={() => x()} accessibilityRole="button">',
    ].join('\n');
    expect(scanSource(src).map((h) => h.line)).toEqual([1, 2]);
  });
  it('reads props past an arrow function to the tag end', () => {
    expect(scanSource('<Pressable onPress={() => { a > b; }} style={styles.chip}>')).toHaveLength(1);
  });
  it('the red message names each hand-styled button in a grown file as file:line and says what to use instead', () => {
    const msg = redMessage([{ file: 'apps/basis-mobile/src/a.js', now: 2, was: 1, lines: [4, 9] }]);
    expect(msg).toMatch(/^\s*apps\/basis-mobile\/src\/a\.js:4$/m);
    expect(msg).toMatch(/^\s*apps\/basis-mobile\/src\/a\.js:9$/m);
    expect(msg).toMatch(/Fix: .*<Btn/);
  });
});
