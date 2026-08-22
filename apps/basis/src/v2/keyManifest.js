/**
 * keyManifest — the DECLARED contract for the group-key lane's log entries.
 *
 * Same shape and role as `membershipManifest`/`grantsManifest`: a cross-cutting plumbing manifest
 * declaring which signed statement kinds the key lane of the device log carries; the rail refuses
 * anything else at both ends. The acts themselves live in the sealing control agent — establishing
 * a circle's group key and rotating it on a membership change — which emits through the key-event
 * sink; the sink hands each event to this lane's emitter, so the sealed envelope travels INSIDE a
 * signed, chained spine statement (the architecture's recorded route: "chat, membership, key
 * rotations and governance events all ride" the one signed log; key-splitting is L3's named
 * attack, and the per-author chain is what makes it a self-verifying fork-proof).
 */

/** The device-log lane key statements ride — the kind the entry-kind table reserved on
 *  2026-07-27 and nothing wrote until this lane (see lint-kind-appenders). RECORD retention:
 *  every version must survive, or old sealed content silently stops opening. */
export const KEY_LANE = 'key-event';

export const keyManifest = Object.freeze({
  app: 'keys',
  itemTypes: [],
  nouns: {},
  operations: [
    { id: 'keys.establish', description: 'The circle\'s FIRST group key (version 1), sealed to the founding recipients — authored by the creator when the circle seals.', appends: [{ lane: KEY_LANE, kind: 'key-establish' }] },
    { id: 'keys.rotate',    description: 'A group-key ROTATION (version n+1, sealed to the remaining recipients — backward secrecy). A governed action: the circle policy\'s rotateKey decision-class says who may (default any-admin).', appends: [{ lane: KEY_LANE, kind: 'key-rotate' }] },
  ],
});

export default keyManifest;
