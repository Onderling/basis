/**
 * contactUnread — what is NEW in Contacten (Frits 2026-09-21: "add some 'new message' visual to the contacts frame —
 * right now I have to check each contact all the time").
 *
 * The same shape the circle tiles have (`circleTilePreviews.js`): a seen-mark per thread, bumped when the person
 * opens it; the inbound turns newer than the mark are unread; the row shows the count, the tab the sum. The turns
 * are the channel's durable ones (`rehydrateAll`), so a reload counts the same as before it. The seen-marks are a
 * VIEW fact of this device — not carried to the siblings (a phone you read on does not silence the laptop; that is a
 * later choice) — read through an injected io so web (localStorage) and mobile (AsyncStorage) run one code.
 */

export const CONTACT_SEEN_KEY = 'cc.contactSeenAt';

/**
 * @param {{ turns: Array<{contactId?: string, origin?: string, ts?: number, receivedAt?: number}>, seenAt: Object<string, number> }} a
 * @param {Set<string>} [a.readIds]  every id the person read, on any of their devices
 * @returns {Object<string, {unread: number, lastTs: number, unreadIds: Array<{id: string, at: number}>}>}  per contact that has any inbound turn
 */
export function buildContactUnread({ turns = [], seenAt = {}, readIds = null } = {}) {
  const out = {};
  for (const t of Array.isArray(turns) ? turns : []) {
    const id = t?.contactId;
    if (typeof id !== 'string' || !id || t.origin === 'user') continue;
    // when it ARRIVED here (a message the relay held is new once it lands), else when it was sent
    const ts = typeof t.receivedAt === 'number' ? t.receivedAt : (typeof t.ts === 'number' ? t.ts : 0);
    const entry = out[id] ?? (out[id] = { unread: 0, lastTs: 0, unreadIds: [] });
    if (ts > entry.lastTs) entry.lastTs = ts;
    const seen = typeof seenAt?.[id] === 'number' ? seenAt[id] : -Infinity;
    // …and read on none of my devices (`readMarks.js`: the message id, marked with when it was SENT)
    const mid = typeof t.messageId === 'string' && t.messageId ? t.messageId : null;
    if (ts > seen && !(readIds && mid && readIds.has(mid))) {
      entry.unread += 1;
      if (mid) entry.unreadIds.push({ id: mid, at: typeof t.ts === 'number' ? t.ts : ts });
    }
  }
  return out;
}

/** The tab's number: every contact's unread, summed. */
export function totalUnread(map) {
  let n = 0;
  for (const v of Object.values(map ?? {})) n += Number(v?.unread) || 0;
  return n;
}

/**
 * The seen-marks, on this device. `io` is `{ getItem(key), setItem(key, value) }`, sync or async (localStorage,
 * AsyncStorage). A mark only ever moves forward; a value that is not JSON reads as empty.
 */
export function makeContactSeenStore(io) {
  async function read() {
    try { const raw = await io.getItem(CONTACT_SEEN_KEY); const v = raw ? JSON.parse(raw) : {}; return v && typeof v === 'object' && !Array.isArray(v) ? v : {}; }
    catch { return {}; }
  }
  async function mark(contactId, ts = Date.now()) {
    if (typeof contactId !== 'string' || !contactId) return;
    const map = await read();
    if (typeof map[contactId] === 'number' && map[contactId] >= ts) return;
    map[contactId] = ts;
    try { await io.setItem(CONTACT_SEEN_KEY, JSON.stringify(map)); } catch { /* quota / disabled: the badge stays, nothing breaks */ }
  }
  return { read, mark };
}
