/**
 * Does an add-a-device offer carry any word of the recovery phrase? The custody journey's leak check, honest both ways.
 *
 * The offer is `<scheme>://<base64 payload>[?…|#…]`. Two places can leak and each is read as WORDS:
 *   - the DECODED payload: a word inside it was never a literal substring of the base64 (a raw scan could not catch it);
 *   - whatever travels in the clear after the payload (a query parameter, a fragment, a debug hint).
 * The scheme (`onderling-enroll`) is fixed text this code writes, and the raw base64 is NOT read as text: a random run
 * that spells a phrase word ('bLaSt', case-folded) is chance, not a leak. A substring check failed on exactly that.
 * Whole words only: tokens split on anything that is not a letter, compared case-blind.
 *
 * @param {string} uri
 * @param {string[]} words  the phrase's words
 * @param {{ minLength?: number }} [o]  shorter words are skipped (too common to mean anything)
 * @returns {string[]}  the phrase words found, in phrase order
 */
export function phraseWordsInOffer(uri, words, { minLength = 5 } = {}) {
  const s = String(uri ?? '');
  const afterScheme = s.includes('://') ? s.slice(s.indexOf('://') + 3) : s;
  const cut = afterScheme.search(/[?#]/);
  const payload = cut >= 0 ? afterScheme.slice(0, cut) : afterScheme;
  const clear = cut >= 0 ? afterScheme.slice(cut) : '';
  let decoded = '';
  try { decoded = Buffer.from(payload, 'base64').toString('utf8'); } catch { decoded = ''; }
  const tokens = new Set(`${decoded}\n${clear}`.toLowerCase().split(/[^\p{L}]+/u).filter(Boolean));
  return (words ?? []).filter((w) => typeof w === 'string' && w.length >= minLength && tokens.has(w.toLowerCase()));
}
