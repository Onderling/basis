/**
 * rowText — what a stream row SAYS, read once.
 *
 * A row's own text may sit under any of a few payload keys, because entries come from several writers.
 * That reading was written three times — `circleView.js`, `circleScreen.js`, and again inside the mobile
 * bubble — and the copies disagreed on one word, which is all it takes:
 *
 *   web:     `if (typeof p[k] === 'string' && p[k]) return p[k];`
 *   mobile:  `payload.text || payload.title || payload.body || String(row.id)`
 *
 * `body` is not always text. On a LANE STATEMENT entry it is the statement's own body — `{v, kind,
 * circleId, subject, payload, author, parentHash, hash}` — so mobile handed React an object and the whole
 * circle screen went down with "Objects are not valid as a React child", while web rendered the same
 * entries without a murmur. It surfaced the day list items began riding the lane, because that is when
 * such an entry first appeared in an ordinary circle, but the fault was older than the cause.
 *
 * So: one reader, and it only ever returns a string.
 */

/** The payload keys a row's text may live under, in the order a reader should prefer them. */
const TEXT_KEYS = Object.freeze(['text', 'title', 'body', 'name', 'message']);

/**
 * @param {object} row  a stream row (`{event: {payload}}`)
 * @returns {string|null} the row's text, or null when it has none of its own
 */
export function pickRowText(row) {
  const p = row?.event?.payload && typeof row.event.payload === 'object' ? row.event.payload : {};
  for (const k of TEXT_KEYS) {
    // The type check is the whole point: a key that holds an object holds something that is not text.
    if (typeof p[k] === 'string' && p[k]) return p[k];
  }
  return null;
}

export default pickRowText;
