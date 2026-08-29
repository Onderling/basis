/**
 * SecurityLayer — nacl.box encryption + Ed25519 signatures.
 *
 * Wraps every outbound envelope (encrypt + sign) and validates every inbound
 * envelope (verify sig + decrypt) on native transports.
 *
 * HI (hello) envelopes are signed but NOT encrypted — they carry the sender's
 * pubKey in plaintext so the peer can register it and set up the secure channel.
 *
 * All other envelopes: payload is nacl.box encrypted (Curve25519 DH +
 * XSalsa20-Poly1305), then the encrypted envelope is Ed25519-signed.
 *
 * Inbound checks (in order):
 *   1. Replay window: |now − _ts| ≤ REPLAY_WINDOW_MS
 *   2. Dedup cache: reject if _id was seen within DEDUP_TTL_MS
 *   3. Resolve the signing key the envelope CARRIES (`_signedBy`)
 *   4. Verify the Ed25519 signature AGAINST THAT KEY — no lookup, nothing to steer
 *   5. Authorize the proven key: the binding we already hold, then the injected roster port
 *   6. Decrypt payload (skip for HI)
 *
 * ── Decision 1 (2026-07-31) — `_from` is a routing hint, not an identity ───
 * This path used to read `_from`, look up the key held for that address, and
 * verify against it — so whoever controlled `_from` chose which key got
 * checked. It now runs the other way round: **verify against the key carried
 * with the envelope, then authorize that key.** Step 4 establishes only "the
 * holder of key K sent this"; every grain of trust is in step 5, and step 5
 * reads bindings we established out of band. `_from` still routes replies and
 * still names the address a binding hangs off — it authorizes nothing.
 *
 * Nothing mutates `#peers` before the signature check any more, so there is
 * nothing to roll back when that check fails: a rejected envelope cannot leave
 * a trace by construction rather than by unwinding one.
 *
 * ── The rules for `#peers` on the inbound path ─────────────────────────────
 * An inbound envelope may ESTABLISH a key for an address we hold none for
 * (ordinary trust-on-first-use — genuine first contact has to work), and it
 * may CHANGE one only by carrying a valid rotation proof signed by the key we
 * already hold. It may never simply assert a different key. Since Decision 1
 * this is defence in depth rather than the load-bearing wall it was on 07-30:
 * a substituted key no longer decides its own verification, it only fails to
 * match what we hold. Keeping it means an address whose binding was proved
 * (a roster row) still cannot be spoken from by anyone else, on any transport,
 * whether or not a roster authorizer is installed.
 *
 * ── Speaking as more than one identity (Decision 4, 2026-07-31) ────────────
 * An agent has ONE canonical identity and, in every circle it belongs to, a
 * PER-CIRCLE identity derived from the same profile seed (`circleIdentity`,
 * `../identity/circleAddress.js`).  Circle traffic is signed and sealed with
 * the per-circle one, so a relay — or any observer of the headers — cannot
 * correlate a person's circles from the keys on the wire.  Without it, the
 * routing address is per-circle while the key that signs and the key content
 * is sealed to are global, which hands back exactly the linkage per-circle
 * addressing exists to withhold.
 *
 * `addSelfIdentity(address, identity)` registers one.  Selection is by
 * ADDRESS, never by circle: outbound uses `_from` (which the transport
 * stamps from its own bound addresses, so it is ours by construction),
 * inbound uses `_to` (the key the sender sealed to).  This layer therefore
 * never learns that circles exist — it holds a set of identities of its own
 * and the addresses each answers at.
 */
import { P, canonicalize }                          from '../Envelope.js';
import { AgentIdentity }                             from '../identity/AgentIdentity.js';
import { KeyRotation }                               from '../identity/KeyRotation.js';
import { encode as b64encode, decode as b64decode }  from '../crypto/b64.js';
import { SENDER_KEY_FIELD, senderCredential, resolveSenderKey, carriedSenderCredential }
  from './senderKey.js';
import { askSenderAuthorizer }                       from './senderAuthorization.js';
import { param, PARAM_SCOPE, PARAM_KIND }            from '../params.js';

// Parameter register (#36) — the anti-replay window + dedup TTL. scope:device, kind:INTERNAL is load-bearing
// here: these are SECURITY bounds, and kind:internal makes them immutable by construction — a user can never
// widen the replay window through a set-op. `param()` returns each default unchanged.
const REPLAY_WINDOW_MS = param({ key: 'security.replayWindowMs', scope: PARAM_SCOPE.DEVICE, kind: PARAM_KIND.INTERNAL, default: 10 * 60 * 1_000 });  // ±10 minutes (tolerates LAN clock drift)
const DEDUP_TTL_MS     = param({ key: 'security.dedupTtlMs',     scope: PARAM_SCOPE.DEVICE, kind: PARAM_KIND.INTERNAL, default: 10 * 60 * 1_000 });  // match replay window

// ── Error ──────────────────────────────────────────────────────────────────

/**
 * Frozen map of SecurityError codes — one per inbound envelope validation failure
 * (missing/bad signature, replay window, duplicate, unknown peer, decrypt failure).
 */
export const SEC = Object.freeze({
  MISSING_SIG:            'MISSING_SIG',
  REPLAY_WINDOW:          'REPLAY_WINDOW',
  DUPLICATE:              'DUPLICATE',
  UNKNOWN_RECIPIENT:      'UNKNOWN_RECIPIENT',
  UNKNOWN_SENDER:         'UNKNOWN_SENDER',
  BAD_SIG:                'BAD_SIG',
  DECRYPT_FAILED:         'DECRYPT_FAILED',
  // Decision 1 — the envelope must SAY which key signed it, or there is nothing to verify against.
  MISSING_SENDER_KEY:     'MISSING_SENDER_KEY',
  // …and a valid signature by a key that is not the one we hold for that address is a valid
  // signature from someone else. Distinct from BAD_SIG on purpose: "signed by an unexpected key" is
  // a different diagnosis from "not validly signed", and conflating them hid the 07-30 breach.
  SENDER_NOT_BOUND:       'SENDER_NOT_BOUND',
  // …and a valid signature by a key no roster vouches for is a valid signature from a stranger.
  SENDER_NOT_AUTHORIZED:  'SENDER_NOT_AUTHORIZED',
});

/**
 * Error thrown when an envelope fails a security check. Carries a machine-readable
 * `code` (one of the SEC constants) alongside the human-readable message.
 */
export class SecurityError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'SecurityError';
    this.code = code;
  }
}

// ── SecurityLayer ──────────────────────────────────────────────────────────

/**
 * Per-agent envelope crypto: `encrypt()` boxes + signs outbound envelopes and
 * `decryptAndVerify()` validates inbound ones (replay window, dedup, signature, authorize, decrypt).
 * Every outbound envelope carries the key that signed it, and every inbound one is verified against
 * the key IT carries — never against a key looked up by the address it claims. Peer pubkeys are
 * learned from HI envelopes — established when we hold none for that address, never replaced by one
 * (that needs a rotation proof); HI itself is signed but plaintext.
 * Also tracks key-rotation grace state so envelopes to/from a recently rotated key
 * still validate, and can attach an inline rotation proof to outbound envelopes.
 */
export class SecurityLayer {
  /** @type {import('../identity/AgentIdentity.js').AgentIdentity} */
  #identity;
  /** @type {Map<string, string>} address → Ed25519 pubKey (base64url) */
  #peers = new Map();
  /** @type {Map<string, number>} _id → expiresAt (ms) */
  #dedup = new Map();
  /**
   * Group FF — self-rotation grace state.
   *   oldPubKey → { identity: AgentIdentity, graceUntil: ms }
   * During the grace window we still accept inbound envelopes addressed
   * to our OLD pubkey (peers that missed the rotation broadcast) and
   * decrypt them using the old identity's privkey.
   * @type {Map<string, { identity: import('../identity/AgentIdentity.js').AgentIdentity, graceUntil: number }>}
   */
  #selfHistory = new Map();

  /**
   * Group FF+1 — inline proof attached to every outbound envelope during
   * the sender's grace window, so receivers that missed the broadcast
   * auto-migrate on the first post-rotation message.
   * @type {{ proof: object, graceUntil: number } | null}
   */
  #inlineProof = null;

  /**
   * Count of inbound key substitutions refused (step 3 saw a DIFFERENT key
   * held for the address the envelope claims). Refusal is deliberately silent
   * on the wire, so this counter is the only signal it happened — read it in
   * tests and diagnostics ("this peer cannot get through, and here is why").
   * @type {number}
   */
  #refusedSubstitutions = 0;

  /**
   * Decision 4 — the identities this agent may speak AS, besides its canonical one, keyed by the
   * address each speaks from.  Populated with per-circle identities by the app that knows which
   * circles this device is in.
   * @type {Map<string, import('../identity/AgentIdentity.js').AgentIdentity>}
   */
  #selfIdentities = new Map();

  /**
   * The reverse view: `identity.pubKey → address`.  Kept as a SEPARATE index rather than assumed
   * equal, because whether a per-circle signing key and a per-circle address are one derivation or
   * two is an open question (`plans/DESIGN-boundary-authentication.md` §13.2).  Today they are the
   * same string and this map is an identity mapping; if they ever differ, nothing here changes.
   * @type {Map<string, string>}
   */
  #selfAddressByPubKey = new Map();

  /**
   * Decision 1 step 3 — the injected roster-authorize port. The kernel CALLS it and never
   * implements one (invariant 5: concrete membership knowledge does not live in `packages/core`).
   * Null means nobody wired a roster, which passes the step and is counted rather than hidden.
   * @type {((context: object) => {allow: boolean, reason: string})|null}
   */
  #authorizeSender = null;

  /**
   * The key-id resolver for `senderKey.js`. Unused by the full-key form on the wire today; it is
   * threaded so the L1 "key id" answer is a change inside `senderKey.js` and nowhere else.
   * @type {((id: string) => string|null)|null}
   */
  #senderKeyLookup = null;

  /** Count of envelopes refused because no roster vouched for the key that signed them. */
  #refusedUnauthorized = 0;

  /** Count of authorize steps that ran with no authorizer installed — the honest-absence signal. */
  #unauthorizedByAbsence = 0;
  #warnedNoAuthorizer = false;
  /**
   * envelopeId → the address whose key THIS envelope established (first contact only).
   *
   * Exists so a refusal can undo its own side effect and nothing else. Bounded and FIFO: the only
   * reader runs microseconds later in the same handler, so anything old here is already dead weight.
   */
  #establishedBy = new Map();
  static #ESTABLISHED_MAX = 256;

  /**
   * @param {object} opts
   * @param {import('../identity/AgentIdentity.js').AgentIdentity} opts.identity
   * @param {Function} [opts.authorizeSender]  the roster-authorize port (see `setSenderAuthorizer`)
   * @param {Function} [opts.senderKeyLookup]  the L1 key-id resolver (see `senderKey.js`)
   */
  constructor({ identity, authorizeSender = null, senderKeyLookup = null }) {
    this.#identity = identity;
    // Auto-register self so outbound HI sigs are verifiable in loopback tests.
    this.#peers.set(identity.pubKey, identity.pubKey);
    this.setSenderAuthorizer(authorizeSender);
    this.#senderKeyLookup = typeof senderKeyLookup === 'function' ? senderKeyLookup : null;
  }

  // ── The roster-authorize port (Decision 1 step 3 — L3) ─────────────────────

  /**
   * Install the step that decides whether a PROVEN key may speak here.
   *
   * Called with `{ senderKey, from, to, ownAddress, pattern }` and must answer synchronously with
   * `allowSender(reason)` / `refuseSender(reason)` (`senderAuthorization.js`). It is asked only
   * about envelopes that have already verified, so its input is a key someone demonstrably holds —
   * never a claim. Passing anything non-callable removes it.
   *
   * @param {Function|null} authorizer
   * @returns {boolean} whether an authorizer is now installed
   */
  setSenderAuthorizer(authorizer) {
    this.#authorizeSender = typeof authorizer === 'function' ? authorizer : null;
    return !!this.#authorizeSender;
  }

  /** Whether a roster-authorize port is installed. `false` means nothing is checking membership. */
  get hasSenderAuthorizer() { return !!this.#authorizeSender; }

  /** Remember that `envelopeId` is what put a key in the map for `address`. FIFO-bounded. */
  #noteEstablished(envelopeId, address) {
    if (!envelopeId || !address) return;
    this.#establishedBy.set(envelopeId, address);
    while (this.#establishedBy.size > SecurityLayer.#ESTABLISHED_MAX) {
      this.#establishedBy.delete(this.#establishedBy.keys().next().value);
    }
  }

  /**
   * Undo a first-contact registration — but ONLY if this envelope is what made it.
   *
   * The mute path (`hello.js`) used to call `unregisterPeer` outright, on the premise that the only
   * reason we could be holding this peer's key was the handshake we are now refusing. **That premise
   * stopped being true on 2026-07-30**, when keys began arriving from the roster, proved at join —
   * and Decision 1 narrowed first-contact registration further, so the odds that the key came from
   * somewhere else went up again.
   *
   * A mute is a social act: *I do not want to hear from you.* Deleting cryptographic material the
   * person legitimately established at join is a larger and different act — it breaks verification of
   * their past messages and makes an unmute require a fresh handshake to mean anything. So the refusal
   * undoes its own side effect and nothing else.
   *
   * @returns {boolean} whether anything was removed.
   */
  unregisterPeerIfEstablishedBy(address, envelopeId) {
    if (this.#establishedBy.get(envelopeId) !== address) return false;
    this.#establishedBy.delete(envelopeId);
    this.unregisterPeer(address);
    return true;
  }

  /** @returns {number} envelopes refused because no roster vouched for their signing key. */
  get refusedUnauthorizedSenders() { return this.#refusedUnauthorized; }

  /** @returns {number} authorize steps that passed only because no authorizer was installed. */
  get senderAuthorizationsByAbsence() { return this.#unauthorizedByAbsence; }

  /**
   * Group FF — register an old identity for grace-period acceptance.
   * Called by Agent.rotateIdentity (and by agent startup when the vault
   * contains a still-in-grace previous key).  After the graceUntil
   * timestamp passes, #decryptAndVerify stops accepting envelopes
   * addressed to that pubkey.
   *
   * @param {import('../identity/AgentIdentity.js').AgentIdentity} oldIdentity
   * @param {number} graceUntil  — ms epoch
   */
  registerSelfRotation(oldIdentity, graceUntil) {
    this.#selfHistory.set(oldIdentity.pubKey, { identity: oldIdentity, graceUntil });
    // Keep #peers self-registered under the old pubkey too, so envelopes
    // signed BY us with the old key (e.g. the rotation proof itself,
    // echoed back from a test) still verify.
    this.#peers.set(oldIdentity.pubKey, oldIdentity.pubKey);
  }

  /**
   * Group FF — swap the current identity after a rotation.
   * Agent.rotateIdentity calls this AFTER registerSelfRotation so both
   * old and new are valid during grace.
   *
   * @param {import('../identity/AgentIdentity.js').AgentIdentity} newIdentity
   */
  swapIdentity(newIdentity) {
    this.#identity = newIdentity;
    this.#peers.set(newIdentity.pubKey, newIdentity.pubKey);
  }

  /**
   * Group FF+1 — install a signed rotation proof that will be attached
   * to every outbound encrypted envelope until `graceUntil` passes.
   * Peers that missed the broadcast OW thus auto-migrate on the first
   * post-rotation message they receive from us.  Passing `null` clears.
   *
   * @param {object|null} proof
   * @param {number|null} [graceUntil]
   */
  setInlineProof(proof, graceUntil = null) {
    if (!proof) { this.#inlineProof = null; return; }
    this.#inlineProof = { proof, graceUntil: graceUntil ?? Infinity };
  }

  /**
   * True while an inline rotation proof is armed and still within its grace
   * window — i.e. this layer is currently attaching a proof to every outbound
   * encrypted envelope so un-notified peers auto-migrate. The B★ in-process
   * fast-path checks this to STAY ON the wire path during rotation grace, so
   * the inline-proof migration side-effect is never skipped (Group FF+1).
   *
   * @returns {boolean}
   */
  get inlineProofActive() {
    return !!this.#inlineProof && Date.now() < this.#inlineProof.graceUntil;
  }

  /** @returns {string} — current self pubkey */
  get selfPubKey() { return this.#identity.pubKey; }

  // ── Identities of our own (Decision 4) ─────────────────────────────────────

  /**
   * Also speak as `identity` when the envelope says we are `address`.
   *
   * This is how a per-circle signing identity is installed: the app derives it (`circleIdentity`)
   * and hands it over with the address it answers at.  Outbound envelopes whose `_from` is that
   * address are signed AND sealed with it; inbound envelopes sealed to its key are opened with it.
   *
   * Idempotent, and safe to call again after a re-derivation — a second call with the same address
   * replaces the identity and forgets the old key's reverse entry.
   *
   * @param {string} address
   * @param {import('../identity/AgentIdentity.js').AgentIdentity} identity
   * @returns {boolean} whether it was registered (deny-by-default on anything malformed)
   */
  addSelfIdentity(address, identity) {
    if (typeof address !== 'string' || !address) return false;
    if (!identity || typeof identity.pubKey !== 'string' || !identity.pubKey) return false;
    if (typeof identity.sign !== 'function' || typeof identity.box !== 'function') return false;
    const previous = this.#selfIdentities.get(address);
    if (previous && previous.pubKey !== identity.pubKey) {
      this.#selfAddressByPubKey.delete(previous.pubKey);
    }
    this.#selfIdentities.set(address, identity);
    this.#selfAddressByPubKey.set(identity.pubKey, address);
    // Self-register exactly as the constructor does for the canonical identity, so an envelope we
    // signed as this identity verifies on a loopback path and so we can seal to our own address.
    this.#peers.set(address, identity.pubKey);
    this.#peers.set(identity.pubKey, identity.pubKey);
    return true;
  }

  /**
   * Stop speaking as the identity registered at `address` (left a circle). Idempotent.
   * @param {string} address
   * @returns {boolean} whether something was removed
   */
  removeSelfIdentity(address) {
    const identity = this.#selfIdentities.get(address);
    if (!identity) return false;
    this.#selfIdentities.delete(address);
    this.#selfAddressByPubKey.delete(identity.pubKey);
    this.#peers.delete(address);
    return true;
  }

  /**
   * The identity of ours that answers at `addressOrPubKey`, or null — accepting EITHER the address
   * it speaks from or the key it signs with, because the outbound path knows the address (`_from`)
   * and the inbound path knows the key (`_to`, canonicalised to what the sender sealed to).
   * @param {string} addressOrPubKey
   * @returns {import('../identity/AgentIdentity.js').AgentIdentity|null}
   */
  selfIdentityFor(addressOrPubKey) {
    if (typeof addressOrPubKey !== 'string' || !addressOrPubKey) return null;
    const direct = this.#selfIdentities.get(addressOrPubKey);
    if (direct) return direct;
    const addr = this.#selfAddressByPubKey.get(addressOrPubKey);
    return addr ? (this.#selfIdentities.get(addr) ?? null) : null;
  }

  /**
   * The ADDRESS we answer at for one of our own identities — what a reply should be stamped
   * `_from`. Null when this is not one of ours (including the canonical identity, whose address is
   * the transport's own and is not this layer's to name).
   * @param {string} addressOrPubKey
   * @returns {string|null}
   */
  ownAddressFor(addressOrPubKey) {
    if (typeof addressOrPubKey !== 'string' || !addressOrPubKey) return null;
    if (this.#selfIdentities.has(addressOrPubKey)) return addressOrPubKey;
    return this.#selfAddressByPubKey.get(addressOrPubKey) ?? null;
  }

  /** Every address we hold an identity of our own for (excluding the canonical one). */
  get selfAddresses() { return [...this.#selfIdentities.keys()]; }

  // ── Peer registry ──────────────────────────────────────────────────────────

  /**
   * Register (or update) a peer's Ed25519 public key.
   * Called externally by the hello handshake (Phase 2) or manually in tests.
   * @param {string} address   — the peer's transport address
   * @param {string} pubKeyB64 — Ed25519 public key in base64url
   */
  registerPeer(address, pubKeyB64) {
    this.#peers.set(address, pubKeyB64);
  }

  /**
   * Learn a peer key from something a PEER asserted (an HI payload), as
   * opposed to something WE established out of band (a roster row, an operator
   * call — those go through `registerPeer`, which still overwrites, because a
   * proof-verified roster is entitled to be the last word).
   *
   * One rule: **establish if absent, refuse if different.**
   *   • absent    → set it (trust on first use)
   *   • identical → no-op
   *   • different → refuse; the held binding survives untouched
   *
   * A legitimate key change is not refused, it is *routed*: it must arrive as
   * a rotation proof signed by the key we already hold (`migratePeerKey` /
   * the inline `_rotationProof` path), which is the only claim about a new key
   * the current key holder can make and an impostor cannot.
   *
   * Since Decision 1 `decryptAndVerify` no longer calls this: the inbound path
   * binds the key that DEMONSTRABLY signed the envelope, not one asserted in a
   * payload beside it. It remains the setter for keys learned from a peer's own
   * claim elsewhere (`createSecureAgent` files an HI's canonical `payload.pubKey`
   * under itself so a mesh peer is reachable by that key), and the establish /
   * refuse rule is the same rule step 5a applies.
   *
   * @param {string} address
   * @param {string} pubKeyB64
   * @returns {'established'|'unchanged'|'refused'}
   */
  learnPeerKey(address, pubKeyB64) {
    if (typeof address !== 'string' || !address)     return 'refused';
    if (typeof pubKeyB64 !== 'string' || !pubKeyB64) return 'refused';
    const held = this.#peers.get(address);
    if (held === undefined)   { this.#peers.set(address, pubKeyB64); return 'established'; }
    if (held === pubKeyB64)   { return 'unchanged'; }
    this.#refusedSubstitutions += 1;
    return 'refused';
  }

  /** @returns {number} — inbound key substitutions refused since construction. */
  get refusedKeySubstitutions() { return this.#refusedSubstitutions; }

  /** @returns {string|null} */
  getPeerKey(address) {
    return this.#peers.get(address) ?? null;
  }

  /** Remove a peer's key so future sends require a fresh hello. */
  unregisterPeer(address) {
    this.#peers.delete(address);
  }

  /**
   * Group FF — peer key rotation.
   * Walk #peers and replace every entry whose value === `oldPubKey`
   * with `newPubKey`.  Called by the key-rotation receive handler after
   * a proof has been verified, so messages signed by the new key from
   * the same transport addresses continue to verify.
   *
   * @param {string} oldPubKey
   * @param {string} newPubKey
   * @returns {number} number of entries migrated
   */
  migratePeerKey(oldPubKey, newPubKey) {
    let n = 0;
    for (const [addr, pk] of this.#peers) {
      if (pk === oldPubKey) { this.#peers.set(addr, newPubKey); n++; }
    }
    // Also register the pubKey→pubKey mapping so envelopes addressed by
    // the pubKey directly (relay's common case) resolve.
    if (!this.#peers.has(newPubKey)) this.#peers.set(newPubKey, newPubKey);
    return n;
  }

  // ── Outbound ───────────────────────────────────────────────────────────────

  /**
   * Encrypt (if needed) and sign an outbound envelope.
   * Synchronous — all nacl operations are synchronous.
   *
   * @param   {object} envelope — plain envelope from Transport._send
   * @returns {object}          — signed (+ optionally encrypted) envelope
   * @throws  {SecurityError}   — UNKNOWN_RECIPIENT if peer not registered
   */
  encrypt(envelope) {
    const env = { ...envelope };

    // Decision 4 — WHICH of our identities is speaking. `_from` is stamped by the transport out of
    // the addresses it actually holds (`Transport.sendOneWay`/`sendHello` validate the claim), so
    // this is a lookup among our own keys, never something a peer can steer. Unknown ⇒ canonical.
    const sender = this.selfIdentityFor(env._from) ?? this.#identity;

    if (env._p === P.HI) {
      // HI: sign plaintext; no encryption.
      return this.#sign(env, sender);
    }

    // All other types: encrypt payload for the recipient.
    const recipientKey = this.#peers.get(env._to);
    if (!recipientKey) {
      throw new SecurityError(
        SEC.UNKNOWN_RECIPIENT,
        `No pubKey registered for recipient "${env._to}" — send HI first`,
      );
    }

    const plaintext = new TextEncoder().encode(JSON.stringify(env.payload));
    // Sealed BY the same identity that signs it: the receiver opens the box with the key it holds
    // for `_from`, so boxing as one identity and signing as another makes the envelope undecryptable.
    const { nonce, ciphertext } = sender.box(plaintext, recipientKey);

    // Pack nonce ‖ ciphertext into a single base64url blob.
    const combined = new Uint8Array(nonce.length + ciphertext.length);
    combined.set(nonce, 0);
    combined.set(ciphertext, nonce.length);

    env.payload = { _box: b64encode(combined) };

    // Group FF — canonicalise env._to to the *pubkey* the ciphertext was
    // actually boxed for, so the receiver's decryptAndVerify can pick the
    // right self-identity (current vs. grace-window previous).  Without
    // this, a post-rotation peer that encrypts to the rotated recipient's
    // new key would still tag env._to with the recipient's old transport
    // address, and the receiver's grace logic would reach for the wrong
    // privkey.  Transport routing (_put's `to` parameter) is unaffected —
    // it still uses the address the caller passed in.
    env._to = recipientKey;

    // Group FF+1 — attach inline rotation proof if we're still in grace.
    // Lazy-expire: once the window passes, drop the proof.
    if (this.#inlineProof) {
      if (Date.now() >= this.#inlineProof.graceUntil) {
        this.#inlineProof = null;
      } else {
        env._rotationProof = this.#inlineProof.proof;
      }
    }

    return this.#sign(env, sender);
  }

  // ── Inbound ────────────────────────────────────────────────────────────────

  /**
   * Verify and decrypt an inbound envelope.
   * Synchronous.
   *
   * @param   {object} rawEnvelope — as received from the network
   * @returns {object}             — verified + decrypted envelope
   * @throws  {SecurityError}
   */
  decryptAndVerify(rawEnvelope) {
    const env = { ...rawEnvelope };

    // 1. Replay window.
    const age = Date.now() - env._ts;
    if (Math.abs(age) > REPLAY_WINDOW_MS) {
      throw new SecurityError(
        SEC.REPLAY_WINDOW,
        `Envelope ${env._id} outside replay window (age=${age}ms)`,
      );
    }

    // 2. Dedup.
    this.#cleanDedup();
    if (this.#dedup.has(env._id)) {
      throw new SecurityError(SEC.DUPLICATE, `Duplicate envelope ${env._id}`);
    }
    this.#dedup.set(env._id, Date.now() + DEDUP_TTL_MS);

    // 3. THE INVERSION — which key signed this? The envelope says so itself.
    //
    // There is deliberately no lookup here. The old path read `_from`, fetched the key held for
    // that address and verified against it, which meant the attacker-chosen field decided which key
    // was checked. `_signedBy` cannot do that: whatever it names, the signature must verify against
    // exactly that key, so the pair is self-consistent or the envelope is rejected. What the pair
    // does NOT establish is who the holder is — that is step 5's job, and nothing before step 5 may
    // treat this key as anyone in particular.
    //
    // The FORM of the credential (full key today, possibly a key id) is `senderKey.js`'s business
    // and nothing here knows which it is — that is the L1 seam.
    //
    // The absent-signature case is checked FIRST, because "no signature at all" is the coarser and
    // more useful diagnosis: an envelope with neither is unsigned, not mis-keyed.
    if (!env._sig) {
      throw new SecurityError(SEC.MISSING_SIG, `Envelope ${env._id} has no signature`);
    }
    const senderKey = resolveSenderKey(carriedSenderCredential(env), { lookup: this.#senderKeyLookup });
    if (!senderKey) {
      throw new SecurityError(
        SEC.MISSING_SENDER_KEY,
        `Envelope ${env._id} carries no resolvable signing key (${SENDER_KEY_FIELD})`,
      );
    }

    // 4. Verify the signature AGAINST THAT KEY.
    const sigBytes   = b64decode(env._sig);
    const withoutSig = { ...env, _sig: null };
    if (!AgentIdentity.verify(canonicalize(withoutSig), sigBytes, senderKey)) {
      throw new SecurityError(SEC.BAD_SIG, `Invalid signature on envelope ${env._id}`);
    }

    // ── Everything below runs ONLY on an envelope that is internally consistent. Nothing above
    //    touched `#peers`, so a rejection up to here leaves no trace at all — the rollback the
    //    07-31 fix needed is gone because the mutations it undid no longer happen.

    // 5a. AUTHORIZE — against the binding we already hold. Defence in depth since Decision 1: this
    // no longer decides which key verifies, it only refuses a key that is not the one we were told
    // belongs at this address. Kept because it holds with or without a roster authorizer, on every
    // transport, and it is what makes a proof-verified roster row the last word about an address.
    const held = this.#peers.get(env._from);
    let inlineMigration = null;
    if (held !== undefined && held !== senderKey) {
      // The one sanctioned route for a key that genuinely changed: a proof signed by the key we
      // hold, naming the key that just signed this envelope.
      inlineMigration = this.#acceptRotation(env, held, senderKey);
      if (!inlineMigration) {
        this.#refusedSubstitutions += 1;
        throw new SecurityError(
          SEC.SENDER_NOT_BOUND,
          `Envelope ${env._id} is validly signed, but not by the key held for "${env._from}"`,
        );
      }
    }

    // 5b. AUTHORIZE — against the roster, through the injected port (L3). The kernel asks; it does
    // not know what a circle is. `ownAddress` is the receiver-side handle an implementation maps to
    // one: which of OUR addresses this envelope was sealed to, or null for the canonical identity
    // (out-of-circle traffic, where trust-on-first-use is still the right answer).
    const verdict = askSenderAuthorizer(this.#authorizeSender, {
      senderKey,
      from:        env._from,
      to:          env._to,
      ownAddress:  this.ownAddressFor(env._to),
      pattern:     env._p,
    });
    if (!verdict.allow) {
      this.#refusedUnauthorized += 1;
      throw new SecurityError(
        SEC.SENDER_NOT_AUTHORIZED,
        `Envelope ${env._id} is validly signed by a key no roster vouches for (${verdict.reason})`,
      );
    }
    if (!this.#authorizeSender) {
      this.#unauthorizedByAbsence += 1;
      // Say it ONCE, loudly. With no authorizer installed this layer verifies that a message is genuinely
      // signed by the key it carries — and then accepts it from anyone. That is a defensible state for a
      // test rig or a single-peer tool and a serious one for an app with circles, and the difference is
      // invisible unless someone says so. Counted as well as warned (`senderAuthorizationsByAbsence`),
      // because a counter survives a lost console and a warning survives an unread counter.
      if (!this.#warnedNoAuthorizer) {
        this.#warnedNoAuthorizer = true;
        // NAME the layer. A shell boots several agents — the wire-facing peer agent and a handful of
        // in-process app agents on an internal bus — and every one has its own SecurityLayer. Five
        // identical warnings at boot (2026-08-29, on a phone) read as "the wire is unguarded" when
        // they were the in-process layers, which face no wire; the guarded one was the peer agent.
        // A warning that cannot say WHICH layer it is about is a warning nobody can act on.
        const who = typeof this.#identity?.pubKey === 'string' ? this.#identity.pubKey.slice(0, 12) + '…' : 'unnamed';
        console.warn(
          `[security] NO ROSTER AUTHORIZER INSTALLED on layer ${who} — envelopes are being accepted from any key that `
          + 'signs them correctly, with nothing checking whether that key belongs to anyone you know. '
          + 'Install one with setSenderAuthorizer(fn). This warning appears once per SecurityLayer.',
        );
      }
    }

    // 5c. First contact. An address we hold no key for may have one ESTABLISHED by a hello — that
    // is trust-on-first-use, and genuine first contact has to work somehow. It is confined to HI on
    // purpose: TOFU is the out-of-circle answer (contacts, pairing), never the in-circle one, where
    // the roster is the authority and an unknown key is a stranger. Anything else from an address
    // we have never heard of is refused, exactly as before Decision 1.
    if (held === undefined) {
      if (env._p === P.HI) {
        this.#peers.set(env._from, senderKey);
        this.#noteEstablished(env._id, env._from);
      } else {
        throw new SecurityError(
          SEC.UNKNOWN_SENDER,
          `No pubKey registered for sender "${env._from}" — await HI handshake first`,
        );
      }
    }

    // Tag the envelope with the migration info so Agent._dispatch can mirror it into PeerGraph.
    if (inlineMigration) env._rotationMigrated = inlineMigration;

    // 6a. HI is plaintext — return as verified.
    if (env._p === P.HI) {
      return env;
    }

    // 6b. Decrypt payload.
    if (!env.payload?._box) {
      throw new SecurityError(
        SEC.DECRYPT_FAILED,
        `Envelope ${env._id} missing encrypted payload (_box field)`,
      );
    }

    const combined   = b64decode(env.payload._box);
    const nonce      = combined.slice(0, 24);
    const ciphertext = combined.slice(24);

    // Group FF — pick the right self-identity for nacl.box.open:
    //   • If env._to matches current self pubkey, use current.
    //   • Decision 4 — if env._to is one of OUR OTHER identities (a per-circle one), use that:
    //     the sender sealed to the key they hold for the address they dialled, and for circle
    //     traffic that is the per-circle key, not the canonical one.
    //   • If env._to matches a still-in-grace previous self pubkey, use
    //     that previous identity's privkey (peer hadn't received our
    //     rotation broadcast yet, so they encrypted to our old key).
    //   • Otherwise try current as a best-effort — nacl.box.open will
    //     fail cleanly if the recipient doesn't match.
    let unboxIdentity = this.#identity;
    if (env._to && env._to !== this.#identity.pubKey) {
      const own  = this.selfIdentityFor(env._to);
      if (own) unboxIdentity = own;
      const hist = this.#selfHistory.get(env._to);
      if (hist && Date.now() < hist.graceUntil) {
        unboxIdentity = hist.identity;
      }
      // Clean up expired entries opportunistically.
      if (hist && Date.now() >= hist.graceUntil) {
        this.#selfHistory.delete(env._to);
      }
    }
    const plaintext  = unboxIdentity.unbox(ciphertext, nonce, senderKey);
    if (plaintext === null) {
      throw new SecurityError(SEC.DECRYPT_FAILED, `nacl.box.open failed on envelope ${env._id}`);
    }

    env.payload = JSON.parse(new TextDecoder().decode(plaintext));
    return env;
  }

  // ── Private helpers ────────────────────────────────────────────────────────

  /**
   * Sign an envelope: stamp the signing credential, set _sig to null, sign canonical JSON, store
   * base64url. `signer` is the identity speaking (Decision 4) — the canonical one unless the
   * envelope's `_from` named one of ours.
   *
   * The credential goes on BEFORE signing, so it is inside the signed bytes: an attacker who swaps
   * it must re-sign, which is the whole point — the pair (key, signature) is self-consistent or it
   * is nothing. It buys no trust on its own; `decryptAndVerify` step 5 is where trust happens.
   */
  #sign(env, signer = this.#identity) {
    const credential = senderCredential(signer);
    const unsigned   = {
      ...env,
      ...(credential ? { [SENDER_KEY_FIELD]: credential } : {}),
      _sig: null,
    };
    const sig = signer.sign(canonicalize(unsigned));
    return { ...unsigned, _sig: b64encode(sig) };
  }

  /**
   * Step 5's rotation branch — the ONE sanctioned way the key we hold for an address may change.
   *
   * Runs AFTER the signature check (it could not, before Decision 1: verification needed the map to
   * hold the new key already, which is why the migration used to happen first and had to be
   * rolled back on failure). It can therefore be strictly stricter than the old one: the proof must
   * name the key we hold as `old` AND the key that demonstrably signed this envelope as `new`.
   *
   * @param {object} env
   * @param {string} held        the key currently bound to `env._from`
   * @param {string} senderKey   the key that signed this envelope
   * @returns {{oldPubKey: string, newPubKey: string, proof: object}|null}
   */
  #acceptRotation(env, held, senderKey) {
    const proof = env._rotationProof;
    if (!proof || proof.oldPubKey !== held || proof.newPubKey !== senderKey) return null;
    if (!KeyRotation.verify(proof, held))            return null;
    if (!KeyRotation.isWithinGracePeriod(proof))     return null;
    this.#peers.set(env._from, senderKey);
    return { oldPubKey: held, newPubKey: senderKey, proof };
  }

  /** Remove expired entries from the dedup cache. */
  #cleanDedup() {
    const now = Date.now();
    for (const [id, expires] of this.#dedup) {
      if (expires < now) this.#dedup.delete(id);
    }
  }
}
