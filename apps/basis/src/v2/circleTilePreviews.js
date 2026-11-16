/**
 * basis v2 — circle tile activity previews.
 *
 * Today's launcher tiles show member count only.  Activity previews put an
 * activity-style subtitle on each tile ("Mira: brood gehaald ✓",
 * "3 new questions on the board") + an unread-count badge.  This module
 * is the pure projection over the existing EventLog ('s Stream
 * already reads the same firehose); web + mobile render thin views over
 * the resulting per-circle map.
 *
 * Output shape per circleId:
 *   { subtitle: string|null, ts: number, unread: number, kinds: string[], unreadIds: Array<{id, at}> }
 *
 *   subtitle = "<actor>: <text>" when the most-recent event carries both
 *              (e.g. a post / chat-message payload), or null when no
 *              event matched a renderable shape (host falls back to the
 *              member-count meta).
 *   ts       = when the most-recent matched event ARRIVED on this device (`landedAt`; 0 when none): what the news is
 *              ordered by. Not when it was said: a tile that shows a time shows this one.
 *   unread   = number of events for this circle whose `ts > seenAt[id]` AND that
 *              `countsAsUnread` — what OTHERS said on the human lane
 *              (default seenAt 0 → "all of that is unread the first time").
 *
 * Note the host owns the seenAt store — on the launcher we never touch
 * it; opening a circle AND leaving it bump it to Date.now() (`bumpSeenAt(id)`),
 * so what happened while you were inside is not "new" when you get back.  Pure
 * helpers stay testable with a Map-backed snapshot.
 */
import { eventCircleId } from './circleStream.js';
import { isKeyLike } from './personLabel.js';
import { isItemLanding } from './itemLanding.js';
import { landedTimeOf } from '../eventLog.js';
import { itemKindChip } from './embedChips.js';
import { param, PARAM_SCOPE, PARAM_KIND, entryKind, LANE } from '@onderling/item-store';

// Parameter register (#36) — tile subtitle render cap (scope:device, kind:internal). `param()` returns 60.
const MAX_SUBTITLE_LEN = param({ key: 'circleTile.maxSubtitleLen', scope: PARAM_SCOPE.DEVICE, kind: PARAM_KIND.INTERNAL, default: 60 });

/**
 * Project an event list + seenAt snapshot into per-circle tile previews.
 *
 * @param {object}   [opts]
 * @param {object[]} [opts.events=[]]   LoggedEvent[] (any order; we sort)
 * @param {object[]} [opts.circles=[]]  normalised circles ({ id, ... })
 * @param {Object<string,number>} [opts.seenAt={}]  { [circleId]: epochMs }
 * @param {string[]} [opts.myRefs=[]]  this person's refs — their own lines are never unread
 * @param {(key: string) => string} [opts.t]  the translator: a landed item's subtitle names its kind in words
 * @param {Set<string>} [opts.readIds]  every id the person READ, on any of their devices (`readMarks.js`): never new
 * @returns {Object<string, {subtitle: string|null, ts: number, unread: number, kinds: string[], unreadIds: Array<{id: string, at: number}>}>}
 */
export function buildTilePreviews({ events = [], circles = [], seenAt = {}, myRefs = [], actorLabel = null, t = null, readIds = null } = {}) {
  const known = new Set((circles || []).map((c) => c?.id).filter(Boolean));
  const out = {};
  // Seed entries for every known circle so the host can drive layout
  // off a stable keyset even when a circle has zero events.
  for (const id of known) out[id] = { subtitle: null, ts: 0, unread: 0, kinds: [], unreadIds: [] };

  const sorted = [...(events || [])]
    .filter((e) => e && typeof e === 'object')
    .sort((a, b) => landedTimeOf(b) - landedTimeOf(a));   // newest ARRIVAL first

  for (const event of sorted) {
    const cid = eventCircleId(event);
    if (!cid || !known.has(cid)) continue;
    const entry = out[cid];
    // News is a line on the human lane or an item that landed (and is still held); a system row (a notification, a
    // statement) never speaks on the tile
    const landing = isItemLanding(event);
    if (!landing && entryKind(event.type).lane !== LANE.HUMAN) continue;

    // First touch sets subtitle + ts (sorted newest-first).
    if (entry.subtitle === null && entry.ts === 0) {
      const sub = landing ? landingSubtitle(event, { actorLabel, t }) : renderSubtitle(event, { actorLabel });
      if (sub) entry.subtitle = sub;
      entry.ts = landedTimeOf(event);
    }
    // Unread: what someone ELSE said, newer than the host-supplied seenAt.
    const seen = typeof seenAt[cid] === 'number' ? seenAt[cid] : 0;
    // new = LANDED here after I looked (a line the relay held for hours counts once it arrives)
    // …and read on none of my devices (the read set holds the source's id: a landed item's, a line's own)
    const sourceId = landing ? event.payload.itemId : event.id;
    if (landedTimeOf(event) > seen && countsAsUnread(event, { myRefs }) && !(readIds && readIds.has(sourceId))) {
      entry.unread += 1;
      // what opening the circle marks read: the id with the SOURCE's time (the same on every device)
      entry.unreadIds.push({ id: sourceId, at: landing ? (event.payload.saidAt ?? event.ts ?? 0) : (event.ts ?? 0) });
      // what is new, by kind (the label a row of news carries): a landed item's own kind, else the line's kind
      const kind = landing ? event.payload.kind : (event.payload?.kind ?? event.type);
      if (typeof kind === 'string' && !entry.kinds.includes(kind)) entry.kinds.push(kind);
    }
  }

  return out;
}

/**
 * Does this event count toward a circle's unread badge? The rule: news is ANOTHER PERSON's line on the human lane.
 *   - The HUMAN lane only — the entry-kinds dictionary decides, so a system kind (roster, rules, a join, an unlisted
 *     type) never counts.
 *   - Not mine: not one of `myRefs` (the shells pass 'me' and every address this person's devices speak as, so a
 *     second device of the same person is mine too).
 *   - Not my own device talking to me: a 'bot' line scoped to me alone (the wizard's lines, the fallback offer).
 * A circle you just made used to greet you with "6 unread": your own setup and your own sends.
 * One decision, read by the web launcher and the mobile one alike.
 *
 * @param {object} event   a LoggedEvent
 * @param {{myRefs?: string[]}} [o]
 * @returns {boolean}
 */
export function countsAsUnread(event, { myRefs = [] } = {}) {
  if (!event || typeof event !== 'object') return false;
  if (!isItemLanding(event) && entryKind(event.type).lane !== LANE.HUMAN) return false;
  const actor = event.actor ?? event.payload?.actor ?? null;
  if (actor === 'bot' && event.payload?.scope === 'self') return false;
  return !(actor && myRefs.includes(actor));
}

/**
 * Best-effort subtitle from a logged event.  Returns null when nothing
 * renderable is in the payload (host falls back to member-count meta).
 *
 * The sender before the text is a NAME or nothing: `actorLabel(actor)` (a host holding the roster passes it) names
 * them, and an actor that is a key is left out rather than printed — "hoi", never "zWOPwK1R: hoi".
 *
 * @param {object} event
 * @param {{ actorLabel?: ((actor: string) => string|null)|null }} [opts]
 */
export function renderSubtitle(event, { actorLabel = null } = {}) {
  if (!event || typeof event !== 'object') return null;
  const p = (event.payload && typeof event.payload === 'object') ? event.payload : {};
  const text = pickText(p);
  if (!text) return null;
  const raw = pickActor(event, p);
  const named = raw && typeof actorLabel === 'function' ? actorLabel(raw) : null;
  const actor = named ?? (raw && !isKeyLike(raw) ? raw : null);
  const trimmed = truncate(text);
  return actor ? `${actor}: ${trimmed}` : trimmed;
}

/** A landed item on the tile: who (a name, never a key) and its kind in words: "Tester B: 🙋 Vraag". */
function landingSubtitle(event, { actorLabel = null, t = null } = {}) {
  const chip = itemKindChip(event.payload?.kind);
  if (!chip) return null;
  const word = typeof t === 'function' ? t(chip.labelKey) : null;
  const what = word && word !== chip.labelKey ? `${chip.icon} ${word}` : chip.icon;
  const raw = event.actor ?? null;
  const named = raw && typeof actorLabel === 'function' ? actorLabel(raw) : null;
  const actor = named ?? (raw && !isKeyLike(raw) ? raw : null);
  return actor ? `${actor}: ${what}` : what;
}

/** The words an event's payload carries (a line's text, a post's body, a title), or null: the tile's and the news rows'. */
export function pickText(payload) {
  const candidates = [payload.text, payload.body, payload.message, payload.title, payload.label];
  for (const c of candidates) {
    if (typeof c === 'string' && c.trim()) return c.trim();
  }
  return null;
}

function pickActor(event, payload) {
  const candidates = [payload.actor, payload.author, payload.from, payload.sender, event.actor];
  for (const c of candidates) {
    if (typeof c === 'string' && c.trim()) return c.trim();
  }
  return null;
}

function truncate(s) {
  return s.length > MAX_SUBTITLE_LEN ? `${s.slice(0, MAX_SUBTITLE_LEN - 1).trimEnd()}…` : s;
}

/**
 * Convenience: bump a seenAt map entry to `now` (or Date.now()).  Pure;
 * returns a new object so the caller can re-render off a fresh
 * reference.  Host persists the result (localStorage / AsyncStorage).
 */
export function bumpSeenAt(seenAt, circleId, now = Date.now()) {
  if (!circleId) return seenAt || {};
  return { ...(seenAt || {}), [circleId]: now };
}

/**
 * The circle a person LEAVES is seen up to that moment — what happened while they were inside it (their own sends, a
 * join they watched) is not news when they get back to the launcher. A subscriber for the shared active-circle signal
 * (`subscribeActiveCircle`): it remembers the open circle and calls `onLeave(id)` when that changes to anything else.
 * Both shells hand it their own seenAt write.
 *
 * @param {(circleId: string) => void} onLeave
 * @returns {(current: string|null) => void}
 */
export function seenOnLeave(onLeave) {
  let open = null;
  return (current) => {
    const next = current || null;
    if (open && open !== next) { try { onLeave(open); } catch { /* a failed write must not break the signal */ } }
    open = next;
  };
}

