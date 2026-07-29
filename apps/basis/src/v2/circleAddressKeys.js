/**
 * basis v2 — binding each member's PER-CIRCLE address to their identity key (G12, and G13's real
 * precondition).
 *
 * ── The problem this closes ──────────────────────────────────────────────────────────────────────────
 * `SecurityLayer` keys a peer's public key by **the address you send to**, and the HI handshake only ever
 * populates that under the peer's canonical pubKey. So the moment routing prefers a member's per-circle
 * address (G13 step C), sealing throws `No pubKey registered`, the handshake-retry loop gives up, and the
 * message is held forever. It fails identically on relay, NKN and in-process, because the failure is
 * ABOVE the transport — which is exactly why it read as a routing problem and was not one.
 *
 * ── Why the roster is the right place ────────────────────────────────────────────────────────────────
 * A circle roster row already carries `{pubKey, circleAddress}` **side by side**: the two facts were
 * captured together at join, where the joiner presented their per-circle address and PROVED it
 * (`signCircleAddress`). Nothing new has to be learned, exchanged or derived — the binding is a
 * restatement of what the roster already knows, which is what makes this the membership half of G12
 * rather than a new mechanism.
 *
 * ── What it does NOT do ──────────────────────────────────────────────────────────────────────────────
 * It does not make a per-circle address *discoverable*, and it grants no authority: it only lets this
 * device seal to an address it was already entitled to reach. An address with no matching pubKey on the
 * roster is skipped rather than guessed.
 */

/**
 * Bind every member's per-circle address to their identity key, from a circle roster.
 *
 * Idempotent — re-running after a roster refresh picks up new members and key rotations, and rebinding an
 * unchanged pair is a no-op. Best-effort per row: one malformed member never stops the rest, because a
 * half-applied roster is the failure mode that produces "some people can be messaged and some cannot"
 * with no visible cause.
 *
 * @param {object} a
 * @param {Array<object>} a.members   roster rows (`stoop listGroupMembers`) — `{pubKey, circleAddress}`
 * @param {(address: string, pubKey: string) => any} a.registerPeerAddress
 *   the agent seam (`agent.registerPeerAddress`); absent ⇒ nothing is bound and `{bound: 0}` is returned,
 *   which is the honest degradation on a host that has no secure agent wired.
 * @param {string|null} [a.selfPubKey]  skip my own row — I do not seal to myself
 * @returns {{bound: number, skipped: number}}
 */
export function bindCircleAddressKeys({ members, registerPeerAddress, selfPubKey = null } = {}) {
  let bound = 0;
  let skipped = 0;
  if (typeof registerPeerAddress !== 'function') return { bound, skipped };

  for (const m of Array.isArray(members) ? members : []) {
    const pubKey  = typeof m?.pubKey === 'string' ? m.pubKey : null;
    const address = typeof m?.circleAddress === 'string' ? m.circleAddress : null;
    // A row missing either half is not an error — an older join, or a member who never presented an
    // address. The send path's own ladder (circleAddress → pubKey → webid) already handles them.
    if (!pubKey || !address) { skipped += 1; continue; }
    if (selfPubKey && pubKey === selfPubKey) { skipped += 1; continue; }
    try {
      registerPeerAddress(address, pubKey);
      bound += 1;
    } catch { skipped += 1; }
  }
  return { bound, skipped };
}

/**
 * Drop the bindings for members who are gone (removed, or the whole circle left).
 *
 * Their canonical pubKey mapping is deliberately untouched: they may still be a contact, and forgetting
 * that would break an unrelated conversation. Only the circle-scoped address stops being sealable.
 *
 * @param {object} a
 * @param {Array<object|string>} a.addresses  per-circle addresses, or rows carrying `circleAddress`
 * @param {(address: string) => any} a.forgetPeerAddress
 * @returns {{forgotten: number}}
 */
export function forgetCircleAddressKeys({ addresses, forgetPeerAddress } = {}) {
  let forgotten = 0;
  if (typeof forgetPeerAddress !== 'function') return { forgotten };
  for (const a of Array.isArray(addresses) ? addresses : []) {
    const address = typeof a === 'string' ? a : (typeof a?.circleAddress === 'string' ? a.circleAddress : null);
    if (!address) continue;
    try { forgetPeerAddress(address); forgotten += 1; } catch { /* best-effort */ }
  }
  return { forgotten };
}
