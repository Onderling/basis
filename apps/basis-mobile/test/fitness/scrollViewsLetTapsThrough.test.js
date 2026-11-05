/**
 * A TAP ON SAVE IS NOT EATEN BY THE KEYBOARD (2026-10-30, the two-phone walk). React Native's ScrollView defaults to
 * keyboardShouldPersistTaps="never": with the keyboard up, the first tap only closes it — so a person who typed a name
 * and tapped Save saved nothing, and lost the name when they closed the sheet. In every screen that holds a text field,
 * every ScrollView lets the tap through to its target ("handled"); where no field is inside, the setting is harmless.
 */
import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = new URL('../../src/', import.meta.url).pathname;
function files(dir) {
  return readdirSync(dir).flatMap((n) => {
    const p = join(dir, n);
    return statSync(p).isDirectory() ? files(p) : (p.endsWith('.js') ? [p] : []);
  });
}
/** Each `<ScrollView …>` opening tag, whole (it may span lines). */
function scrollTags(src) {
  const out = [];
  let i = src.indexOf('<ScrollView');
  while (i >= 0) {
    let depth = 0; let j = i;
    for (; j < src.length; j += 1) {
      const c = src[j];
      if (c === '{') depth += 1;
      else if (c === '}') depth -= 1;
      else if (c === '>' && depth === 0) break;
    }
    out.push(src.slice(i, j + 1));
    i = src.indexOf('<ScrollView', j);
  }
  return out;
}

describe('scroll views let a tap through while the keyboard is up', () => {
  it('in every screen with a text field, every ScrollView sets keyboardShouldPersistTaps', () => {
    const missing = [];
    for (const f of files(ROOT)) {
      const src = readFileSync(f, 'utf8');
      if (!src.includes('<TextInput')) continue;
      for (const tag of scrollTags(src)) {
        if (!/keyboardShouldPersistTaps=/.test(tag)) missing.push(`${f.slice(ROOT.length)}: ${tag.split('\n')[0].slice(0, 80)}`);
      }
    }
    expect(missing, `ScrollViews that eat the first tap while typing:\n${missing.join('\n')}`).toEqual([]);
  });
});
