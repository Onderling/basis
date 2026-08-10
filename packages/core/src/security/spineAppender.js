/**
 * spineAppender.js — the WRITE side of membership-on-the-log: put a signed SPINE statement ON the circle's
 * store, chained to its author's own frontier, ALONGSIDE the writer's typed item. `rosterFold` is the read
 * side (verify + fold the same statements into who-is-in / who-is-admin); this is how the statements get there.
 *
 * A membership writer (join/leave/evict/role) stays key- and identity-free by calling an emitter bound here.
 * Everything this needs — the signer (the acting device's circle-scoped identity), the chain machinery
 * (`signSpine` + `authorHead`) and the store — is passed in or lives in `@onderling/core`; a pure-DI package
 * such as `@onderling/circles` never imports it, it injects the returned emitter.
 *
 *   parent = authorHead(this circle's stored spine bodies, signer.pubKey)   // the author's own last hash
 *   deps   = frontier(bodies) \ { parent }                                  // the OTHER authors' tips seen
 *   statement = signSpine(signer, { kind, circleId, subject, payload, parent, deps })
 *   store.addItems([{ type: SPINE_STATEMENT_ITEM, source: { …, statement } }])
 *
 * `parent` is the issuer's PREVIOUS spine-entry hash (null for their first) — the per-author causal position.
 * `deps` is the CROSS-AUTHOR frontier (DESIGN-log-ordering-unification §2–4): the current tips by OTHER authors
 * this device has stored, i.e. the concurrent branches it had SEEN when signing. Normally EMPTY (you are the
 * only recent writer, so the single tip is your own head); it grows only under genuine concurrency and collapses
 * on the next merge. Both are sourced from the store so a redelivery chains identically and two peers fold the
 * same causal order — that cross-author edge is what lets the fold order a promoted admin's later act correctly.
 */
import { signSpine } from './spineStatement.js';
import { authorHead, frontier } from './authorChain.js';

/** The item type a signed spine statement is stored under on a circle's store (one filterable spine). */
export const SPINE_STATEMENT_ITEM = 'membership-spine';

/** The circle's stored spine statement BODIES — what `authorHead` chains over (verify is the read side's job). */
async function circleSpineBodies(store, circleId) {
  let items = [];
  try { items = await store.listOpen({ type: SPINE_STATEMENT_ITEM }); } catch { items = []; }
  return (items ?? [])
    .filter((i) => i?.source?.groupId === circleId && i?.source?.statement?.body)
    .map((i) => i.source.statement.body);
}

/**
 * Bind a spine appender to a store + the acting device's signer. The signer is the AUTHOR of every statement
 * this emitter appends; `subject` (who/what the transition is about) is passed per call.
 *
 * TWO signer modes:
 *   • `signer`    — one static identity for every circle (legacy: the device's global identity, whose pubKey
 *                   IS the member's ref/webid in the basis binding — author and ref coincide).
 *   • `signerFor` — a PER-CIRCLE resolver `(circleId) => { identity, ref } | identity` — the CIRCLE-SCOPED
 *                   signer (principle 5: per-circle unlinkability; one global key across circles would re-link
 *                   a person's memberships). `identity` signs; `ref` is the member ref (webid) the fold keys
 *                   on. When they differ, the ref rides the SIGNED payload as `authorRef` — a claimed binding
 *                   the READ side must verify (roster-row circleAddress, or the device's own binding) before
 *                   folding; an unverifiable binding is ignored (strengthen-only), never trusted.
 *
 * @param {object} deps
 * @param {{ listOpen: Function, addItems: Function }} deps.store  duck-typed circle store (not imported).
 * @param {{ pubKey: string, sign: (bytes: Uint8Array) => Uint8Array }} [deps.signer]  static acting identity.
 * @param {(circleId: string) => Promise<object>} [deps.signerFor]  per-circle signer resolver (see above).
 * @returns {(t: { kind: string, circleId: string, subject: string, payload?: object, actor?: string })
 *            => Promise<{ body: object, sig: string, by: string } | null>}  appends + returns the signed statement.
 */
export function createSpineAppender({ store, signer, signerFor } = {}) {
  if (!store || typeof store.addItems !== 'function' || typeof store.listOpen !== 'function') {
    throw new Error('createSpineAppender: a store with listOpen + addItems is required');
  }
  if (typeof signerFor !== 'function' && (!signer?.pubKey || typeof signer.sign !== 'function')) {
    throw new Error('createSpineAppender: a signer with pubKey + sign (or a signerFor resolver) is required');
  }
  return async function appendSpine({ kind, circleId, subject, payload, actor } = {}) {
    // Resolve the acting identity + the member ref it represents. Static mode: they coincide (pubKey==ref).
    let identity = signer;
    let ref = signer?.pubKey ?? null;
    if (typeof signerFor === 'function') {
      let resolved = null;
      try { resolved = await signerFor(circleId); } catch { resolved = null; }
      identity = resolved?.identity ?? resolved;
      ref = resolved?.ref ?? identity?.pubKey ?? null;
      // No per-circle signer → no statement (additive, same as an absent emitter — the writer's typed item
      // still records; the spine just gets no entry). Never throw a membership writer over a missing key.
      if (!identity?.pubKey || typeof identity.sign !== 'function') return null;
    }
    // A `leave` is honoured by the fold ONLY when its author IS its subject (you leave yourself). The fold
    // keys on the member REF, so the guard compares the subject against the ref this signer represents —
    // a leave for anyone else would be a dead statement the fold discards; never persist one. (A join may be
    // admin-authored; an evict is authority-checked at the fold; only leave has the author==subject rule.)
    if (kind === 'leave' && subject !== ref) return null;
    const bodies = await circleSpineBodies(store, circleId);
    const parent = authorHead(bodies, identity.pubKey);        // this author's own head (null for the first)
    // The cross-author frontier: the circle's current tips minus this author's own head (which is `parent`).
    // Normally empty; non-empty only when another author wrote concurrently and this device has seen it.
    const deps = frontier(bodies).filter((h) => h !== parent);
    // Circle-scoped mode: the member ref rides the SIGNED payload (covered by hash + signature) so the read
    // side can verify the key↔ref binding and fold in ref space. Legacy mode adds nothing — byte-identical.
    const fullPayload = (ref && ref !== identity.pubKey) ? { ...(payload ?? {}), authorRef: ref } : payload;
    const statement = signSpine(identity, { kind, circleId, subject, payload: fullPayload, parent, deps });
    await store.addItems([{
      type:       SPINE_STATEMENT_ITEM,
      text:       `${kind} ${subject} in ${circleId}`,
      source:     {
        groupId: circleId, kind, subject,
        author:  statement.body.author,
        hash:    statement.body.hash,
        statement,
      },
      visibility: 'household',
    }], { actor: actor ?? ref ?? identity.pubKey });
    return statement;
  };
}

export default createSpineAppender;
