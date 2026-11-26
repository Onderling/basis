import { describe, it, expect } from 'vitest';
import { lineAt, linesMatching, lineOf, whereIn, whereInSelf } from './guard-where.mjs';

describe('guard-where', () => {
  it('turns an index, a pattern or a needle into 1-based lines', () => {
    const t = 'a\nbb x\nc x x\n';
    expect(lineAt(t, 0)).toBe(1);
    expect(lineAt(t, t.indexOf('c'))).toBe(3);
    expect(linesMatching(t, /x/g)).toEqual([2, 3]);
    expect(lineOf(t, 'c x')).toBe(3);
    expect(lineOf(t, 'none')).toBe(1);
  });
  it('names a repo file or the guard itself as file:line', () => {
    expect(whereIn('scripts/guard-where.mjs', 'export function lineAt')).toMatch(/^scripts\/guard-where\.mjs:\d+$/);
    expect(whereIn('no/such/file.js', 'x')).toBe('no/such/file.js:1');
    expect(whereInSelf(import.meta.url, "describe('guard-where'")).toBe('scripts/guard-where.test.mjs:4');
  });
});

import { lineOfKey } from './guard-where.mjs';

describe('guard-where — lineOfKey: the line of a key in a locale JSON file', () => {
  const nested = [
    '{',                                   // 1
    '  "a": {',                            // 2
    '    "name": { "text": "A" }',         // 3
    '  },',                                // 4
    '  "b": {',                            // 5
    '    "x": "a \\"name\\": in a value",', // 6
    '    "name": {',                       // 7
    '      "text": "B"',                   // 8
    '    }',                               // 9
    '  }',                                 // 10
    '}',                                   // 11
  ].join('\n');
  it('follows a dotted path and is not fooled by the same leaf under another parent or inside a value', () => {
    expect(lineOfKey(nested, 'a.name')).toBe(3);
    expect(lineOfKey(nested, 'b.name')).toBe(7);
    expect(lineOfKey(nested, 'b.name.text')).toBe(8);
    expect(lineOfKey(nested, 'b')).toBe(5);
  });
  it('finds a flat key that holds dots itself, also with nesting below it', () => {
    const flat = '{\n  "assistant.hello": {\n    "doc": "d"\n  },\n  "assistant.bye": { "doc": "e",\n    "text": "t" }\n}\n';
    expect(lineOfKey(flat, 'assistant.hello')).toBe(2);
    expect(lineOfKey(flat, 'assistant.bye.text')).toBe(6);
  });
  it('is line 1 when the key is not there, or the text is not JSON', () => {
    expect(lineOfKey(nested, 'a.nope')).toBe(1);
    expect(lineOfKey(nested, 'c')).toBe(1);
    expect(lineOfKey('not json {', 'a')).toBe(1);
  });
});
