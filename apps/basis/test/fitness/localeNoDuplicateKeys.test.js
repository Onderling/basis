/**
 * FITNESS FUNCTION — no duplicate keys within a locale bundle.
 *
 * `JSON.parse` SILENTLY drops duplicate keys (last-wins): `{"a":1,"a":2}`
 * parses to `{"a":2}` with no error.  So a merge conflict or a careless paste
 * that defines the same locale key twice is invisible to every parser-based
 * check (including the en≡nl parity scan in localeSingleSource.test.js, which
 * reads via JSON.parse).  This guard does a RAW-TEXT scan instead, so a
 * duplicated key FAILS CI — the only way to catch this class of drift.
 *
 * @vitest-environment node
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const here = (p) => fileURLToPath(new URL(p, import.meta.url));

/**
 * Raw-text scan for duplicate keys within the SAME object scope. Walks the
 * JSON char-by-char tracking a stack of object frames (one Set of keys each);
 * a string is a "key" iff the next non-whitespace char after it is ':'. Strings
 * (and any '{'/'}' inside them) are skipped wholesale, and '\\' escapes are
 * honoured, so quotes/braces/colons inside values can't fool it. Duplicate keys
 * in DIFFERENT objects are fine (that's normal nesting); only same-object
 * repeats are reported. Returns ['"key" (line N)', ...].
 */
function duplicateKeys(text) {
  const dups = [];
  const stack = []; // one Set<string> per enclosing '{'
  const lineOf = (idx) => text.slice(0, idx).split('\n').length;
  let i = 0;
  while (i < text.length) {
    const c = text[i];
    if (c === '"') {
      let j = i + 1;
      while (j < text.length && text[j] !== '"') { j += text[j] === '\\' ? 2 : 1; }
      const key = text.slice(i + 1, j);
      let k = j + 1;
      while (k < text.length && ' \t\n\r'.includes(text[k])) k++;
      if (text[k] === ':' && stack.length) {
        const frame = stack[stack.length - 1];
        if (frame.has(key)) dups.push(`"${key}" (line ${lineOf(i)})`);
        else frame.add(key);
      }
      i = j + 1;
      continue;
    }
    if (c === '{') { stack.push(new Set()); i++; continue; }
    if (c === '}') { stack.pop(); i++; continue; }
    i++;
  }
  return dups;
}

describe('FITNESS: locale duplicate-key scanner is itself correct', () => {
  it('flags a same-object duplicate that JSON.parse would silently swallow', () => {
    const bad = '{\n  "circle": {\n    "a": { "text": "x" },\n    "a": { "text": "y" }\n  }\n}';
    expect(JSON.parse(bad).circle.a.text).toBe('y');     // proof: parse hides it
    expect(duplicateKeys(bad)).toEqual(['"a" (line 4)']); // the scan does not
  });
  it('does NOT flag the same key name in different objects (normal nesting)', () => {
    const ok = '{ "en": { "title": "Hi" }, "nl": { "title": "Hoi" } }';
    expect(duplicateKeys(ok)).toEqual([]);
  });
  it('is not fooled by braces/colons inside string values', () => {
    const ok = '{ "a": "x: {y} :z", "b": "{\\"a\\": 1}" }';
    expect(duplicateKeys(ok)).toEqual([]);
  });
});

describe('FITNESS: no duplicate keys in any locale bundle', () => {
  const bundles = [
    '../../src/locales/circle.en.json',
    '../../src/locales/circle.nl.json',
    '../../src/locales/consequence.en.json',
    '../../src/locales/consequence.nl.json',
    '../../src/locales/role.en.json',
    '../../src/locales/role.nl.json',
    '../../../basis-mobile/locales/en.json',
    '../../../basis-mobile/locales/nl.json',
    // The WEB app bundle was the one file this scan did not cover — every other bundle in the tree
    // was listed. It is also the bundle carrying most of the shared strings (measured 2026-08-31:
    // 126 of its 194 leaves are reached by code both shells render), so it is the one where a
    // duplicated key would do the most damage before anyone noticed.
    '../../../basis/locales/en.json',
    '../../../basis/locales/nl.json',
  ];
  for (const rel of bundles) {
    it(`${rel} — raw-text scan finds no duplicate keys (JSON.parse would hide them)`, () => {
      const text = readFileSync(here(rel), 'utf8');
      const dups = duplicateKeys(text);
      expect(dups, `duplicate locale keys in ${rel}: ${dups.join(', ')}`).toEqual([]);
    });
  }
});
