/**
 * "Nieuw voor jou": the notification PROJECTION. Nothing is stored: it reads what the device already holds (the log's
 * item landings, conversation lines and membership statements; the direct-message turns), keeps what is from someone
 * else, arrived within the news window and is read on none of the person's devices, and yields one row per thing.
 * Today paints the rows at the top (only when there are any); a later banner reads the same rows.
 *
 * Every row carries the id of its SOURCE (an item, a line, a message, a statement), which is what a read mark keeps,
 * and the time it ARRIVED here (`landedAt`, the order and the window); a row whose arrival is far after its sending
 * says so ("kwam later binnen"). More than three rows of one circle or contact fold into one row with a count.
 */
import { param, PARAM_SCOPE, PARAM_KIND, VIEWER_FACING_SYSTEM_KINDS } from '@onderling/item-store';
import { landedTimeOf } from '../eventLog.js';
import { eventCircleId } from './circleStream.js';
import { isItemLanding } from './itemLanding.js';
import { countsAsUnread, pickText } from './circleTilePreviews.js';
import { itemKindChip, EMBED_TYPE_ICON } from './embedChips.js';
import { membershipNoticeFor } from './membershipNotices.js';
import { NOTIFY_WINDOW_DAYS } from './readMarks.js';

/** A row whose arrival is this long after its sending says it came in later. */
export const LATE_AFTER_MS = param({ key: 'notify.lateAfterMs', scope: PARAM_SCOPE.DEVICE, kind: PARAM_KIND.INTERNAL, default: 15 * 60_000 });
/** More rows than this in one circle or contact fold into one row with a count. */
export const FOLD_AFTER = param({ key: 'notify.foldAfter', scope: PARAM_SCOPE.DEVICE, kind: PARAM_KIND.INTERNAL, default: 3 });
const DAY_MS = 86_400_000;
const MAX_TEXT = 80;

export const FOR_YOU_KEYS = Object.freeze({
  title:   'circle.forYou.title',
  allRead: 'circle.forYou.all_read',
  item:    'circle.forYou.item',
  line:    'circle.forYou.line',
  dm:      'circle.forYou.dm',
  joined:  'circle.forYou.joined',
  removed: 'circle.forYou.removed',
  many:    'circle.forYou.many',
  late:    'circle.forYou.late',
  news:    'circle.forYou.news',
  someone: 'circle.forYou.someone',
});

const clip = (s) => { const x = String(s ?? '').replace(/\s+/g, ' ').trim(); return x.length > MAX_TEXT ? `${x.slice(0, MAX_TEXT - 1).trimEnd()}…` : x; };

/**
 * @param {object} a
 * @param {object[]} [a.events]   the device log
 * @param {object[]} [a.turns]    direct-message turns (`chatTurnsFromItems`: contactId, origin, ts, receivedAt, messageId, text)
 * @param {object[]} [a.circles]  the circles shown ({ id, name })
 * @param {(contactId: string) => string|null} [a.contactName]
 * @param {(circleId: string) => string|null} [a.viewerIdIn]  the self this device is in a circle (who "you" is there)
 * @param {string[]} [a.myRefs]   every address of mine: nothing of mine is a row
 * @param {Set<string>} [a.readIds]  read on any of my devices
 * @param {(key: string, vars?: object) => string} a.t
 * @param {number} [a.now]
 * @param {number} [a.windowDays]
 * @param {(group: {kind: 'circle'|'contact', id: string}) => ({id: string, name?: string|null}|null)} [a.selfOf]
 *        the persona a row is for (its face); the host passes it only when the device holds more than one
 * @returns {Array<{id: string, kind: string, group: {kind: 'circle'|'contact', id: string, name: string|null}, icon: string, text: string, at: number, late: boolean, open: {kind: 'circle'|'thread', id: string}, count?: number, ids: Array<{id: string, at: number}>}>}
 */
export function notificationRows({
  events = [], turns = [], circles = [], contactName = null, viewerIdIn = null, myRefs = [], readIds = null, t,
  now = Date.now(), windowDays = NOTIFY_WINDOW_DAYS, selfOf = null,
} = {}) {
  if (typeof t !== 'function') return [];
  const mine = new Set(myRefs ?? []);
  const shown = new Map((circles ?? []).filter((c) => c?.id).map((c) => [c.id, c.name ?? null]));
  const since = now - (Number.isFinite(windowDays) && windowDays > 0 ? windowDays : NOTIFY_WINDOW_DAYS) * DAY_MS;
  const fresh = (at, id) => at >= since && !(readIds && readIds.has(id));
  const rows = [];
  const selfFor = (group) => (typeof selfOf === 'function' ? (selfOf(group) ?? null) : null);
  const push = (r) => rows.push({ ...r, self: selfFor(r.group), late: r.saidAt > 0 && r.at - r.saidAt > LATE_AFTER_MS, ids: [{ id: r.id, at: r.saidAt || r.at }] });

  for (const e of Array.isArray(events) ? events : []) {
    if (!e || typeof e !== 'object') continue;
    const cid = eventCircleId(e) ?? e.circleId ?? e.payload?.circleId ?? null;
    if (!cid || !shown.has(cid)) continue;
    const at = landedTimeOf(e);
    const group = { kind: 'circle', id: cid, name: shown.get(cid) };
    const open = { kind: 'circle', id: cid };
    // NEWS IS WHAT THE TILE COUNTS: one rule (`countsAsUnread`), so the badge and these rows never disagree; this
    // file only shapes the row
    if (countsAsUnread(e, { myRefs: [...mine] })) {
      const landing = isItemLanding(e);
      const id = landing ? e.payload.itemId : e.id;
      if (!fresh(at, id)) continue;
      const chip = itemKindChip(landing ? e.payload.kind : (e.payload?.kind ?? null));
      if (landing) {
        push({ id, kind: 'item', group, open, icon: chip?.icon ?? EMBED_TYPE_ICON['chat-message'], at, saidAt: e.payload.saidAt ?? 0,
          text: chip ? t(FOR_YOU_KEYS.item, { kind: t(chip.labelKey), circle: group.name ?? '' }) : t(FOR_YOU_KEYS.news, { circle: group.name ?? '' }) });
        continue;
      }
      const text = clip(pickText(e.payload ?? {}) ?? '');
      push({ id, kind: 'line', group, open, icon: chip?.icon ?? EMBED_TYPE_ICON['chat-message'], at, saidAt: typeof e.ts === 'number' ? e.ts : 0,
        text: text ? t(FOR_YOU_KEYS.line, { text, circle: group.name ?? '' }) : t(FOR_YOU_KEYS.news, { circle: group.name ?? '' }) });
      continue;
    }
    // …and the two rows the tile does NOT count, on purpose: statements about me on the system lane (someone I admitted
    // joined; I was removed). The tile's badge is what others SAID; these are what happened to me.
    if (VIEWER_FACING_SYSTEM_KINDS.includes(e.type)) {
      // who "you" is: the self this device is in the circle, or any address of mine (the admitting device signs a
      // join with its per-circle address, which is not the self's id: without the set the founder never heard of a join)
      const body = e.payload?.body;
      const viewerId = typeof viewerIdIn === 'function' ? viewerIdIn(cid) : null;
      const isMe = (ref) => typeof ref === 'string' && (ref === viewerId || mine.has(ref));
      const asViewer = body && isMe(body.author) ? body.author : (body && isMe(body.subject) ? body.subject : viewerId);
      const hit = asViewer ? membershipNoticeFor(body, { viewerId: asViewer }) : null;
      if (!hit || !['joined', 'removed', 'removedWithReason'].includes(hit.notice) || !fresh(at, e.id)) continue;
      if (hit.notice === 'joined' && isMe(body.subject)) continue;
      const kind = hit.notice === 'joined' ? 'joined' : 'removed';
      if (kind === 'joined' && typeof body.payload?.peerDisplay === 'string' && body.payload.peerDisplay) hit.args = { ...(hit.args ?? {}), name: body.payload.peerDisplay };   // the handle they presented, never their id
      push({ id: e.id, kind, group, open, icon: kind === 'joined' ? '👋' : '🚪', at, saidAt: typeof e.ts === 'number' ? e.ts : 0,
        text: kind === 'joined'
          ? t(FOR_YOU_KEYS.joined, { name: hit.args?.name ?? t(FOR_YOU_KEYS.someone), circle: group.name ?? '' })
          : t(FOR_YOU_KEYS.removed, { circle: group.name ?? '' }) });
    }
  }

  for (const turn of Array.isArray(turns) ? turns : []) {
    if (!turn || turn.origin === 'user' || typeof turn.contactId !== 'string' || typeof turn.messageId !== 'string' || !turn.messageId) continue;
    const at = typeof turn.receivedAt === 'number' ? turn.receivedAt : (typeof turn.ts === 'number' ? turn.ts : 0);
    if (!fresh(at, turn.messageId)) continue;
    const name = (typeof contactName === 'function' ? contactName(turn.contactId) : null) ?? null;
    const text = clip(turn.text ?? '');
    push({ id: turn.messageId, kind: 'dm', group: { kind: 'contact', id: turn.contactId, name }, open: { kind: 'thread', id: turn.contactId },
      icon: EMBED_TYPE_ICON['chat-message'], at, saidAt: typeof turn.ts === 'number' ? turn.ts : 0,
      text: t(FOR_YOU_KEYS.dm, { name: name ?? t(FOR_YOU_KEYS.someone), text }) });
  }

  // newest arrival first; more than FOLD_AFTER rows of one group fold into one row with a count
  rows.sort((a, b) => b.at - a.at);
  const byGroup = new Map();
  for (const r of rows) {
    const k = `${r.group.kind}:${r.group.id}`;
    (byGroup.get(k) ?? byGroup.set(k, []).get(k)).push(r);
  }
  const out = [];
  const folded = new Set();
  for (const r of rows) {
    const k = `${r.group.kind}:${r.group.id}`;
    const all = byGroup.get(k);
    if (all.length <= FOLD_AFTER) { out.push(r); continue; }
    if (folded.has(k)) continue;
    folded.add(k);
    out.push({ ...r, id: `fold:${k}`, kind: 'many', count: all.length, late: all.some((x) => x.late),
      text: t(FOR_YOU_KEYS.many, { count: all.length, name: r.group.name ?? t(FOR_YOU_KEYS.someone) }),
      ids: all.flatMap((x) => x.ids) });
  }
  return out;
}
