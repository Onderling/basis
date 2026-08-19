/**
 * surfaceNudge — the CONTENTLESS re-pull signal for a connection's filtered edition.
 *
 * A connection reads through a sealed lane of the history mirror, which it pulls for itself. The one
 * thing it cannot know is WHEN there is something new, so the owner's device sends a nudge: a lane id
 * and nothing else. No content, no count, no sender, no subject — a peer watching the wire learns that
 * something happened in some lane, which is the least that can be said while still saying anything.
 *
 * That emptiness is the design, not an optimisation. The alternative — pushing the entry — would put
 * content on a path the recipient did not seal, and the whole point of the reading half is that the
 * connection opens only what its own key opens.
 *
 * This module used to live inside `surfaceRail.js`, alongside a bespoke acting door. The door is gone
 * (the declared ops are reachable over A2A, one gate for every caller); the nudge is not part of that
 * story and outlived it.
 */

/** The wire subtype: "your edition has a new batch — come read." Carries a lane id, nothing else. */
export const SURFACE_NUDGE_SUBTYPE = 'surface-lane-nudge';

/**
 * The connection side's ear. Register a re-pull, hand it inbound payloads, done.
 *
 * @param {object} [a]
 * @param {(a:{laneId:string|null})=>*} [a.onNudge] — may also be set later via `onNudge(cb)`
 * @returns {{onNudge:Function, handleNudge:(payload:object)=>boolean}}
 */
export function makeNudgeListener({ onNudge = null } = {}) {
  let cb = typeof onNudge === 'function' ? onNudge : null;
  return {
    /** Register (or replace) the re-pull. */
    onNudge(fn) { cb = typeof fn === 'function' ? fn : null; },
    /**
     * Router hook for `surface-lane-nudge`. Returns whether it was handled, so a router can fall
     * through to its other subtypes rather than swallowing everything that reaches it.
     */
    handleNudge(payload) {
      if (!cb) return false;
      cb({ laneId: payload?.laneId ?? null });
      return true;
    },
  };
}
