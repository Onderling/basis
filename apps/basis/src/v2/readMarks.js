/**
 * What the person has READ, the same on every one of their devices: one `read-marks` row per self and group (a circle,
 * a contact), in that self's own-devices scope, carried between their devices by the sibling carry. A row of news is
 * new when its id is in no read set; the circle tiles, Today's news and the contact badges all read this one set, so
 * they agree on every device.
 *
 * What is marked is an ID with its SOURCE's time (`at`: when it was said, the same everywhere), never this device's
 * landing time. Pruning is a floor (`prunedBefore`) the merge takes at its maximum, at twice the news window, so a late
 * arrival still shown by its landing time is still covered by its mark (the store's `set-union` merge does the rest).
 */
import { param, PARAM_SCOPE, PARAM_KIND } from '@onderling/item-store';
import { buildTilePreviews } from './circleTilePreviews.js';
import { OWN_DEVICES_SCOPE } from './grantsManifest.js';

/**
 * How long a row of news lives (days); the read marks are kept for twice this. The person's to change, like every
 * keeping-time (a setting; the register holds the value, `NOTIFY_WINDOW_DAYS` is its default).
 */
export const NOTIFY_WINDOW_KEY = 'notify.windowDays';
export const NOTIFY_WINDOW_DAYS = param({ key: NOTIFY_WINDOW_KEY, scope: PARAM_SCOPE.DEVICE, kind: PARAM_KIND.USER, default: 7 });
const DAY_MS = 86_400_000;

/** The one row of a self's marks in a group. */
export const readMarksIdOf = (selfId, group) => `read-marks:${selfId || 'default'}:${group}`;

/**
 * The floor below which marks are dropped, for a device whose clock reads `now` and whose news window is `windowDays`.
 * Whole days, so the floor moves once a day and a mark that adds nothing writes nothing. The floor follows the WRITING
 * device's clock and merges by its maximum: a device whose clock runs days ahead raises it for all the person's devices
 * by that much, which with a two-window horizon and day rounding drops a few marks early at worst (they read as new
 * once more, nothing is lost).
 */
export const readMarksFloor = (now = Date.now(), windowDays = NOTIFY_WINDOW_DAYS) => {
  const days = Number.isFinite(windowDays) && windowDays > 0 ? windowDays : NOTIFY_WINDOW_DAYS;
  return Math.floor(now / DAY_MS) * DAY_MS - 2 * days * DAY_MS;
};

/**
 * The row after adding marks: the existing marks plus the new ones (by id; a mark keeps its first `at`), the floor
 * raised to this device's, and every mark below the floor dropped. Returns null when nothing would change.
 *
 * @param {object|null} existing  the stored row, or null
 * @param {object} a
 * @param {string} a.selfId
 * @param {string} a.group
 * @param {Array<{id: string, at: number}>} a.add
 * @param {number} [a.now]
 * @param {number} [a.windowDays]  the person's news window (the register's value)
 */
export function nextReadMarks(existing, { selfId, group, add = [], now = Date.now(), windowDays = NOTIFY_WINDOW_DAYS } = {}) {
  if (typeof group !== 'string' || !group) return null;
  const floor = Math.max(Number.isFinite(existing?.prunedBefore) ? existing.prunedBefore : 0, readMarksFloor(now, windowDays));
  const byId = new Map();
  for (const m of Array.isArray(existing?.read) ? existing.read : []) if (typeof m?.id === 'string' && m.id) byId.set(m.id, m);
  let added = 0;
  for (const m of Array.isArray(add) ? add : []) {
    if (typeof m?.id !== 'string' || !m.id || byId.has(m.id)) continue;
    byId.set(m.id, { id: m.id, at: Number.isFinite(m.at) ? m.at : now });
    added += 1;
  }
  const read = [...byId.values()].filter((m) => m.at >= floor).sort((a, b) => a.at - b.at || a.id.localeCompare(b.id));
  const pruned = (existing?.read?.length ?? 0) + added - read.length;
  if (existing && added === 0 && pruned === 0 && existing.prunedBefore === floor) return null;
  return { ...(existing ?? {}), id: readMarksIdOf(selfId, group), type: 'read-marks', text: 'read-marks', group, read, prunedBefore: floor };
}

/** Every id read, across the rows given (all selves, all groups): one set the projections test against. */
export function readSetOf(rows) {
  const out = new Set();
  for (const r of Array.isArray(rows) ? rows : []) {
    if (r?.type !== 'read-marks') continue;
    for (const m of Array.isArray(r.read) ? r.read : []) if (typeof m?.id === 'string' && m.id) out.add(m.id);
  }
  return out;
}

/**
 * The read set a shell holds, and the two acts that add to it. One object per shell, built over the waist
 * (`callSkill('household', 'markRead' | 'listReadMarks')`), so web, mobile and the box mark and read the same way:
 *   • `ids()`        the current set (empty until the first refresh), handed to the projections as `readIds`;
 *   • `refresh()`    re-read every self's rows (at boot, and when the own store changed: a sibling's marks landed);
 *   • `markCircle(circleId, unreadIds)` / `markContact(contactId, unreadIds, selfId)` the ids just read (a projection's
 *     `unreadIds`: each with its source's own time), written to the self's row; the local set grows at once.
 *
 * @param {object} a
 * @param {(app: string, op: string, args: object) => Promise<any>} a.callSkill
 * @param {() => void} [a.onChange]  the set changed (repaint the badges, invalidate the heads)
 */
export function createReadMarks({ callSkill, onChange = null } = {}) {
  let set = new Set();
  const changed = () => { try { onChange?.(); } catch { /* a repaint never fails a mark */ } };
  async function refresh() {
    if (typeof callSkill !== 'function') return set;
    try {
      const res = await callSkill('household', 'listReadMarks', {});
      const next = readSetOf(res?.rows ?? []);
      const differs = next.size !== set.size || [...next].some((id) => !set.has(id));
      set = next;
      if (differs) changed();
    } catch { /* the last known set still serves */ }
    return set;
  }
  async function mark(group, unreadIds, selfId = null) {
    const read = (Array.isArray(unreadIds) ? unreadIds : []).filter((m) => typeof m?.id === 'string' && m.id && !set.has(m.id));
    if (!group || read.length === 0 || typeof callSkill !== 'function') return false;
    for (const m of read) set.add(m.id);
    changed();
    try { await callSkill('household', 'markRead', { group, read, ...(selfId ? { selfId } : {}) }); } catch { /* marked here; the next mark carries it */ }
    return true;
  }
  return {
    ids: () => set,
    refresh,
    // follow the own store: when a sibling's marks land (or this device wrote), re-read the set. The shell hands its
    // agent's change subscription; which scope is the own one is this module's business, never a shell's.
    follow: (onCircleChanged) => {
      if (typeof onCircleChanged !== 'function') return () => {};
      const off = onCircleChanged((cid) => { if (typeof cid === 'string' && cid.startsWith(OWN_DEVICES_SCOPE)) refresh(); });
      return typeof off === 'function' ? off : () => {};
    },
    markCircle: (circleId, unreadIds) => mark(circleId, unreadIds),
    // what is unread in one circle right now (the one news projection over the log), marked read: opening the circle,
    // and leaving it (what arrived while inside). Everything in it is read, whatever this device's own seen-mark says,
    // so another device that never had the seen-mark agrees.
    markCircleFrom: ({ events, circleId, myRefs = [] } = {}) => {
      if (!circleId) return Promise.resolve(false);
      const p = buildTilePreviews({ events: events ?? [], circles: [{ id: circleId }], seenAt: {}, myRefs, readIds: set });
      return mark(circleId, p[circleId]?.unreadIds ?? []);
    },
    markContact: (contactId, unreadIds, selfId = null) => mark(contactId, unreadIds, selfId),
    // rows of "Nieuw voor jou" read (dismissed, opened, or "Alles gelezen"): each row's ids into its group's marks
    markRows: (rows) => Promise.all((Array.isArray(rows) ? rows : []).map((r) => (r?.group?.id ? mark(r.group.id, r.ids ?? []) : false))),
  };
}
