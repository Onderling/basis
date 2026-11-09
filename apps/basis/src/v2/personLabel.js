/**
 * personLabel — what a person is CALLED on screen, in one place. Never a key.
 *
 * In order: the name they gave themselves (their card's display name), else the handle they use in a circle you
 * share, else "someone" (`circle.reply.who_someone`). A key, or the first characters of one, is never a name: a
 * two-phone walk (2026-11-05) found keys on the contact list, in chat titles, in the composer, in "Share with…",
 * in "… is now an admin" and in the circle list's preview, each from its own `name ?? handle ?? id` fallback.
 *
 * A `webid:`, a `did:` or a URL is NOT a key here: it is an identifier a person chose to be known by, and the
 * reveal ladder has always shown it as such (`revealedMemberLabel`). What is withheld is the OPAQUE key — the
 * transport address, the pubKey, a device id — and every prefix of it.
 *
 * Projections stamp `{ label, labelKey }` on their rows (the `stampSenderLabels` shape: `senderLabel` /
 * `senderLabelKey`), so a shell paints `label ?? t(labelKey)` and holds no naming logic of its own.
 */

/** The words for a person nobody has named: "someone" / "iemand". */
export const SOMEONE_LABEL_KEY = 'circle.reply.who_someone';

/** A string that is an identifier someone chose (a webid, a did, a URL) rather than an opaque key. */
function isChosenIdentifier(s) {
  return s.includes(':') || s.includes('/');
}

/**
 * Is `text` a key, or a piece of one, rather than a name?
 *
 * @param {string} text
 * @param {Array<string|null|undefined>} [ids]  the ids this person is known under on this row (contact id, address,
 *   webid, pubKey): a name equal to one, or the first ≥ 6 characters of one, is that key
 * @returns {boolean}
 */
export function isKeyLike(text, ids = []) {
  if (typeof text !== 'string') return true;
  const s = text.trim().replace(/^@/, '');
  if (!s) return true;
  if (isChosenIdentifier(s)) return false;
  // the shortened forms earlier code printed: `peer-<6>` (the reveal ladder, Nearby) and `d-<…>` (a device id)
  if (/^peer-[A-Za-z0-9_-]{4,}$/.test(s) || /^d-[A-Za-z0-9]{4,}$/.test(s)) return true;
  for (const id of ids) {
    if (typeof id !== 'string' || !id || isChosenIdentifier(id)) continue;
    if (s === id) return true;
    if (s.length >= 6 && id.startsWith(s.replace(/[.…]+$/, ''))) return true;
  }
  // an opaque key on its own: one long run of key characters, no space (a name a person types has neither length
  // nor this alphabet alone — 32+ base64url/hex characters is a key)
  return /^[A-Za-z0-9_-]{32,}$/.test(s);
}

/**
 * The label for one person.
 *
 * @param {object} p
 * @param {string|null} [p.displayName]  the name on their card (what they called themselves)
 * @param {string|null} [p.handle]       the name they use in a circle you share (painted as written)
 * @param {Array<string|null|undefined>} [p.ids]  their ids on this row — never shown, only refused as a label
 * @returns {{ label: string|null, labelKey: string|null }}  exactly one of the two is set
 */
export function personLabel({ displayName = null, handle = null, ids = [] } = {}) {
  if (typeof displayName === 'string' && displayName.trim() && !isKeyLike(displayName, ids)) return { label: displayName.trim(), labelKey: null };
  if (typeof handle === 'string' && handle.trim() && !isKeyLike(handle, ids)) {
    // the name as the person wrote it: no '@' (it was the old display prefix of a handle, and the name is for people)
    return { label: handle.trim().replace(/^@\s*/, ''), labelKey: null };
  }
  return { label: null, labelKey: SOMEONE_LABEL_KEY };
}

/**
 * The TEXT to paint for a person, for a shell holding a row that may or may not be stamped: a stamped `label`
 * wins; otherwise the row's own name or handle, refused when it is one of its ids; else "someone".
 *
 * @param {object|null} row  a contact row, a thread, a roster row — `{label?, name?, displayName?, handle?}`
 * @param {(key: string, args?: object) => string} t
 * @param {{ ids?: Array<string|null|undefined> }} [opts]  ids this person is known under, besides the row's own
 * @returns {string}
 */
export function nameShown(row, t, { ids = [] } = {}) {
  if (typeof row?.label === 'string' && row.label) return row.label;
  const rowIds = [row?.contactId, row?.peerAddr, row?.webid, row?.personKey, row?.pubKey, row?.id];
  const l = personLabel({ displayName: row?.name ?? row?.displayName ?? null, handle: row?.handle ?? null, ids: [...ids, ...rowIds] });
  return l.label ?? t(l.labelKey);
}

/**
 * `nameShown` for a RAW roster row (`listGroupMembers`: `{webid, displayName, handle}`) — the admin page's shape.
 *
 * @param {{webid?: string, displayName?: string, handle?: string}|null} m
 * @param {(key: string, args?: object) => string} t
 * @returns {string}
 */
export function memberShown(m, t) {
  return nameShown({ name: m?.displayName || null, handle: m?.handle || null }, t, { ids: [m?.webid] });
}
