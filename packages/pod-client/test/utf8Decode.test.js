/**
 * The JavaScript UTF-8 path (the phone's, ledger L619) decodes exactly as the native TextDecoder does: ASCII, Dutch
 * accents, emoji above U+FFFF, long runs across chunk edges, and malformed bytes as U+FFFD.
 */
import { describe, it, expect } from 'vitest';
import { jsUtf8Decode } from '../src/sealing/utf8.js';

const native = new TextDecoder();
const enc = new TextEncoder();
const same = (bytes) => expect(jsUtf8Decode(bytes)).toBe(native.decode(bytes));

describe('the JavaScript UTF-8 decode agrees with TextDecoder', () => {
  it('text people write', () => {
    for (const s of ['', 'melk', 'één brood, crème brûlée', '🥬🍅🥑🥒 boodschappen', '{"a":"ü","b":[1,2,"日本語"]}', 'x'.repeat(20000) + 'é' + 'y'.repeat(9000) + '🥬']) same(enc.encode(s));
  });
  it('malformed bytes become U+FFFD the same way', () => {
    for (const b of [[0xff], [0xc3], [0xe2, 0x82], [0xed, 0xa0, 0x80], [0xf0, 0x9f, 0xa5], [0x61, 0x80, 0x62], [0xc0, 0xaf], [0xf5, 0x80, 0x80, 0x80]]) same(new Uint8Array(b));
  });
  it('a leading byte-order mark is dropped, as TextDecoder\'s default does; a later one is kept', () => {
    same(new Uint8Array([0xef, 0xbb, 0xbf, 0x6d, 0x65, 0x6c, 0x6b]));
    same(new Uint8Array([0xef, 0xbb, 0xbf]));
    same(new Uint8Array([0x61, 0xef, 0xbb, 0xbf, 0x62]));
    same(new Uint8Array([0xef, 0xbb, 0xbf, 0xef, 0xbb, 0xbf, 0x61]));
  });
  it('random bytes', () => {
    let seed = 7;
    for (let k = 0; k < 200; k += 1) {
      const u = new Uint8Array(64);
      for (let i = 0; i < u.length; i += 1) { seed = (seed * 1103515245 + 12345) >>> 0; u[i] = seed >>> 24; }
      same(u);
      same(new Uint8Array([0xef, 0xbb, 0xbf, ...u]));
    }
  });
});
