/**
 * UTF-8 bytes to a string, fast where the runtime's TextDecoder is not (ledger L619). On the phone (Hermes)
 * `TextDecoder` is a JavaScript polyfill that builds the string one code point at a time; opening a sealed record
 * at the alpha size spent ~15% of the cold start there. A runtime with a native decoder (web, node) keeps it.
 *
 * The JavaScript path: ASCII runs go to `String.fromCharCode` in chunks; multi-byte sequences are decoded into UTF-16
 * code units (surrogate pairs above U+FFFF); a malformed sequence becomes U+FFFD, as TextDecoder's default does.
 */
const CHUNK = 0x2000;

/**
 * The runtime's own decoder, except on Hermes (the phone), whose TextDecoder is a JavaScript polyfill. Hermes is named
 * by its own global; "is the decoder native?" cannot be asked, since node's TextDecoder is JavaScript over a binding.
 */
function runtimeDecoder() {
  try {
    if (typeof globalThis.HermesInternal !== 'undefined') return null;
    const TD = globalThis.TextDecoder;
    if (typeof TD !== 'function') return null;
    const td = new TD();
    return (bytes) => td.decode(bytes);
  } catch { return null; }
}

/** @param {Uint8Array} bytes @returns {string} */
export function jsUtf8Decode(bytes) {
  const n = bytes.length;
  const parts = [];
  const units = [];
  const flush = () => { if (units.length) { parts.push(String.fromCharCode.apply(null, units)); units.length = 0; } };
  // a leading byte-order mark is dropped, as TextDecoder's default (ignoreBOM: false) does; a later one is kept
  let i = n >= 3 && bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf ? 3 : 0;
  while (i < n) {
    const b = bytes[i];
    if (b < 0x80) {
      // an ASCII run, straight from the bytes
      let j = i + 1;
      while (j < n && bytes[j] < 0x80 && j - i < CHUNK) j += 1;
      flush();
      parts.push(String.fromCharCode.apply(null, bytes.subarray(i, j)));
      i = j;
      continue;
    }
    // a multi-byte sequence, by the WHATWG UTF-8 decoder: a malformed or cut-off sequence is ONE U+FFFD for its
    // maximal valid prefix, and the byte that broke it is read again
    let need = 0; let cp = 0; let lower = 0x80; let upper = 0xbf;
    if (b >= 0xc2 && b <= 0xdf) { need = 1; cp = b & 0x1f; }
    else if (b >= 0xe0 && b <= 0xef) { need = 2; cp = b & 0x0f; if (b === 0xe0) lower = 0xa0; if (b === 0xed) upper = 0x9f; }
    else if (b >= 0xf0 && b <= 0xf4) { need = 3; cp = b & 0x07; if (b === 0xf0) lower = 0x90; if (b === 0xf4) upper = 0x8f; }
    i += 1;
    if (need === 0) { cp = 0xfffd; }
    else {
      let ok = true;
      for (let k = 0; k < need; k += 1) {
        const c = i < n ? bytes[i] : -1;
        if (c < lower || c > upper) { ok = false; break; }
        cp = (cp << 6) | (c & 0x3f); i += 1; lower = 0x80; upper = 0xbf;
      }
      if (!ok) cp = 0xfffd;
    }
    if (cp > 0xffff) { const c = cp - 0x10000; units.push(0xd800 | (c >> 10), 0xdc00 | (c & 0x3ff)); } else units.push(cp);
    if (units.length >= CHUNK) flush();
  }
  flush();
  return parts.length === 1 ? parts[0] : parts.join('');
}

const native = runtimeDecoder();

/** The runtime's decoder, or on Hermes (and without one) the JavaScript path above. */
export const utf8Decode = native ?? jsUtf8Decode;
