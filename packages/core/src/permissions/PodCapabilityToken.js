/**
 * PodCapabilityToken — signed grants for pod-resource access.
 *
 * Mirrors the shape of `CapabilityToken` but is scoped to pod resources
 * (read / write / delete on path prefixes) rather than agent skills.
 *
 * A token gives a specific subject (peer pubKey) permission to perform
 * one or more pod operations on a specific pod root, until expiry.
 *
 * Tokens can be chained: a holder can issue attenuated sub-tokens with
 * a narrower set of scopes and/or a shorter expiry, referencing the
 * parent via `parentId`.
 *
 * Wire format (JSON-serialisable, signed by the issuing agent's identity):
 * {
 *   id:         uuid,
 *   issuer:     pubKeyB64,        // issuing agent's Ed25519 pubKey (base64url)
 *   subject:    pubKeyB64,        // recipient (app or agent) pubKey
 *   pod:        string,           // pod root URI this token authorizes against
 *   scopes:     string[],         // e.g. ['pod.read:/notes/', 'pod.write:/notes/foo.md']
 *   constraints?: object,         // optional extras (rate-limit, audit, …)
 *   issuedAt:   unix-ms,
 *   expiresAt:  unix-ms,
 *   parentId?:  uuid,             // for chaining / attenuation
 *   sig:        base64url         // ed25519 signature over canonical form
 * }
 *
 * Scope syntax (per Design-v3/pod-client-api.md §PodCapabilityToken):
 *   pod.read:<path-prefix>     — read at-or-below <path-prefix>
 *   pod.write:<path-prefix>    — write at-or-below <path-prefix>
 *   pod.delete:<path-prefix>   — delete at-or-below <path-prefix>
 *   pod.*:<path-prefix>        — all of the above
 *
 * Path-prefix matching is **prefix-strict**:
 *   - When the granted path ends with '/', it is a container scope and
 *     matches any path that begins with the granted path.  Example:
 *     `pod.read:/notes/` matches `pod.read:/notes/foo.md` and
 *     `pod.read:/notes/sub/x.md`, but NOT `pod.read:/photos/` and NOT
 *     `pod.read:/notesX/foo.md`.
 *   - When the granted path does NOT end with '/', it is a resource
 *     scope and only matches that exact path.  Example:
 *     `pod.read:/notes/foo.md` matches `pod.read:/notes/foo.md` and
 *     nothing else.  This follows the spec's "trailing slash required
 *     for container-level scopes" rule.
 */
import { AgentIdentity }                            from '../identity/AgentIdentity.js';
import { encode as b64encode, decode as b64decode } from '../crypto/b64.js';
import { genId }                                    from '../Envelope.js';
import { pathScopeCovers }                          from './pathScope.js';
import { parseUntrustedJson } from '../security/untrustedJson.js';

const ACTIONS = ['read', 'write', 'delete'];

/**
 * Immutable wrapper around a signed pod-access grant: `issuer` gives `subject`
 * permission to perform the listed scopes (`pod.read|write|delete|*:<path>`) against
 * pod root `pod` until `expiresAt`. Issue via the static `issue()`; check with
 * `verify()` / `verifyChain()`; `matchesScope()` implements the prefix-strict scope
 * coverage rules; `fromJSON()` re-hydrates a stored or wire token.
 */
export class PodCapabilityToken {
  #raw;

  constructor(raw) { this.#raw = raw; }

  get id()          { return this.#raw.id; }
  get issuer()      { return this.#raw.issuer; }
  get subject()     { return this.#raw.subject; }
  get pod()         { return this.#raw.pod; }
  get scopes()      { return [...(this.#raw.scopes ?? [])]; }
  get constraints() { return this.#raw.constraints ?? {}; }
  get issuedAt()    { return this.#raw.issuedAt; }
  get expiresAt()   { return this.#raw.expiresAt; }
  get parentId()    { return this.#raw.parentId ?? null; }
  get isExpired()   { return Date.now() >= this.#raw.expiresAt; }

  /** Serialise for storage or wire transfer. */
  toJSON()   { return { ...this.#raw, scopes: [...(this.#raw.scopes ?? [])] }; }
  toString() { return JSON.stringify(this.#raw); }

  // ── Issuance ──────────────────────────────────────────────────────────────

  /**
   * Issue a signed PodCapabilityToken.
   *
   * @param {import('../identity/AgentIdentity.js').AgentIdentity} identity
   * @param {object} opts
   * @param {string}    opts.subject              — recipient's pubKey (base64url)
   * @param {string}    opts.pod                  — pod root URI this token covers
   * @param {string[]}  opts.scopes               — array of scope strings (see syntax above)
   * @param {number}    [opts.expiresIn=3600000]  — ms from now
   * @param {object}    [opts.constraints]
   * @param {string}    [opts.parentId]           — parent token id for chaining
   */
  static async issue(identity, opts) {
    if (!opts || typeof opts !== 'object')   throw new Error('PodCapabilityToken.issue: opts required');
    if (typeof opts.subject !== 'string')    throw new Error('PodCapabilityToken.issue: opts.subject required');
    if (typeof opts.pod     !== 'string')    throw new Error('PodCapabilityToken.issue: opts.pod required');
    if (!Array.isArray(opts.scopes) || opts.scopes.length === 0) {
      throw new Error('PodCapabilityToken.issue: opts.scopes must be a non-empty array');
    }

    const now = Date.now();
    const unsigned = {
      id:         genId(),
      issuer:     identity.pubKey,
      subject:    opts.subject,
      pod:        opts.pod,
      scopes:     [...opts.scopes],
      issuedAt:   now,
      expiresAt:  now + (opts.expiresIn ?? 3_600_000),
      ...(opts.constraints ? { constraints: opts.constraints } : {}),
      ...(opts.parentId    ? { parentId:    opts.parentId    } : {}),
      sig: null,
    };

    const sig = identity.sign(_canonical(unsigned));
    return new PodCapabilityToken({ ...unsigned, sig: b64encode(sig) });
  }

  // ── Verification ──────────────────────────────────────────────────────────

  /**
   * Verify signature and expiry.
   * @param {PodCapabilityToken|object} token
   * @param {string} [expectedPod]  — if set, verify token.pod matches
   */
  static verify(token, expectedPod) {
    const raw = token instanceof PodCapabilityToken ? token.toJSON() : token;
    if (!raw || typeof raw !== 'object')      return false;
    if (typeof raw.expiresAt !== 'number')    return false;
    if (Date.now() >= raw.expiresAt)          return false;
    if (expectedPod && raw.pod !== expectedPod) return false;
    if (typeof raw.sig !== 'string')          return false;
    const { sig, ...unsigned } = raw;
    unsigned.sig = null;
    try {
      return AgentIdentity.verify(_canonical(unsigned), b64decode(sig), raw.issuer);
    } catch {
      return false;
    }
  }

  /**
   * Verify a token chain: each link must verify independently, and each
   * child must be an attenuation of its parent:
   *   - child.pod === parent.pod
   *   - every child scope is a subset of some parent scope
   *     (per `matchesScope`)
   *   - child.expiresAt <= parent.expiresAt
   *
   * `tokens` is ordered root-first: tokens[0] is the root issuance,
   * each subsequent entry references its predecessor via `parentId`.
   *
   * @param {Array<PodCapabilityToken|object>} tokens
   */
  static verifyChain(tokens) {
    if (!Array.isArray(tokens) || tokens.length === 0) return false;

    // Each link verifies independently.
    for (const t of tokens) {
      if (!PodCapabilityToken.verify(t)) return false;
    }

    // Walk parent → child checking attenuation.
    for (let i = 1; i < tokens.length; i++) {
      const parent = _raw(tokens[i - 1]);
      const child  = _raw(tokens[i]);

      if (child.parentId !== parent.id)             return false;
      if (child.pod      !== parent.pod)            return false;
      if (child.expiresAt > parent.expiresAt)       return false;

      // Every child scope must be covered by at least one parent scope.
      const childScopes  = Array.isArray(child.scopes)  ? child.scopes  : [];
      const parentScopes = Array.isArray(parent.scopes) ? parent.scopes : [];
      for (const cs of childScopes) {
        let covered = false;
        for (const ps of parentScopes) {
          if (PodCapabilityToken.matchesScope(ps, cs)) { covered = true; break; }
        }
        if (!covered) return false;
      }
    }
    return true;
  }

  // ── Scope matching ────────────────────────────────────────────────────────

  /**
   * Does `grantedScope` cover `requiredScope`?
   *
   * Scope strings have shape `<action>:<path>` where action is one of
   * `pod.read`, `pod.write`, `pod.delete`, `pod.*`.
   *
   * Action matching:
   *   - Exact action match (e.g. `pod.read` covers `pod.read`).
   *   - `pod.*` covers any of `pod.read`, `pod.write`, `pod.delete`.
   *   - `pod.*` on the required side requires `pod.*` on the granted side.
   *
   * Path matching (prefix-strict):
   *   - If grantedPath ends with '/', it is a container prefix and
   *     matches any requiredPath that begins with grantedPath.
   *   - If grantedPath does NOT end with '/', it is a resource scope
   *     and matches only exact equality with requiredPath.  (Per spec:
   *     "trailing slash required for container-level scopes".)
   *
   * @param {string} grantedScope   — scope present in a token
   * @param {string} requiredScope  — scope required by the request
   * @returns {boolean}
   */
  static matchesScope(grantedScope, requiredScope) {
    if (typeof grantedScope !== 'string' || typeof requiredScope !== 'string') return false;

    const granted  = _parseScope(grantedScope);
    const required = _parseScope(requiredScope);
    if (!granted || !required) return false;

    // Action coverage.
    if (granted.action !== required.action) {
      // Wildcard on the granted side covers any concrete action.
      if (granted.action !== '*') return false;
      // Required action must be a known concrete action (or '*' — but
      // '*' on required only covered by '*' on granted, handled above).
      if (!ACTIONS.includes(required.action)) return false;
    }

    // Path coverage — the one prefix-strict rule (shared with the pod-client key broker).
    return pathScopeCovers(granted.path, required.path);
  }

  // ── Parse ─────────────────────────────────────────────────────────────────

  static fromJSON(obj) {
    return new PodCapabilityToken(typeof obj === 'string' ? parseUntrustedJson(obj) : obj);
  }
}

// ── Internals ──────────────────────────────────────────────────────────────

function _canonical(obj) {
  return JSON.stringify(obj, Object.keys(obj).sort());
}

function _raw(t) {
  return t instanceof PodCapabilityToken ? t.toJSON() : t;
}

/**
 * Parse a scope string `pod.<action>:<path>` into `{ action, path }`.
 * Returns null if the shape is malformed.
 *   - `pod.read:/foo` → { action: 'read',  path: '/foo' }
 *   - `pod.*:/foo/`   → { action: '*',     path: '/foo/' }
 */
function _parseScope(s) {
  const colon = s.indexOf(':');
  if (colon < 0) return null;
  const head = s.slice(0, colon);
  const path = s.slice(colon + 1);
  if (!head.startsWith('pod.')) return null;
  const action = head.slice('pod.'.length);
  if (action.length === 0) return null;
  if (action !== '*' && !ACTIONS.includes(action)) return null;
  return { action, path };
}
