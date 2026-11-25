/**
 * wire.js — the ONE integer that says which wire this build speaks, and the lowest it still accepts.
 *
 * Every signed envelope carries `_w: WIRE_VERSION` inside the signed bytes (SecurityLayer `#sign`), so it cannot be
 * stripped or lowered without breaking the signature. The receive gate (`decryptAndVerify`, right after the signature
 * check) refuses an envelope whose `_w` is missing or below `MIN_WIRE`: the peer is marked refused for this start, it
 * gets ONE refusal frame back (an HI answer carrying our wire and nothing else), and both sides say so in words. A peer
 * whose wire is HIGHER than ours is not refused here: the newer side decides.
 *
 * Raise WIRE_VERSION when a build changes what crosses the wire in a way an older build cannot read; raise MIN_WIRE
 * when this build stops reading an older wire. Both are a format, not a tunable: plain constants, not params.
 * The per-subtype shapes and their versions live in the wire register (apps/basis), not here.
 */

/** The wire this build speaks. */
export const WIRE_VERSION = 1;

/** The lowest wire this build accepts from a peer. */
export const MIN_WIRE = 1;

/** The envelope field that carries the wire, inside the signature. */
export const WIRE_FIELD = '_w';

/** The `refused` value of a refusal frame (an HI answer) sent for a wire below ours. */
export const WIRE_REFUSAL = 'wire';

/**
 * Is a peer's carried wire accepted by a build whose lowest accepted wire is `minWire`?
 * @param {unknown} wire
 * @param {number} [minWire]
 */
export function wireAccepted(wire, minWire = MIN_WIRE) {
  return Number.isInteger(wire) && wire >= minWire;
}

/**
 * Is this HI payload a refusal frame for the wire? (`{ ack: true, refused: 'wire', wire: <n> }`)
 * @param {unknown} payload
 */
export function isWireRefusal(payload) {
  return !!payload && typeof payload === 'object' && payload.refused === WIRE_REFUSAL;
}
