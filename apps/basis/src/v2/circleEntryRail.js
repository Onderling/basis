/**
 * circleEntryRail — THE RAIL (convergence slice 1): the one write path that turns a circle-scoped system
 * event into durable, signed truth on the device log, and the verified read that projects it back out.
 *
 *   append:  sign (circle-scoped key, D5) → chain (parent + deps — order is DERIVED at fold, never stamped)
 *            → append to the device EventLog (stable id, first-write-wins on audit kinds) → hand to the fan.
 *   read:    verify every stored statement (signature + chain + circle) → check the CLAIMED actor is the
 *            statement's own authorRef (nobody votes as someone else) → verify the key↔ref BINDING
 *            (self-binding or the injected membership resolver — never trusted from the claim) → compute
 *            equivocators (two statements, one author, same parent → disputed) → project the flat events
 *            the pure folds consume.
 *
 * WHY (principles): P2/P6 — governance was trust-based (unsigned events; any device could fabricate an
 * approval); a signed chained statement makes forgery fail verification and double-voting a self-verifying
 * fork-proof. P8 — one chokepoint every rider (governance now; membership, chat later) enters through.
 * P9 — the gate binds at verify-on-read/ingest, not at the sender. D6 — a kind the manifest didn't declare
 * is refused LOUDLY at append (a misconfigured add-on fails at its own write, not silently).
 *
 * This module is transport- and storage-free by DI: it needs only `eventLog` ({query, appendSilentEntry})
 * and the per-circle signer resolver. The fan stays the caller's (best-effort, never blocks the write).
 */
import { signSpine, verifySpine, authorHead, frontier } from '@onderling/core';

/**
 * @param {object} deps
 * @param {{query:Function, appendSilentEntry:Function}} deps.eventLog  the device log
 * @param {(circleId:string)=>Promise<{identity:object, ref:string}|null>} deps.signerFor
 *   the circle-scoped signer + the member ref it represents (basis: realAgent's circleSignerFor).
 * @param {string} deps.entryKind      the EventLog lane these statements ride (e.g. 'governance')
 * @param {string[]} deps.declaredKinds  the statement kinds the manifest declares for this lane (D6 gate)
 * @param {(a:{author:string, ref:string, circleId:string})=>Promise<boolean>|boolean} [deps.verifyBinding]
 *   verifies a FOREIGN author-key ↔ ref binding (roster circleAddress lookup). Absent → only self-signed
 *   statements resolve (single-device honest degrade; the fan's ingest supplies the full resolver).
 */
export function makeCircleEntryRail({ eventLog, signerFor, entryKind, declaredKinds, verifyBinding } = {}) {
  if (!eventLog || typeof eventLog.query !== 'function' || typeof eventLog.appendSilentEntry !== 'function') {
    throw new Error('circleEntryRail: an eventLog with query + appendSilentEntry is required');
  }
  if (typeof entryKind !== 'string' || !entryKind) throw new Error('circleEntryRail: entryKind required');
  if (!Array.isArray(declaredKinds) || declaredKinds.length === 0) {
    throw new Error('circleEntryRail: declaredKinds required (a rail lane with no declared kinds is inert)');
  }

  /** The stored signed statements for one circle (raw — verification is the read side's job). */
  const storedStatements = (circleId) => eventLog
    .query({})
    .filter((e) => e && e.type === entryKind && e.circleId === circleId && e.payload?.body)
    .map((e) => e.payload);

  const entryId = (stmt) => `${entryKind}:${stmt.body.hash}`;

  /**
   * APPEND — the one write path. Returns `{ entry, statement }`, or null when no circle signer resolves
   * (the caller may fall back to its legacy path during the per-type cutover — one path per type at a time).
   */
  async function append(circleId, { kind, subject, payload, actor } = {}) {
    if (!declaredKinds.includes(kind)) {
      // D6: an undeclared kind is a bug at the DECLARING side — fail loudly at the write, never silently.
      throw new Error(`circleEntryRail(${entryKind}): kind "${kind}" is not declared [${declaredKinds.join(', ')}]`);
    }
    let resolved = null;
    try { resolved = await signerFor(circleId); } catch { resolved = null; }
    const identity = resolved?.identity ?? resolved;
    const ref = resolved?.ref ?? identity?.pubKey ?? null;
    if (!identity?.pubKey || typeof identity.sign !== 'function') return null;
    const bodies = storedStatements(circleId).map((s) => s.body);
    const parent = authorHead(bodies, identity.pubKey);
    const deps = frontier(bodies).filter((h) => h !== parent);
    // The member ref rides the SIGNED payload — the read side verifies the binding, never trusts the claim.
    const statement = signSpine(identity, {
      kind, circleId, subject, payload: { ...(payload ?? {}), authorRef: ref }, parent, deps,
    });
    const entry = eventLog.appendSilentEntry({
      circleId, kind: entryKind, payload: statement, id: entryId(statement), actor: actor ?? ref,
    });
    return { entry, statement };
  }

  /**
   * INGEST — a statement received from a peer: verify (signature + chain + circle + declared kind + the
   * key↔ref binding) BEFORE it may land on this device's log. Idempotent by stable id.
   */
  /** verifySpine THROWS on structurally-garbage input (e.g. a wrong-size signature) — a malicious peer must
   *  get a refusal, never an exception, so every verify on the receive path goes through this wrapper. */
  const safeVerify = (statement, circleId) => {
    try { return verifySpine(statement, { expectedCircleId: circleId }); }
    catch (err) { return { ok: false, reason: `unverifiable: ${err?.message ?? err}` }; }
  };

  async function ingest(circleId, statement) {
    const v = statement && safeVerify(statement, circleId);
    if (!v || !v.ok) return { ok: false, reason: v?.reason ?? 'malformed' };
    if (!declaredKinds.includes(v.body.kind)) return { ok: false, reason: `undeclared kind: ${v.body.kind}` };
    const ref = v.body.payload?.authorRef;
    if (typeof ref !== 'string' || !ref) return { ok: false, reason: 'missing authorRef' };
    if (!(await bindingOk(v.body.author, ref, circleId))) return { ok: false, reason: 'unverifiable key-ref binding' };
    const entry = eventLog.appendSilentEntry({ circleId, kind: entryKind, payload: statement, id: entryId(statement) });
    return { ok: true, entry };
  }

  /** Is `author` (a circle key) genuinely `ref`'s key IN this circle? Self-binding, else the injected resolver. */
  async function bindingOk(author, ref, circleId) {
    try {
      const mine = await signerFor(circleId);
      const myId = mine?.identity ?? mine;
      if (myId?.pubKey === author) return (mine?.ref ?? myId.pubKey) === ref;
    } catch { /* fall through to the foreign resolver */ }
    if (typeof verifyBinding === 'function') {
      try { return !!(await verifyBinding({ author, ref, circleId })); } catch { return false; }
    }
    return false;   // no resolver → only self-signed statements fold (honest single-device degrade)
  }

  /**
   * READ — verify + resolve + project the flat events the pure folds consume, plus the DISPUTED ref set
   * (equivocators: two statements by one author off the same parent — the fork-proof, discounted by the fold).
   *
   * Projection contract (governance): statement kind → `event`, statement subject → `proposalId`, the payload
   * carries the rest; the statement's own `authorRef` must BE the claimed actor (`voter` ?? `by`) — a valid
   * signature does not let a member act as someone else.
   */
  async function readVerified(circleId) {
    const events = [];
    const seenByAuthorParent = new Map();   // `${author}|${parent}` → Set(hash) — fork detection
    const disputedRefs = new Set();
    for (const stmt of storedStatements(circleId)) {
      const v = safeVerify(stmt, circleId);
      if (!v.ok) continue;
      const b = v.body;
      if (!declaredKinds.includes(b.kind)) continue;
      const ref = b.payload?.authorRef;
      if (typeof ref !== 'string' || !ref) continue;
      const actor = b.payload.voter ?? b.payload.by ?? null;
      if (actor !== null && actor !== ref) continue;              // acting-as-someone-else → drop
      if (!(await bindingOk(b.author, ref, circleId))) continue;  // unverifiable binding → drop
      const forkKey = `${b.author}|${b.parentHash ?? ''}`;
      const set = seenByAuthorParent.get(forkKey) ?? new Set();
      set.add(b.hash);
      seenByAuthorParent.set(forkKey, set);
      if (set.size > 1) disputedRefs.add(ref);                    // the self-verifying fork-proof
      const { authorRef, ...payload } = b.payload;
      events.push({ ...payload, kind: entryKind, event: b.kind, proposalId: b.subject, hash: b.hash });
    }
    return { events, disputed: disputedRefs };
  }

  return { append, ingest, readVerified, storedStatements };
}

export default makeCircleEntryRail;
