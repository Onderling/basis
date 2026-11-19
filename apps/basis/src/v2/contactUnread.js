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
import { sealedKeyValue, shellContentSeal } from './localStoreSeal.js';

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
    // `seenAt: null` is "the marks are not known yet": no unread is counted, never everything (ledger L1085)
    if (seenAt === null) continue;
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
 * AsyncStorage). A mark only ever moves forward; a value that is not JSON reads as empty. A read that FAILED (the
 * storage threw) is not "nothing seen": `read` gives `null` (not known — no counts) and `mark` writes nothing, so a
 * one-contact map never lands over the person's marks.
 */
export function makeContactSeenStore(io) {
  async function readOrThrow() {
    const raw = await io.getItem(CONTACT_SEEN_KEY);   // a storage error comes through
    let v = {};
    try { v = raw ? JSON.parse(raw) : {}; } catch { v = {}; }
    return v && typeof v === 'object' && !Array.isArray(v) ? v : {};
  }
  async function read() {
    try { return await readOrThrow(); } catch { return null; }
  }
  async function mark(contactId, ts = Date.now()) {
    if (typeof contactId !== 'string' || !contactId) return;
    let map;
    try { map = await readOrThrow(); } catch { return; }   // not read: write nothing over the marks
    if (typeof map[contactId] === 'number' && map[contactId] >= ts) return;
    map[contactId] = ts;
    try { await io.setItem(CONTACT_SEEN_KEY, JSON.stringify(map)); } catch { /* quota / disabled: the badge stays, nothing breaks */ }
  }
  return { read, mark };
}

/**
 * The contact seen-marks, SEALED at rest (ledger L1083), over localStorage (web) or AsyncStorage (phone). A read
 * before the content key gives `null` — "not known yet", which `buildContactUnread` answers with no unread count, never
 * "nothing seen" (every contact unread). A `mark` before the key WAITS for it, so the person's look still counts and
 * it never writes a fresh map over their marks.
 */
export function sealedContactSeenStore(storage) {
  const store = makeContactSeenStore(sealedKeyValue(storage, { name: 'contact seen-marks', strict: true, waitForKey: true }));
  return { read: async () => (shellContentSeal() ? store.read() : null), mark: store.mark };
}
