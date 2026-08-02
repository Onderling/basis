/**
 * The roster-authorize PORT — step 3 of Decision 1, declared here and implemented somewhere else.
 *
 * ── The sequence, and why the order is the whole point ───────────────────────────────────────────
 *   1. the envelope carries the key that signed it  (`senderKey.js`)
 *   2. VERIFY the signature against that key         (self-consistent — nothing to substitute)
 *   3. AUTHORIZE that key                            (this port)
 *
 * Step 2 is not trust. A valid signature by a key nobody vouched for proves exactly one thing: the
 * holder of key K sent this. All of the trust is in step 3, and step 3 reads a roster built out of
 * band, at join, from a proof of possession. **A valid signature from a non-member is a valid
 * signature from a stranger, and a stranger does not get membership.**
 *
 * ── THIS FILE IS THE L3 SEAM (`plans/DESIGN-boundary-authentication.md` §13.3 — Frits' call) ─────
 * *"Where does the roster-authorize step live — the kernel or a substrate?"* Invariant 5 (CLAUDE.md)
 * says concrete membership knowledge does not belong in `packages/core`, and step 3 is exactly
 * concrete membership knowledge. That question is **not answered here**, and this file is shaped so
 * it does not have to be: the kernel CALLS the authorizer and never implements one. Today the
 * implementation lives in the app (`apps/basis/src/v2/circleSenderAuthorization.js`), which is the
 * layer that already holds rosters. If the answer is "a substrate", the implementation moves down
 * one package and nothing here, and no call site, changes — the port, the verdict shape and the
 * fail-closed rules are what survive either answer.
 *
 * ── Fail-closed, with one deliberate exception ───────────────────────────────────────────────────
 * An authorizer that throws, returns nothing, or returns a shape this file does not recognise
 * REFUSES. The single exception is having no authorizer at all: the kernel cannot invent membership
 * out of nothing, so with no authorizer installed there is no membership decision to make and the
 * envelope passes this step. That is recorded rather than hidden — the verdict says
 * `no-authorizer`, and `SecurityLayer` counts it, so "nobody wired the roster" is a number you can
 * read rather than a silence you have to notice.
 */

/** Verdict reasons this module produces on its own. Implementations supply their own strings. */
export const SENDER_AUTHORIZATION = Object.freeze({
  NO_AUTHORIZER:      'no-authorizer',
  AUTHORIZER_THREW:   'authorizer-threw',
  AUTHORIZER_UNCLEAR: 'authorizer-returned-no-verdict',
});

/**
 * The sender may speak here.
 * @param {string} reason  why — carried into diagnostics, never into a decision
 * @returns {{allow: true, reason: string}}
 */
export function allowSender(reason) {
  return { allow: true, reason: String(reason ?? 'allowed') };
}

/**
 * The sender may not. `SecurityLayer` turns this into a `SENDER_NOT_AUTHORIZED` refusal.
 * @param {string} reason
 * @returns {{allow: false, reason: string}}
 */
export function refuseSender(reason) {
  return { allow: false, reason: String(reason ?? 'refused') };
}

/**
 * Ask an injected authorizer about one envelope, and normalise whatever comes back.
 *
 * Synchronous by construction: the receive path it sits on is synchronous, and making it async
 * would mean either buffering unverified envelopes or letting them through while the answer is
 * pending — both of which are the check not being a check. An implementation that needs I/O keeps
 * a snapshot and refreshes it out of band; that is a real constraint on implementations and it is
 * stated here rather than discovered.
 *
 * @param {Function|null} authorizer
 * @param {object} context
 * @param {string} context.senderKey   the key that DEMONSTRABLY signed the envelope
 * @param {string} context.from        the claimed sender address — a routing hint, nothing more
 * @param {string} context.to          the envelope's `_to` (a key, for sealed traffic)
 * @param {string|null} context.ownAddress
 *   which of OUR addresses `to` resolves to, when it is one of ours — the receiver-side handle an
 *   implementation maps to a circle. Null means the canonical identity, i.e. not circle-scoped.
 * @param {string} context.pattern     the envelope's `_p`
 * @returns {{allow: boolean, reason: string}}
 */
export function askSenderAuthorizer(authorizer, context) {
  if (typeof authorizer !== 'function') return allowSender(SENDER_AUTHORIZATION.NO_AUTHORIZER);
  let verdict;
  try { verdict = authorizer(context); }
  catch { return refuseSender(SENDER_AUTHORIZATION.AUTHORIZER_THREW); }
  // A promise is a programming error, not a verdict — and awaiting it here is impossible. Refuse
  // loudly rather than coerce a thenable to truthy, which would pass everything.
  if (!verdict || typeof verdict !== 'object' || typeof verdict.then === 'function') {
    return refuseSender(SENDER_AUTHORIZATION.AUTHORIZER_UNCLEAR);
  }
  if (typeof verdict.allow !== 'boolean') return refuseSender(SENDER_AUTHORIZATION.AUTHORIZER_UNCLEAR);
  return verdict.allow ? allowSender(verdict.reason) : refuseSender(verdict.reason);
}
