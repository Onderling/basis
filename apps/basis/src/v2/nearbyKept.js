/**
 * basis v2 — a Nearby room conversation, KEPT on this device for a while (Frits 2026-11-09: yes, 7 days, a setting).
 *
 * The room itself keeps nothing once it empties (nearbyRoomBinding.js). What is kept here is this device's own record
 * of what was said with someone in a room: lines written to the DEVICE LOG (sealed at rest, never carried to another
 * device, never sent), under a visit id drawn per room entry, the other person named by THEIR room key. The room key
 * this device spoke is never kept.
 *
 * When that person shares their card (rung 4, 'deel je kaart'), a link entry ties their room key to the address the
 * card named; the contact thread with that address then shows the visit as one "earlier, in the room" block, read
 * from the log (a projection: nothing is copied into the thread).
 *
 * How long: the `room` retention class of the log, its window the person setting `nearby.keepDays` (default 7). Past
 * it the lines and the links drop.
 */
import { param, PARAM_SCOPE, PARAM_KIND } from '@onderling/item-store';

export const LINE_KIND = 'nearby-line';
export const CARD_KIND = 'nearby-card';
export const KEEP_DAYS_KEY = 'nearby.keepDays';
/** How long a room conversation stays on this device, in days: a person setting (0 = nothing is kept). */
export const KEEP_DAYS = param({ key: KEEP_DAYS_KEY, scope: PARAM_SCOPE.DEVICE, kind: PARAM_KIND.USER, default: 7 });
const DAY_MS = 24 * 60 * 60 * 1000;
const MAX_TEXT = 500;

/** The `room` retention window (ms) for a keep-days value; a bad value keeps the default. */
export function roomRetentionMs(days) {
  const n = Number(days);
  return Number.isFinite(n) && n >= 0 && n <= 365 ? Math.round(n * DAY_MS) : KEEP_DAYS * DAY_MS;
}

const rid = () => {
  const b = new Uint8Array(12);
  globalThis.crypto.getRandomValues(b);
  return Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('');
};

/**
 * Keep one line of a room conversation.
 * @param {object} a
 * @param {{append: Function}} a.eventLog   the device log
 * @param {string} a.visitId                this room entry's visit id
 * @param {string|null} a.peer              THEIR room key (null: I said it to the room)
 * @param {'me'|'them'} a.who
 * @param {string} a.text
 * @param {number} [a.at]
 * @param {number} [a.keepDays]             the person setting; 0 keeps nothing
 */
export function keepRoomLine({ eventLog, visitId, peer = null, who, text, at = Date.now(), keepDays = KEEP_DAYS }) {
  if (!eventLog?.append || typeof visitId !== 'string' || !visitId) return null;
  if (!(Number(keepDays) > 0)) return null;
  const body = typeof text === 'string' ? text.trim().slice(0, MAX_TEXT) : '';
  if (!body || (who !== 'me' && who !== 'them')) return null;
  return eventLog.append({
    id: `${LINE_KIND}:${rid()}`, type: LINE_KIND, ts: at,
    payload: { visitId, peer: typeof peer === 'string' && peer ? peer : null, who, text: body },
  });
}

/** Tie THEIR room key to the address their card named (rung 4): the contact thread reads the visit through it. */
export function keepCardLink({ eventLog, peer, address, at = Date.now(), keepDays = KEEP_DAYS }) {
  if (!eventLog?.append || typeof peer !== 'string' || !peer || typeof address !== 'string' || !address) return null;
  if (!(Number(keepDays) > 0)) return null;
  return eventLog.append({ id: `${CARD_KIND}:${peer}:${address}`, type: CARD_KIND, ts: at, payload: { peer, address } });
}

/**
 * "Earlier, in the room" for the contact at `address`: the visits in which their room key spoke, each visit's lines
 * from them and from me (what I said to them, and what I said to the room in that visit), oldest first.
 * @param {Array<object>} events  the device log's entries
 * @param {string} address
 * @returns {Array<{visitId: string, lines: Array<{who: 'me'|'them', text: string, at: number}>}>}
 */
export function earlierInTheRoom(events, address) {
  if (typeof address !== 'string' || !address) return [];
  const list = Array.isArray(events) ? events : [];
  const peers = new Set(list.filter((e) => e?.type === CARD_KIND && e.payload?.address === address).map((e) => e.payload.peer));
  if (!peers.size) return [];
  const lines = list.filter((e) => e?.type === LINE_KIND && e.payload);
  const visits = new Set(lines.filter((e) => peers.has(e.payload.peer)).map((e) => e.payload.visitId));
  const out = [];
  for (const visitId of visits) {
    const these = lines
      .filter((e) => e.payload.visitId === visitId
        && (peers.has(e.payload.peer) || (e.payload.who === 'me' && e.payload.peer === null)))
      // by time, then by the log's own order (two lines in one millisecond keep the order they were kept in)
      .sort((a, b) => ((a.ts ?? 0) - (b.ts ?? 0)) || ((a.seq ?? 0) - (b.seq ?? 0)))
      .map((e) => ({ who: e.payload.who, text: e.payload.text, at: e.ts ?? 0 }));
    if (these.length) out.push({ visitId, lines: these });
  }
  return out.sort((a, b) => (a.lines[0]?.at ?? 0) - (b.lines[0]?.at ?? 0));
}

/**
 * The binding's `keep` port over one device log: each line goes under the CURRENT visit (none outside a room: nothing
 * is kept), with the person's current setting.
 * @param {object} a
 * @param {{append: Function}} a.eventLog
 * @param {() => string|null} a.visitId     the room key controller's current visit (null = not in a room)
 * @param {() => number} [a.keepDays]
 */
export function makeRoomKeeper({ eventLog, visitId, keepDays = () => KEEP_DAYS }) {
  if (!eventLog?.append || typeof visitId !== 'function') return null;
  const days = () => { try { const d = keepDays(); return Number.isFinite(Number(d)) ? Number(d) : KEEP_DAYS; } catch { return KEEP_DAYS; } };
  return {
    line({ peer = null, who, text }) {
      const v = visitId();
      return v ? keepRoomLine({ eventLog, visitId: v, peer, who, text, keepDays: days() }) : null;
    },
    card({ peer, address }) { return keepCardLink({ eventLog, peer, address, keepDays: days() }); },
  };
}

/**
 * The 'earlier, in the room' block as thread lines, the same on every shell: one header line per kept visit, then its
 * lines (mine as `user`, theirs as `bot`, the thread's two origins).
 * @param {Array<{visitId: string, lines: Array<{who: string, text: string}>}>} visits  `earlierInTheRoom(...)`
 * @param {(key: string) => string} t
 */
export function earlierRoomMessages(visits, t) {
  const out = [];
  for (const v of Array.isArray(visits) ? visits : []) {
    out.push({ origin: 'bot', text: t('circle.nearbyScreen.earlier_in_room'), earlier: true });
    for (const l of v.lines ?? []) out.push({ origin: l.who === 'me' ? 'user' : 'bot', text: l.text, earlier: true });
  }
  return out;
}
