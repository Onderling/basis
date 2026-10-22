/**
 * JSON someone else wrote is parsed with `parseUntrustedJson`: a key that reaches a prototype (`__proto__`,
 * `constructor`, `prototype`), at any depth, refuses the whole input — so no decoder downstream can merge one in.
 * (2026-10-22: a hand-made contact card's extra fields set the decoded card's prototype; `card.bot` read true.)
 */
import { describe, it, expect } from 'vitest';
import { parseUntrustedJson, UNSAFE_JSON_KEYS } from '../src/index.js';

describe('parseUntrustedJson', () => {
  it('parses ordinary JSON exactly like JSON.parse', () => {
    for (const t of ['{"a":1,"b":[1,{"c":"x"}]}', '[1,2]', '"s"', '3', 'null', 'true']) expect(parseUntrustedJson(t)).toEqual(JSON.parse(t));
  });
  it('refuses a prototype key at any depth, and says which', () => {
    for (const k of UNSAFE_JSON_KEYS) {
      expect(() => parseUntrustedJson(`{"${k}":{"bot":true}}`)).toThrow(/unsafe key/);
      expect(() => parseUntrustedJson(`{"a":[{"b":{"${k}":1}}]}`)).toThrow(k);
    }
  });
  it('a string VALUE that says "__proto__" is fine — only keys are refused', () => {
    expect(parseUntrustedJson('{"name":"__proto__"}')).toEqual({ name: '__proto__' });
  });
  it('malformed JSON throws as JSON.parse does (an Error, so a decoder\'s catch refuses it)', () => {
    expect(() => parseUntrustedJson('{')).toThrow(SyntaxError);
  });
});
