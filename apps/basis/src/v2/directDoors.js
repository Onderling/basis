/**
 * WHICH INBOUND AND OUTBOUND MESSAGE KINDS ARE DIRECT CONTACT, AND WHICH ARE A CIRCLE'S (Frits 2026-11-12: a block is
 * about direct contact, never a circle). The secure agent keeps the block list and enforces nothing (below the app no
 * one can tell the two apart), so every DIRECT door asks "is the sender blocked?" FIRST, and every CIRCLE door never
 * does: circle traffic must fold the same on every member's device. One list, here; a fitness test
 * (`blockedDirectDoors.test.js`) fails when a subtype a shell routes is in neither list, or a DIRECT handler is not
 * wrapped in `blockedFirst`.
 *
 * Names are as the compositions key their handler maps: a literal subtype, an imported constant's NAME, or a contact
 * channel's `in` / `out`.
 */

import { NEARBY_ROOM_SUBTYPES } from './nearbyRoomBinding.js';
import { SCREEN_NUDGE_SUBTYPE } from './screenNudge.js';
import { SURFACE_NUDGE_SUBTYPE } from './surfaceNudge.js';

/** Direct contact: refused for a blocked sender (inbound) and to a blocked address (outbound). */
export const DIRECT_SUBTYPES = Object.freeze([
  // a person's direct messages, files and answers
  'contact-msg', 'contact-reply', 'file-share', 'chat-message', 'shared-copy',
  // what they send me about my sends and their invitations to me
  'delivery-receipt', 'calendar-invite', 'calendar-rsvp', 'calendar-cancel',
  // a request to MY invite (they are not a member yet: not circle traffic) and its answer
  'group-redeem-request', 'group-redeem-response',
  // the box's doors a person reaches directly (a screen, a companion grant, an identity link's revoke)
  'SCREEN_OFFER_SUBTYPE', 'SCREEN_WAITING_SUBTYPE', 'COMPANION_GRANT_SUBTYPE', 'IDENTITY_LINK_REVOKE_SUBTYPE',
]);

/** A circle's traffic: never asks the block list. */
export const CIRCLE_SUBTYPES = Object.freeze([
  'CHAT_STATEMENT_BROADCAST', 'KEY_STATEMENT_BROADCAST', 'ITEMS_BROADCAST', 'MEMBERSHIP_BROADCAST', 'GRANTS_BROADCAST',
  'circle-report-broadcast', 'circle-address-announce', 'circle-governance-broadcast', 'circle-recipe-broadcast',
  'circle-rules-broadcast',
  // the lanes' catch-up trio (request / offer / batch)
  'catchup:request', 'catchup:offer', 'catchup:batch',
]);

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

/** The wire values behind the constant names above (an outbound payload carries the value, never the name). */
const DIRECT_WIRE = Object.freeze([
  ...DIRECT_SUBTYPES.filter((s) => !/^[A-Z_]+$/.test(s)),
  'screen-offer', 'screen-waiting', 'companion-grant', 'identity-link-revoke',
  // the nudges a screen or a granted view is sent (direct: to one viewer's key) and the Nearby room's lines (people in
  // the same room, direct contact)
  SCREEN_NUDGE_SUBTYPE, SURFACE_NUDGE_SUBTYPE,
  ...NEARBY_ROOM_SUBTYPES,
]);

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
