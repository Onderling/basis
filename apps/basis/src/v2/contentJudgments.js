/**
 * WHAT THIS DEVICE PROVED ABOUT A CONTENT STATEMENT, kept on its own device log (the content judge's memory).
 *
 * "S is behind settings change k" and "S is not behind change k" never change once proven: ancestry is fixed. So the
 * items rail keeps each proven answer as a silent entry of its own kind (`content-judged`, entryKinds.js), and a later
 * judging reads it before it walks: a statement is never taken back because the links that proved its place have aged
 * out since. Beside it, ONLY where a take-back would need it, the row as it was before the statement changed it: the
 * row's first statement on this device's log, so nothing older on the log can rebuild the row.
 *
 * The kind is device-LOCAL by its row in the table: signed by nobody, accepted from nobody, carried to nobody (not even
 * the person's other devices: each judges for itself, with links of its own), not mirrored or exported, never news,
 * never a wake. Losing an entry only means judging again: a proof is a cache of a fixed answer, never a source of one.
 * It ages out with the items statements (the same retention class).
 *
 * The third fact kept: WHICH ACT a snapshot was when it arrived here (an add of a row this device did not hold, or a
 * change of a held one). A later judging cannot read it from the log (the row's making ages out, and a sender picks
 * its own links), and a lost one is judged as both: the same answer, or the statement waits (never the other answer).
 */

/** The entry kind (system lane in the entry-kinds table). */
export const CONTENT_JUDGED = 'content-judged';

const RELATIONS = new Set(['behind', 'not-behind']);

/**
 * One entry per fact, so a write never replaces another fact and the first write is the only one. The circle is the
 * entry's own field, never in the payload: a reader that picks a circle's lines by `payload.circleId` never meets one.
 */
const relationId = (circleId, hash, changeId) => `${CONTENT_JUDGED}:${circleId}:${hash}:${changeId}`;
const previousId = (circleId, hash) => `${CONTENT_JUDGED}:${circleId}:${hash}:previous`;
const actId = (circleId, hash) => `${CONTENT_JUDGED}:${circleId}:${hash}:act`;
const adminId = (circleId, hash) => `${CONTENT_JUDGED}:${circleId}:${hash}:admin`;
const ACTS = new Set(['add', 'change']);

function entryOf(log, id) {
  try {
    if (typeof log?.entryById === 'function') return log.entryById(id) ?? null;
    return (log?.query?.({}) ?? []).find((e) => e && e.id === id) ?? null;
  } catch { return null; }
}

function write(log, circleId, id, payload) {
  if (typeof log?.appendSilentEntry !== 'function' || entryOf(log, id)) return;
  try { log.appendSilentEntry({ id, circleId, kind: CONTENT_JUDGED, payload }); } catch { /* a cache that will not write is judged again */ }
}

/**
 * This device's judgments for one circle.
 * @param {object} deviceLog  the device log the rails hold
 * @param {string} circleId
 * @returns {{
 *   relation: (hash: string, changeId: string) => ('behind'|'not-behind'|undefined),
 *   prove: (hash: string, changeId: string, rel: string) => void,
 *   previous: (hash: string) => object|null,
 *   keepPrevious: (hash: string, row: object) => void,
 *   act: (hash: string) => ('add'|'change'|undefined),
 *   noteAct: (hash: string, act: 'add'|'change') => void,
 * }}
 */
export function contentJudgmentsOn(deviceLog, circleId) {
  const ok = Boolean(deviceLog) && typeof circleId === 'string' && circleId;
  const named = (x) => typeof x === 'string' && x;
  return {
    relation(hash, changeId) {
      if (!ok || !named(hash) || !named(changeId)) return undefined;
      const rel = entryOf(deviceLog, relationId(circleId, hash, changeId))?.payload?.rel;
      return RELATIONS.has(rel) ? rel : undefined;
    },
    prove(hash, changeId, rel) {
      if (!ok || !named(hash) || !named(changeId) || !RELATIONS.has(rel)) return;
      write(deviceLog, circleId, relationId(circleId, hash, changeId), { hash, change: changeId, rel });
    },
    previous(hash) {
      if (!ok || !named(hash)) return null;
      const row = entryOf(deviceLog, previousId(circleId, hash))?.payload?.row;
      return row && typeof row === 'object' ? row : null;
    },
    keepPrevious(hash, row) {
      if (!ok || !named(hash) || !row || typeof row !== 'object') return;
      write(deviceLog, circleId, previousId(circleId, hash), { hash, row });
    },
    /** Which act a snapshot was when it ARRIVED here (a row not held: an add; a held one: a change). */
    act(hash) {
      if (!ok || !named(hash)) return undefined;
      const a = entryOf(deviceLog, actId(circleId, hash))?.payload?.act;
      return ACTS.has(a) ? a : undefined;
    },
    noteAct(hash, act) {
      if (!ok || !named(hash) || !ACTS.has(act)) return;
      write(deviceLog, circleId, actId(circleId, hash), { hash, act });
    },
    /** Whether this device first took the statement BY ADMIN AUTHORITY (its author an admin when it was judged here):
     *  a later re-apply takes it again without asking the roster as it stands then (a demotion does not undo it). */
    adminTaken(hash) {
      if (!ok || !named(hash)) return false;
      return entryOf(deviceLog, adminId(circleId, hash))?.payload?.admin === true;
    },
    noteAdminTaken(hash) {
      if (!ok || !named(hash)) return;
      write(deviceLog, circleId, adminId(circleId, hash), { hash, admin: true });
    },
  };
}
