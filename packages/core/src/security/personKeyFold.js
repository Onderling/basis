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
 *   · SELF-SUBJECT: a statement whose author is not its subject is ignored (one announces only one's own key).
 *   · The HIGHEST version is current. Two statements at one version (the person's own equivocation, or a
 *     replay) resolve deterministically: the smaller hash wins, so every replica agrees; nothing is refused,
 *     because both were root-signed and the next rotation supersedes either.
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

/**
 * @param {Array<object>} statements  verified spine bodies, authors resolved to member refs
 * @returns {Map<string, { version: number, pubKey: string, hash: string|null }>}  member ref → current key
 */
export function foldPersonKeys(statements) {
  const out = new Map();
  if (!Array.isArray(statements)) return out;
  for (const s of statements) {
    if (!isSelfPersonKeyStatement(s)) continue;
    const next = { version: s.payload.version, pubKey: s.payload.pubKey, hash: typeof s.hash === 'string' ? s.hash : null };
    const cur = out.get(s.subject);
    if (!cur || next.version > cur.version) { out.set(s.subject, next); continue; }
    if (next.version === cur.version) {
      // deterministic tie-break — the smaller hash (then the smaller key) wins on every replica
      const a = next.hash ?? next.pubKey, b = cur.hash ?? cur.pubKey;
      if (a < b) out.set(s.subject, next);
    }
  }
  return out;
}
