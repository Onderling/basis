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
 *
 * ── Which key (Decision 4, 2026-07-31) ───────────────────────────────────────────────────────────────
 * Two facts now hang off one roster row, and they are no longer the same key. The member's CANONICAL
 * pubKey still says who they are — that is what groups their addresses together locally, for presence
 * and for the hold queue. But what signs and is sealed to AT a per-circle address is that circle's own
 * signing key, because that is what the sender speaks as. Binding the canonical key there would reject
 * every envelope they send in the circle, with a BAD_SIG that looks like corruption rather than a
 * mis-binding. `circleSigningKeyOf` is where the two are told apart.
 */

/**
 * The key that signs at a member's per-circle address.
 *
 * ▸ **This is the L2 seam** (`plans/DESIGN-boundary-authentication.md` §13.2 — Frits' call). Today the
 *   per-circle signing key and the per-circle address are ONE derivation (`circleIdentity` in
 *   `packages/core/src/identity/circleAddress.js`: "its pubKey IS the per-circle address"), so the
 *   address is the key and no roster field is needed. If the answer becomes TWO derivations, the join
 *   path records the signing key beside the address and this reads it — which is why an explicit
 *   `circleSigningKey` on the row already wins here. Nothing else in the app has to change.
 *
 * @param {object} member  a roster row
 * @returns {string|null}
 */
export function circleSigningKeyOf(member) {
  const explicit = typeof member?.circleSigningKey === 'string' ? member.circleSigningKey : null;
  if (explicit) return explicit;
  return typeof member?.circleAddress === 'string' ? member.circleAddress : null;
}

/**
 * The member's full per-circle address SET, primary first — `circleAddresses` when the roster
 * projected one (deriveRoster admits an address into it only on a verified proof), else the single
 * `circleAddress` slot. Every consumer that must accept or reach "the member's address" and not
 * merely "the first one recorded" reads this.
 *
 * @param {object} member  a roster row
 * @returns {string[]}
 */
export function circleAddressSetOf(member) {
  const primary = typeof member?.circleAddress === 'string' && member.circleAddress
    ? member.circleAddress : null;
  const set = [];
  const seen = new Set();
  const add = (a) => {
    if (typeof a !== 'string' || !a || seen.has(a)) return;
    seen.add(a);
    set.push(a);
  };
  add(primary);
  for (const a of Array.isArray(member?.circleAddresses) ? member.circleAddresses : []) add(a);
  return set;
}

/**
 * Does this roster row carry a per-circle address the member PROVED?
 *
 * ▸ **This is what decides whether a member is held to per-circle signing** (B6). A row that carries
 *   an address *and* the signature over it (`circleAddressProof`, verified by `verifyCircleLink`
 *   before it was ever written — at redeem, or on an announcement) is a member who has demonstrated
 *   they can sign per-circle. From then on their canonical key buys them nothing and leaks their
 *   identity across circles, so `circleSenderAuthorization` stops accepting it.
 *
 * The PROOF, not merely the address, is the test — for one reason that matters: it is the same
 * condition `announceOwnCircleAddressIfChanged` uses to decide whether to re-announce, and the same
 * one `announcementsFromRoster` uses to decide whether a row can be relayed on. So the set of
 * members still allowed to speak canonically is exactly the set the announce path is already trying
 * to heal — one condition, three call sites, no third state to reason about.
 *
 * @param {object} member  a roster row
 * @returns {boolean}
 */
export function hasProvenCircleAddress(member) {
  const signing = circleSigningKeyOf(member);
  if (typeof member?.circleAddressProof === 'string' && member.circleAddressProof
    && typeof signing === 'string' && signing) return true;
  // SET-AWARENESS (add-a-device): a member whose PRIMARY slot is a legacy proofless row but whose
  // set holds a proven extra has still demonstrated per-circle signing — the extra only exists
  // because its proof verified. Derived roster rows carry extras as fold-verified strings (the
  // primary leads the set, so a set of exactly [primary] proves nothing new); trail rows carry
  // {address, proof} pairs, counted only with their proof (deny-by-default).
  const set = member?.circleAddresses;
  if (Array.isArray(set)) {
    for (const e of set) {
      if (typeof e === 'string' && e && e !== member?.circleAddress) return true;
      if (e && typeof e === 'object' && typeof e.address === 'string' && e.address
        && typeof e.proof === 'string' && e.proof) return true;
    }
  }
  return false;
}

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
    const pubKey    = typeof m?.pubKey === 'string' ? m.pubKey : null;
    const addresses = circleAddressSetOf(m);
    // A row missing either half is not an error — an older join, or a member who never presented an
    // address. The send path's own ladder (circleAddress → pubKey → webid) already handles them.
    if (!pubKey || !addresses.length) { skipped += 1; continue; }
    if (selfPubKey && pubKey === selfPubKey) { skipped += 1; continue; }
    try {
      // Two keys, one row: `pubKey` is the person (presence, holds, mute), `signingKey` is what
      // actually signs at this address (Decision 4). See `circleSigningKeyOf`. Every address in the
      // member's proven SET is bound — sealing to their second device's address must not throw
      // `No pubKey registered` while the first device's address works. The primary keeps the
      // explicit-override rule; an additional address signs as itself (the one-derivation L2 rule).
      const primary = typeof m?.circleAddress === 'string' && m.circleAddress ? m.circleAddress : null;
      for (const address of addresses) {
        registerPeerAddress(address, pubKey, {
          signingKey: address === primary ? circleSigningKeyOf(m) : address,
        });
      }
      bound += 1;   // per ROW, as before — the count means "members bound", not addresses
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
