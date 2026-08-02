/**
 * GroupAuthVerifier — gates relay connections by group membership.
 *
 * Locked Q-E.2 (2026-04-28): the relay accepts a connecting client only
 * if the client presents a valid `GroupManager`-issued proof for one of
 * the groups the relay operator has explicitly listed.  No new token
 * type — we reuse the proofs Track D already mints.
 *
 * Relay configuration shape:
 *   {
 *     acceptedGroups: [
 *       {
 *         groupId:        '<id>',
 *         adminPubKey:    '<base64url>',
 *         requiredRole?:  'member',
 *
 *         // Phase 2 (Stoop V1 — 2026-05-05) additions; all optional.
 *         quotas?:        { msgsPerDay?: number },
 *         revokedMembers?: ['<memberPubKey>', ...],
 *       },
 *       ...
 *     ]
 *   }
 *
 * Open-mode (backward-compat): when `acceptedGroups` is undefined or
 * empty, the relay accepts every client just like today.  Existing
 * deployments do not need to change anything.
 *
 * Composition with Track D3 roles: each entry MAY specify a
 * `requiredRole`.  The verifier then compares the proof's `proof.role`
 * against the configured role using a numeric rank table.  By default
 * the five standard role ranks are used (admin > coordinator > member >
 * observer > external); deployments using custom roles can pass a
 * `roleRanks` map at construction time.
 *
 * Phase 2 (Stoop V1, 2026-05-05) additions, all opt-in:
 *
 *   - `verifyBound({ proof, connectingPubKey, rotationProof? })` is the
 *     strict counterpart to `verify(proof)`.  It also checks that the
 *     proof was issued for the connecting key (closing the spoofing
 *     loophole) — UNLESS a valid `KeyRotationProof` is presented that
 *     links the proof's `memberPubKey` to the connecting `newPubKey`
 *     and is still within its grace period.  Composes
 *     `core.KeyRotation.verify` and `isWithinGracePeriod`.
 *   - `revokedMembers: ['<pubKey>']` per accepted-group entry: members
 *     whose proofs are rejected even when otherwise valid.  Static
 *     config; dynamic admin-signed revocation messages are deferred
 *     to V2 (Stoop Relay Kit).
 *   - `quotas: { msgsPerDay? }` per accepted-group entry.  The verifier
 *     exposes the configured quota on `verify`'s return value; the
 *     *enforcement* (per-group counters) lives in the relay server, not
 *     here.  See `server.js` for the integration.  (`maxConnections` was
 *     removed 2026-07-31 — a connection cap is now per-connection and
 *     circle-blind: `maxAddressesPerConnection` in `server.js`.)
 */
import { verifyGroupProof, KeyRotation, STANDARD_RANKS } from '@onderling/core';

/** Default rank table = the canonical one from core (single source of truth). */
const DEFAULT_ROLE_RANKS = STANDARD_RANKS;

export class GroupAuthVerifier {
  #acceptedGroups;
  #ranks;

  /**
   * @param {object} [opts]
   * @param {Array<{ groupId: string, adminPubKey: string, requiredRole?: string }>} [opts.acceptedGroups]
   * @param {Record<string, number>} [opts.roleRanks] — optional rank
   *   override (e.g. when an app registers custom roles); merges with
   *   the default standard-role ranks.
   */
  constructor({ acceptedGroups = [], roleRanks } = {}) {
    if (!Array.isArray(acceptedGroups)) {
      throw new TypeError('GroupAuthVerifier: acceptedGroups must be an array');
    }
    this.#acceptedGroups = acceptedGroups;
    this.#ranks          = roleRanks
      ? { ...DEFAULT_ROLE_RANKS, ...roleRanks }
      : DEFAULT_ROLE_RANKS;
  }

  /** True if the verifier is configured for open mode (legacy behavior). */
  get isOpen() {
    return this.#acceptedGroups.length === 0;
  }

  /** The configured accepted groups (read-only snapshot). */
  get acceptedGroups() {
    return this.#acceptedGroups.slice();
  }

  /**
   * Decide whether a connecting client's group proof is acceptable.
   *
   * Reasons (when ok=false):
   *   - 'NO_PROOF'             — verifier is closed but client supplied no proof
   *   - 'GROUP_NOT_ACCEPTED'   — proof's groupId is not in the accepted list
   *   - 'INVALID_PROOF'        — sig invalid, expired, or wrong admin pubkey
   *   - 'INSUFFICIENT_ROLE'    — proof's role rank below the group's requiredRole
   *   - 'MEMBER_REVOKED'       — proof's memberPubKey is on the group's revokedMembers list
   *
   * @param {object|undefined} proof
   * @returns {{ ok: true, group: object|null } | { ok: false, reason: string }}
   */
  verify(proof) {
    if (this.isOpen) return { ok: true, group: null };

    if (!proof || typeof proof !== 'object') {
      return { ok: false, reason: 'NO_PROOF' };
    }

    const cfg = this.#acceptedGroups.find(g => g.groupId === proof.groupId);
    if (!cfg) return { ok: false, reason: 'GROUP_NOT_ACCEPTED' };

    if (!verifyGroupProof(proof, cfg.adminPubKey)) {
      return { ok: false, reason: 'INVALID_PROOF' };
    }

    if (cfg.requiredRole) {
      const callerRole   = proof.role ?? 'member'; // legacy proofs default to 'member'
      const callerRank   = this.#ranks[callerRole]      ?? 0;
      const requiredRank = this.#ranks[cfg.requiredRole] ?? 0;
      if (callerRank < requiredRank) {
        return { ok: false, reason: 'INSUFFICIENT_ROLE' };
      }
    }

    if (Array.isArray(cfg.revokedMembers)
        && cfg.revokedMembers.includes(proof.memberPubKey)) {
      return { ok: false, reason: 'MEMBER_REVOKED' };
    }

    return { ok: true, group: cfg };
  }

  /**
   * Strict counterpart to `verify()`.  Adds a binding check: the
   * `proof.memberPubKey` must equal the `connectingPubKey` (the address
   * the client is trying to register with) UNLESS a valid
   * `KeyRotationProof` is presented that links them.
   *
   * Without this check, anyone holding any valid groupProof could
   * register at any address — the relay's `clients` map is keyed by
   * address, so every subsequent message would route to the spoofing
   * connection.  Apps that want this tightening (Stoop V1 does) call
   * `verifyBound`; existing relays that prefer the looser legacy
   * behaviour keep using `verify()`.
   *
   * Reasons (in addition to those of `verify`):
   *   - 'BINDING_MISMATCH'     — proof.memberPubKey ≠ connectingPubKey and no valid rotationProof
   *   - 'INVALID_ROTATION'     — rotationProof signature/shape invalid, or links the wrong keys
   *   - 'ROTATION_EXPIRED'     — rotationProof outside its grace period
   *
   * @param {object} args
   * @param {object} args.proof              — the GroupProof being presented
   * @param {string} args.connectingPubKey   — the address the client is registering with
   * @param {object} [args.rotationProof]    — optional KeyRotationProof bridging old → new
   * @param {() => number} [args.now]        — clock injection for tests; defaults to Date.now
   * @returns {{ ok: true, group: object|null } | { ok: false, reason: string }}
   */
  verifyBound({ proof, connectingPubKey, rotationProof, now } = {}) {
    if (typeof connectingPubKey !== 'string' || !connectingPubKey) {
      throw new TypeError('verifyBound: connectingPubKey required');
    }

    // Run the standard verify first; if it fails, fail with the same reason.
    const base = this.verify(proof);
    if (!base.ok) return base;

    // Open mode → no binding to enforce.
    if (this.isOpen) return base;

    // Fast path: proof is already issued for the connecting key.
    if (proof.memberPubKey === connectingPubKey) return base;

    // Slow path: must present a rotation chain.
    if (!rotationProof) {
      return { ok: false, reason: 'BINDING_MISMATCH' };
    }

    const linksOldToNew =
      rotationProof.oldPubKey === proof.memberPubKey
      && rotationProof.newPubKey === connectingPubKey;
    if (!linksOldToNew) {
      return { ok: false, reason: 'INVALID_ROTATION' };
    }

    if (!KeyRotation.verify(rotationProof, proof.memberPubKey)) {
      return { ok: false, reason: 'INVALID_ROTATION' };
    }

    // Grace-period check uses Date.now() inside KeyRotation by default;
    // accept a `now` injection for deterministic tests.
    const within = typeof now === 'function'
      ? now() < rotationProof.issuedAt + rotationProof.gracePeriod * 1_000
      : KeyRotation.isWithinGracePeriod(rotationProof);
    if (!within) {
      return { ok: false, reason: 'ROTATION_EXPIRED' };
    }

    return base;
  }
}
