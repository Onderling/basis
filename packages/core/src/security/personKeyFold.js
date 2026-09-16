/**
 * personKeyFold — a person's CURRENT signing key, per circle, as a fold of `person-key` spine statements.
 *
 * The person level signs with a ROTATING key (the design: plans/NOTE-binding-levels.md §10 — never the static
 * profile key). A rotation happens in a ceremony and reaches each circle the person is in as one `person-key`
 * statement on that circle's membership lane: `{ kind: 'person-key', subject: <the member>, payload: { version,
 * pubKey, reveal } }`, authored by whichever of the person's devices ran the ceremony. It binds by ROOT REVEAL
 * (security/ceremonyKinds.js) — the reveal covers the announced key — so a stolen device, which holds the
 * current person key, can announce nothing: it cannot rotate, and it cannot re-announce a key of its own.
 *
 * This fold is PURE and DETERMINISTIC (no clock): every replica holding the same statements projects the
 * same current key per member (principle 10). It is the person-key HEAD; the rail's verifier has already
 * refused what does not bind, so what arrives here is trusted material — the fold only decides which of a
 * member's own statements is CURRENT.
 *
 *   · SELF-SUBJECT: a `person-key` statement whose author is not its subject is ignored (one announces only one's
 *     own key).
 *   · THE FIRST KEY RIDES THE JOIN (Frits 2026-09-16, option A): a `join` or `create` statement may carry
 *     `payload.personKey = { version, pubKey }` for its SUBJECT — device-in-circle signed, the same trust as the
 *     join itself (an admin-authored join forwards the joiner's announcement verbatim, as it does the rules
 *     acceptance). A root-revealed `person-key` statement outranks a join-carried key at the same version.
 *   · The HIGHEST version is current. Two announcements at one version and rank (the person's own
 *     equivocation, or a replay) resolve deterministically: the smaller hash wins, so every replica agrees.
 *   · Junk (no version, no key) is skipped, never thrown on.
 *
 * Read by `deriveRoster` (the roster row's `personKey`) today; the sender authorizer and DM sealing read the
 * row in the steps that follow (§10.7). Nothing writes the statement yet — the ceremony does, in the next step.
 */

export const PERSON_KEY_KIND = 'person-key';

/** The material a person-key reveal must cover: the version and the key, so a reveal binds ONE announcement. */
export function personKeyFacts(payload) {
  const version = payload?.version;
  const pubKey = payload?.pubKey;
  if (!Number.isInteger(version) || version < 1 || typeof pubKey !== 'string' || !pubKey) return null;
  return `${PERSON_KEY_KIND}|${version}|${pubKey}`;
}

/** Whether a body is a well-formed person-key statement about its own author. */
export function isSelfPersonKeyStatement(s) {
  return !!s && s.kind === PERSON_KEY_KIND
    && typeof s.subject === 'string' && !!s.subject
    && s.author === s.subject
    && personKeyFacts(s.payload) !== null;
}

/** The kinds whose payload may carry the subject's FIRST (or current) key, device-in-circle signed. */
export const PERSON_KEY_CARRIER_KINDS = Object.freeze(new Set(['join', 'create']));

/** A candidate `{ version, pubKey, hash, rank }` from a statement, or null. Rank 1 = root-revealed, 0 = join-carried. */
function candidateOf(s) {
  if (!s || typeof s.subject !== 'string' || !s.subject) return null;
  const hash = typeof s.hash === 'string' ? s.hash : null;
  if (isSelfPersonKeyStatement(s)) return { version: s.payload.version, pubKey: s.payload.pubKey, hash, rank: 1 };
  if (PERSON_KEY_CARRIER_KINDS.has(s.kind) && personKeyFacts(s.payload?.personKey) !== null) {
    return { version: s.payload.personKey.version, pubKey: s.payload.personKey.pubKey, hash, rank: 0 };
  }
  return null;
}

/**
 * @param {Array<object>} statements  verified spine bodies, authors resolved to member refs
 * @returns {Map<string, { version: number, pubKey: string, hash: string|null }>}  member ref → current key
 */
export function foldPersonKeys(statements) {
  const out = new Map();
  if (!Array.isArray(statements)) return out;
  for (const s of statements) {
    const next = candidateOf(s);
    if (!next) continue;
    const cur = out.get(s.subject);
    if (!cur || next.version > cur.version) { out.set(s.subject, next); continue; }
    if (next.version !== cur.version) continue;
    if (next.rank !== cur.rank) { if (next.rank > cur.rank) out.set(s.subject, next); continue; }
    // deterministic tie-break — the smaller hash (then the smaller key) wins on every replica
    const a = next.hash ?? next.pubKey, b = cur.hash ?? cur.pubKey;
    if (a < b) out.set(s.subject, next);
  }
  for (const [k, v] of out) out.set(k, { version: v.version, pubKey: v.pubKey, hash: v.hash });
  return out;
}
