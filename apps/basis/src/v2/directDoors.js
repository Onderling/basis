/**
 * WHICH INBOUND AND OUTBOUND MESSAGE KINDS ARE DIRECT CONTACT, AND WHICH ARE A CIRCLE'S (Frits 2026-11-12: a block is
 * about direct contact, never a circle). The secure agent keeps the block list and enforces nothing (below the app no
 * one can tell the two apart), so every DIRECT door asks "is the sender blocked?" FIRST, and every CIRCLE door never
 * does: circle traffic must fold the same on every member's device. The lists are the wire register's; a fitness test
 * (`blockedDirectDoors.test.js`) fails when a subtype a shell routes is in neither list, or a DIRECT handler is not
 * wrapped in `blockedFirst`.
 *
 * Names are as the compositions key their handler maps: a literal subtype, an imported constant's NAME, or a contact
 * channel's `in` / `out`.
 */

import { mapKeysOf, wireNamesOf } from './wireRegister.js';

/**
 * Direct contact: refused for a blocked sender (inbound) and to a blocked address (outbound). A projection of the wire
 * register (wireRegister.js): the direct rows the shells key in a handler map, by the name the map keys them by.
 */
export const DIRECT_SUBTYPES = Object.freeze(mapKeysOf('direct'));

/** Traffic that never asks the block list: a circle's (folds the same on every member's device) and my own devices'. */
export const CIRCLE_SUBTYPES = Object.freeze(mapKeysOf('circle', 'own'));

/** The REFUSED answer a router takes as "not handed on" (peerRouter's NOT_TAKEN shape). */
const REFUSED = Object.freeze({ refused: true });

/**
 * Wrap a DIRECT handler: a sender on the block list (by this address or any address bound to the same person) is
 * refused before the handler runs; nothing is kept, nothing answered. `isBlocked(addr)` is the agent's
 * `messageRequests.isBlocked`; absent, the handler runs as before.
 * @param {(addr: string) => Promise<boolean>|boolean} isBlocked
 * @param {(from: string, payload: object, ctx?: object) => any} handler
 */
export function blockedFirst(isBlocked, handler) {
  if (typeof handler !== 'function') return handler;
  return async function directDoor(from, payload, ctx = {}) {
    if (typeof isBlocked === 'function') {
      let blocked = false;
      try { blocked = (await isBlocked(from)) === true; } catch { blocked = false; }
      if (blocked) return REFUSED;
    }
    return handler(from, payload, ctx);
  };
}

/** Every direct row's wire value (an outbound payload carries the value, never a constant's name). */
const DIRECT_WIRE = Object.freeze(wireNamesOf('direct'));

/** Whether an outbound payload is DIRECT contact (its subtype, flat or inside the A2A data part). */
export function isDirectPayload(payload) {
  const inner = (payload?.type === 'message' && Array.isArray(payload.parts)) ? payload.parts.find((p) => p?.data)?.data : null;
  const sub = inner?.subtype ?? payload?.subtype ?? null;
  return typeof sub === 'string' && DIRECT_WIRE.includes(sub);
}

/**
 * Wrap every handler of a SPREAD map (the Nearby room's: people in the same room, direct contact, not a circle) in
 * `blockedFirst`. A spread has no keys a fitness test can read one by one, so the spread itself is wrapped.
 */
export function blockedAll(isBlocked, handlers) {
  const out = {};
  for (const [k, h] of Object.entries(handlers ?? {})) out[k] = blockedFirst(isBlocked, h);
  return out;
}
