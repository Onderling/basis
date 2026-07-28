/**
 * Endorsement — a signed CLAIM over an Agent Card (commons-governance G1).
 *
 * The governed object of the curated agent catalog. An endorsement is a
 * self-verifying Ed25519 statement — `recommend` or `flag` — whose authority
 * comes from WHO signed it, not WHERE it is stored (contrast the agent
 * registry, whose authority = the `/private/` storage location). It is
 * structurally a twin of `@onderling/core`'s `CapabilityToken`: an
 * issuer·subject·sig envelope verified with `AgentIdentity.verify`. The one
 * semantic difference — and the reason it is a NEW record, not a second
 * CapabilityToken — is that it carries a CLAIM (`claim`/`cardHash`) about an
 * Agent Card, not a GRANT of authority. We reuse the crypto
 * (`AgentIdentity.sign/verify`, `b64`), not the token type.
 *
 * ── Why it lives in @onderling/agent-registry (invariant #5) ──────────────────
 * The endorsement is bound to an Agent Card (`SPEC-agents-registry` — the
 * `{name,url,skills[],x-canopy.pubKey}` unit this package already projects via
 * `projectAgentCard`). Agent Cards + the catalog read-view are a SUBSTRATE
 * concern, not kernel: putting card-governance into `@onderling/core` would make
 * the kernel know about catalog curation. So the primitive lives here in the
 * substrate, reusing the kernel crypto (`@onderling/core`) — the substrate → core
 * dependency direction invariant #5 mandates. App wiring stays in the app.
 *
 * Record shape (JSON-serialisable):
 * {
 *   id:        uuid,
 *   endorser:  pubKeyB64,     — who is making the claim (the trust root)
 *   subject:   pubKeyB64,     — the endorsed agent's pubKey
 *   cardHash:  'sha256:<b64url>' — hash of the EXACT Agent Card endorsed
 *   claim:     'recommend' | 'flag',
 *   tags:      string[],      — coarse capability hints (files/calendar/…)
 *   note:      string,
 *   issuedAt:  unix-ms,
 *   expiresAt: unix-ms | null,
 *   sig:       base64url
 * }
 *
 * `cardHash` is the anti-escalation binding: it fixes the endorsement to the
 * exact card content that was reviewed. If the endorsed agent later swaps its
 * skills/egress (an "endorse-then-escalate" attack), the resolved card no
 * longer hashes to `cardHash` → `verifyEndorsement` drops the endorsement.
 */

import { AgentIdentity, b64encode } from '@onderling/core';
import { sha256 }                   from '@noble/hashes/sha2.js';

/** Wire-format version stamped (as `v`) on newly created endorsement records. */
export const ENDORSEMENT_VERSION = 1;

const VALID_CLAIMS = new Set(['recommend', 'flag']);

/**
 * Deep-canonical JSON: recursively sort object keys (arrays keep order).
 * Deterministic across key insertion order so `cardHash` can't be dodged by
 * reordering the card's fields. (CapabilityToken's `_canonical` sorts only
 * top-level keys — enough for its flat record; a card is nested, so we sort
 * deeply.)
 */
function canonicalJSON(value) {
  return JSON.stringify(_sortDeep(value));
}
function _sortDeep(v) {
  if (Array.isArray(v)) return v.map(_sortDeep);
  if (v && typeof v === 'object') {
    const out = {};
    for (const k of Object.keys(v).sort()) out[k] = _sortDeep(v[k]);
    return out;
  }
  return v;
}

/** Canonical form of an endorsement for signing/verifying (sig nulled). */
function endorsementCanonical(rec) {
  const { sig, ...rest } = rec;          // eslint-disable-line no-unused-vars
  return canonicalJSON({ ...rest, sig: null });
}

/**
 * cardHash — `sha256:<b64url>` over the deep-canonical Agent Card.
 * The one hash function both issue and verify agree on.
 */
export function cardHash(card) {
  if (!card || typeof card !== 'object') {
    throw Object.assign(new Error('cardHash: card object required'), { code: 'INVALID_ARGUMENT' });
  }
  const bytes = new TextEncoder().encode(canonicalJSON(card));
  return `sha256:${b64encode(sha256(bytes))}`;
}

/**
 * The pubKey an Agent Card declares (`x-canopy.pubKey`, else top-level).
 * The endorsement's `subject` binds to this.
 */
function cardPubKey(card) {
  const xc = card?.['x-onderling'] ?? card?.['x-canopy'] ?? {};   // legacy spelling still read
  const pk = xc.pubKey ?? card?.pubKey ?? null;
  return (typeof pk === 'string' && pk.length > 0) ? pk : null;
}

function genId() {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') return crypto.randomUUID();
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

/**
 * issueEndorsement — sign a `recommend`/`flag` claim over an Agent Card.
 *
 * @param {import('@onderling/core').AgentIdentity} endorserIdentity  — signs the claim
 * @param {object} opts
 * @param {object}  opts.card                 — the Agent Card being endorsed (REQUIRED — cardHash binds to it)
 * @param {string}  [opts.subject]            — endorsed agent pubKey (defaults to the card's pubKey)
 * @param {'recommend'|'flag'} [opts.claim='recommend']
 * @param {string[]} [opts.tags=[]]
 * @param {string}  [opts.note='']
 * @param {number|null} [opts.expiresIn=null] — ms from now; null = no expiry
 * @param {() => number} [opts.now]           — injectable clock (tests)
 * @returns {object} the signed endorsement record
 */
export function issueEndorsement(endorserIdentity, opts = {}) {
  if (!endorserIdentity || typeof endorserIdentity.sign !== 'function' || typeof endorserIdentity.pubKey !== 'string') {
    throw Object.assign(new Error('issueEndorsement: endorserIdentity with sign()+pubKey required'), { code: 'INVALID_ARGUMENT' });
  }
  const { card, claim = 'recommend', tags = [], note = '', expiresIn = null, now } = opts;
  if (!VALID_CLAIMS.has(claim)) {
    throw Object.assign(new Error(`issueEndorsement: claim must be recommend|flag (got ${claim})`), { code: 'INVALID_ARGUMENT' });
  }
  const subject = opts.subject ?? cardPubKey(card);
  if (typeof subject !== 'string' || subject.length === 0) {
    throw Object.assign(new Error('issueEndorsement: subject (or a card with x-canopy.pubKey) required'), { code: 'INVALID_ARGUMENT' });
  }
  const ts = typeof now === 'function' ? now() : Date.now();
  const unsigned = {
    id:        genId(),
    v:         ENDORSEMENT_VERSION,
    endorser:  endorserIdentity.pubKey,
    subject,
    cardHash:  cardHash(card),
    claim,
    tags:      Array.isArray(tags) ? tags.filter((t) => typeof t === 'string') : [],
    note:      typeof note === 'string' ? note : '',
    issuedAt:  ts,
    expiresAt: (typeof expiresIn === 'number' && expiresIn > 0) ? ts + expiresIn : null,
    sig:       null,
  };
  const sig = endorserIdentity.sign(endorsementCanonical(unsigned));
  return { ...unsigned, sig: b64encode(sig) };
}

/**
 * verifyEndorsement — deny-by-default validation of a claim against a card.
 *
 * Valid iff ALL hold:
 *   1. well-formed record + known claim,
 *   2. NOT expired (expiresAt in the past → invalid; curation goes stale),
 *   3. `subject` === the card's declared pubKey,
 *   4. `cardHash` === `cardHash(card)` — the anti-escalation binding: an agent
 *      that mutated its card after endorsement no longer matches,
 *   5. the Ed25519 signature verifies against `endorser` (AgentIdentity.verify).
 *
 * Any throw / mismatch → returns `false` (never an exception). On success
 * returns the verified "actor" view `{ endorser, subject, claim, cardHash,
 * tags, note, issuedAt, expiresAt }` — truthy, and carrying `claim` so the
 * catalog can separate `recommend` from `flag`.
 *
 * @param {object} rec   — an endorsement record
 * @param {object} card  — the Agent Card the endorsement's subject resolves to
 * @param {object} [o]
 * @param {() => number} [o.now]  — injectable clock (tests)
 * @returns {(false | { endorser, subject, claim, cardHash, tags, note, issuedAt, expiresAt })}
 */
export function verifyEndorsement(rec, card, { now } = {}) {
  try {
    if (!rec || typeof rec !== 'object') return false;
    if (!VALID_CLAIMS.has(rec.claim)) return false;
    if (typeof rec.endorser !== 'string' || rec.endorser.length === 0) return false;
    if (typeof rec.subject !== 'string' || rec.subject.length === 0) return false;
    if (typeof rec.sig !== 'string' || rec.sig.length === 0) return false;

    // Expiry (2) — a lapsed endorsement is dropped, not honoured.
    const ts = typeof now === 'function' ? now() : Date.now();
    if (typeof rec.expiresAt === 'number' && ts >= rec.expiresAt) return false;

    // Card binding (3)+(4). Requires the resolved card.
    if (!card || typeof card !== 'object') return false;
    if (rec.subject !== cardPubKey(card)) return false;
    if (rec.cardHash !== cardHash(card)) return false;

    // Signature (5) — model on CapabilityToken.verify: null the sig, canonical, verify.
    if (!AgentIdentity.verify(endorsementCanonical(rec), rec.sig, rec.endorser)) return false;

    return {
      endorser:  rec.endorser,
      subject:   rec.subject,
      claim:     rec.claim,
      cardHash:  rec.cardHash,
      tags:      Array.isArray(rec.tags) ? [...rec.tags] : [],
      note:      typeof rec.note === 'string' ? rec.note : '',
      issuedAt:  rec.issuedAt ?? null,
      expiresAt: rec.expiresAt ?? null,
    };
  } catch {
    return false;   // deny-by-default: any error is an invalid endorsement
  }
}
