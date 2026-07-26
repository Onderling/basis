// resourceKeyGrant.js — CapabilityToken-gated, per-resource CEK grants (ACL-scoped, revocable).
//
// GAP this closes (vs what already exists in `sealing/`):
//   • `seal(plaintext, recipients)`   — content sealed to a FIXED set of recipient pubkeys, chosen at
//                                        SEAL time. Grow the reader set ⇒ re-seal.
//   • `sealWithGroupKey` + groupKeyResource — content sealed under ONE circle group key; EVERY member of
//                                        that circle can read it. Grant/revoke is circle-wide.
// Neither gives **per-resource, ACL-scoped, after-the-fact** key access: "holder of a valid capability
// scoped to resource A (and only A) may obtain A's key; a holder of a B-token, a non-holder, or a revoked
// holder gets nothing." That finer grain is what a CapabilityToken buys us.
//
// This module is the **key-custodian broker**. It does NOT invent crypto or a token model — it COMPOSES:
//   • the sealing CEK-wrap  (`sealWithGroupKey`/`openWithGroupKey` for the body; `seal`/`open` to wrap the
//     per-resource CEK to a requester's sealing pubkey — the same recipient-mode envelope groupKeyResource
//     uses to distribute a group key, but for ONE resource and gated by a token), and
//   • the ocap primitives from `@onderling/core` (`CapabilityToken.issue`/`.verify`/`offeringMatches`,
//     `TokenRegistry.revoke`/`.isRevoked`).
//
// Placement (layering): pod-client is the substrate that already owns `sealing/` AND already depends on
// `@onderling/core` — so the composition of "sealing CEK-wrap × core ocap" belongs here, additively, beside
// groupKeyResource. The kernel is untouched; existing group/recipient sealing paths are unchanged.
//
// The broker holds the SECRET (a per-resource CEK keyring). The sealed body is host-blind ciphertext that
// lives wherever (pod / object bucket) — the broker never needs it. To read a resource a holder presents a
// CapabilityToken; the broker verifies it (signature, expiry, agent binding, subject binding, resource
// scope, revocation) and, only on the full happy path, wraps THAT resource's CEK to the holder's sealing
// pubkey. Deny-by-default: any failure returns `{ denied }` and never a key.

import { seal, open, sealWithGroupKey, openWithGroupKey, generateGroupKey } from './envelope.js';
import { CapabilityToken, offeringMatches, pathScopeCovers } from '@onderling/core';

// A per-resource read capability is named in the token's `skill` slot as `res.read:<resourceId>`. Reusing
// the `skill` slot means the token model's OWN matcher (`offeringMatches`) enforces per-resource isolation:
// `res.read:A` matches `res.read:A` (exact) and nothing else — a B-token can never unwrap A. A full `'*'`
// token still matches (an intentional super-grant); everything else is denied.
const SCOPE_PREFIX = 'res.read:';

// ── The two grains meet here (G20 list-grain container coverage) ────────────────────────────────────────
// The ITEM grain rides `offeringMatches` (exact / dot-wildcard / `'*'` super-grant) — proven, byte-unchanged.
// The LIST grain grants a CONTAINER scope `res.read:/list/<id>/` (trailing slash) that must cover every item
// AT-OR-BELOW it (`res.read:/list/<id>/item-5`). `offeringMatches` is exact/dot-wildcard only, so it cannot
// express "at-or-below"; the prefix-strict PATH rule that CAN is `PodCapabilityToken`'s — extracted into
// `@onderling/core`'s shared `pathScopeCovers` so BOTH token models reuse the ONE rule (no second token model,
// no new crypto). The bridge is a matcher, not a token: `CapabilityToken` keeps its `skill` slot; we route the
// `res.read:` PATH portion of the two scope strings through the shared prefix matcher.
//
// This lives at the SCOPE gate (not the `checkGrant` seam) by necessity: `checkGrant` runs AFTER the scope
// check and is an AND-restriction (issuer trust-tier / rate limits / pod ACL) — it can only NARROW, never
// WIDEN, so it cannot rescue a container's item that the scope gate already denied. Container coverage is a
// scope-MATCHING concern, so it belongs at the scope gate; `checkGrant` stays the further-restriction seam.
/**
 * Does the granted `res.read:` scope cover the required one? ITEM grain first (the PROVEN `offeringMatches`:
 * exact / `<prefix>.*` / `'*'` super-grant — byte-identical to before). Then, only if that misses, the LIST
 * grain: a trailing-slash container `res.read:/list/<id>/` covers any resource at-or-below it, via the shared
 * prefix-strict `pathScopeCovers`. A non-container (`res.read:<id>`, no slash) grant gains NOTHING here —
 * `pathScopeCovers` falls back to exact path equality, which `offeringMatches` already decided.
 * @param {string} granted   — the token's `skill` (granted scope)
 * @param {string} required  — `resourceScope(resourceId)` (the request's scope)
 * @returns {boolean}
 */
function scopeCovers(granted, required) {
  if (offeringMatches(granted, required)) return true;                       // item grain — unchanged
  if (typeof granted !== 'string' || typeof required !== 'string') return false;
  if (!granted.startsWith(SCOPE_PREFIX) || !required.startsWith(SCOPE_PREFIX)) return false;
  return pathScopeCovers(granted.slice(SCOPE_PREFIX.length), required.slice(SCOPE_PREFIX.length));
}
/**
 * Build the capability `skill` string naming per-resource read access: `res.read:<resourceId>`.
 * `offeringMatches` enforces exact-match isolation — a token for resource B never covers resource A
 * (only a full `'*'` token also matches, as an intentional super-grant).
 * @param {string} resourceId — non-empty resource id
 * @returns {string} the scope string
 */
export function resourceScope(resourceId) {
  if (typeof resourceId !== 'string' || resourceId.length === 0) {
    throw new Error('resourceScope: resourceId (non-empty string) required');
  }
  return SCOPE_PREFIX + resourceId;
}

/**
 * Create a per-resource key-grant broker (the key custodian).
 *
 * @param {object} opts
 * @param {import('@onderling/core').AgentIdentity} opts.identity
 *   The custodian's AgentIdentity — signs (issues) grants and is the `agentId` every grant is bound to.
 *   `CapabilityToken.verify(token, identity.pubKey)` therefore only accepts grants THIS broker issued.
 * @param {import('@onderling/core').TokenRegistry} [opts.tokenRegistry]
 *   Revocation source. `releaseKey` denies when `tokenRegistry.isRevoked(token.id)` is truthy; `revoke`
 *   delegates to it. If omitted, an in-memory revocation set is used (revocation still works within the
 *   process; supply a vault-backed TokenRegistry for persistence).
 * @param {(ctx: {token: CapabilityToken, requesterPubKey: string, resourceId: string}) => (boolean|Promise<boolean>)} [opts.checkGrant]
 *   OPTIONAL pod-side ACL seam (the deferred boundary). When supplied it runs AFTER all token checks pass
 *   and must return `true`, else the release is denied. This is where a full `PolicyEngine` inbound check
 *   (issuer trust-tier, pod ACL / `PodCapabilityToken` path scopes, rate limits) plugs in at the pod. The
 *   core primitive is self-contained without it: the signed, subject-bound, resource-scoped, revocable
 *   token IS the capability.
 * @param {{ grant: Function, revoke: Function }} [opts.sharing]
 *   OPTIONAL pod ACP surface (`client.sharing` — grant/revoke, already enforcing the SHARING_GRANT_NOOP /
 *   SHARING_REVOKE_NOOP contract: a no-op SDK return THROWS). This is the deferred **pod-side ACL wiring**
 *   (S card). The token gate above stays AUTHORITATIVE and decides IF a grant may issue; the ACP is only the
 *   pod-side ENFORCEMENT reflection of an ALREADY-authorized grant (defence in depth — so the pod itself
 *   denies the resource, not just the key custodian). When present:
 *     • `releaseKey` on the happy path (token verified, subject-bound, in-scope, not revoked, checkGrant ok)
 *       ALSO lands `sharing.grant({ resourceUri, agent, modes })`. A token-DENIED release lands NO ACP grant
 *       and hands over NO key — the gate is not bypassed.
 *     • `revoke({ tokenId, resourceId|resourceUri, agent })` ALSO calls `sharing.revoke(...)`, so the grantee
 *       loses the key (future `releaseKey` denied) AND the pod denies the resource.
 *   A no-op ACP change PROPAGATES (the SHARING_*_NOOP throw is never swallowed). Mirrors `createCanonicalShare`.
 *   When ABSENT, behaviour is exactly as before — a key-only grant/revoke (full back-compat).
 * @param {(resourceId: string) => (string|null)} [opts.resourceUriFor]
 *   OPTIONAL map from an internal `resourceId` (the keyring key) to the pod resource URI the ACP targets.
 *   Defaults to identity (resourceId IS the URI). A per-call `resourceUri` always overrides it.
 * @param {import('../sharing/index.js').ShareMode[]} [opts.modes=['read']]
 *   The ACP mode(s) the pairing grants/revokes. Per-resource key grants are read-only by design.
 */
export function createResourceKeyGrant({
  identity, tokenRegistry = null, checkGrant = null,
  sharing = null, resourceUriFor = null, modes = ['read'],
} = {}) {
  if (!identity || typeof identity.sign !== 'function' || !identity.pubKey) {
    throw new Error('createResourceKeyGrant: an AgentIdentity (with sign + pubKey) is required');
  }
  if (tokenRegistry && typeof tokenRegistry.isRevoked !== 'function') {
    throw new Error('createResourceKeyGrant: tokenRegistry must expose isRevoked/revoke');
  }
  if (checkGrant != null && typeof checkGrant !== 'function') {
    throw new Error('createResourceKeyGrant: checkGrant must be a function');
  }
  if (sharing != null && (typeof sharing.grant !== 'function' || typeof sharing.revoke !== 'function')) {
    throw new Error('createResourceKeyGrant: sharing must expose grant/revoke');
  }
  if (resourceUriFor != null && typeof resourceUriFor !== 'function') {
    throw new Error('createResourceKeyGrant: resourceUriFor must be a function');
  }

  // Map an internal resourceId (keyring key) → the pod resource URI the ACP targets. A per-call `resourceUri`
  // wins; else `resourceUriFor(resourceId)`; else the resourceId IS the URI.
  const uriFor = (resourceId, resourceUri) =>
    resourceUri || (resourceUriFor ? resourceUriFor(resourceId) : null) || resourceId;

  // resourceId → CEK (b64url 32-byte symmetric key). The broker's secret keyring.
  const keyring = new Map();
  // Fallback in-memory revocation set when no TokenRegistry is injected.
  const localRevoked = new Set();

  const isRevoked = async (id) => {
    if (tokenRegistry) return !!(await tokenRegistry.isRevoked(id));
    return localRevoked.has(id);
  };

  return {
    /** This broker's (custodian's) pubkey — the `agentId` every grant is bound to. */
    get pubKey() { return identity.pubKey; },

    /**
     * Register a resource under a fresh (or supplied) per-resource CEK, and seal `plaintext` under it.
     * The returned `sealed` is host-blind ciphertext (store it on the pod/bucket); the CEK is retained in
     * the broker's keyring and released only via `releaseKey`.
     * @returns {{ resourceId: string, sealed: string, scope: string }}
     */
    sealResource(resourceId, plaintext, { cek = null } = {}) {
      resourceScope(resourceId); // validates resourceId shape
      const key = cek || keyring.get(resourceId) || generateGroupKey();
      keyring.set(resourceId, key);
      return { resourceId, sealed: sealWithGroupKey(String(plaintext), key), scope: resourceScope(resourceId) };
    },

    /** True if this broker holds a CEK for `resourceId`. */
    hasResource(resourceId) { return keyring.has(resourceId); },

    /**
     * ROTATE — re-seal a resource under a FRESH CEK (the revoke-side honesty half, grants-over-Peer D4).
     *
     * Revoking a CEK grant denies FUTURE `releaseKey` calls, but a grantee who already fetched the key
     * cannot be made to un-see it — so, exactly like the circle's ban→rotate, a revoke that must bite
     * re-seals the resource under a new key. Holders whose grants are still live simply obtain the new CEK
     * on their next `releaseKey`; the revoked holder's token is denied, so their old CEK opens only the
     * ciphertext they already had.
     *
     * The broker holds the current CEK, so it opens and re-seals internally — the caller passes the stored
     * ciphertext and stores what comes back, and PLAINTEXT NEVER LEAVES this function.
     *
     * @param {string} resourceId
     * @param {{sealed: string}} opts  the resource's CURRENT sealed body (from the pod/bucket).
     * @returns {{resourceId: string, sealed: string, rotated: true}}  the re-sealed body to persist.
     * @throws {Error} when the broker holds no CEK for the resource, or the body doesn't open under it.
     */
    rotateResource(resourceId, { sealed } = {}) {
      const key = keyring.get(resourceId);
      if (!key) throw new Error(`rotateResource: unknown resource "${resourceId}" (sealResource first)`);
      if (typeof sealed !== 'string' || !sealed) throw new Error('rotateResource: the current sealed body is required');
      const plaintext = openWithGroupKey(sealed, key);      // throws if the body isn't under the held CEK
      const fresh = generateGroupKey();
      keyring.set(resourceId, fresh);
      return { resourceId, sealed: sealWithGroupKey(plaintext, fresh), rotated: true };
    },

    /**
     * Issue a CapabilityToken granting READ of exactly one resource to `subject`.
     * @param {object} opts
     * @param {string} opts.subject     — recipient's identity pubkey (base64url); binds the grant.
     * @param {string} opts.resourceId  — the single resource this grant unlocks.
     * @param {number} [opts.expiresIn=3600000]
     * @returns {Promise<CapabilityToken>}
     */
    async issueGrant({ subject, resourceId, expiresIn } = {}) {
      if (!subject) throw new Error('issueGrant: subject (recipient pubkey) required');
      if (!keyring.has(resourceId)) throw new Error(`issueGrant: unknown resource "${resourceId}" (sealResource first)`);
      return CapabilityToken.issue(identity, {
        subject,
        agentId: identity.pubKey,
        skill:   resourceScope(resourceId),
        ...(expiresIn != null ? { expiresIn } : {}),
      });
    },

    /**
     * Release resource `resourceId`'s CEK to a holder presenting `token` — DENY-BY-DEFAULT.
     *
     * Passes ⟺ the token is: signed by & bound to THIS broker (agentId), unexpired, its subject equals the
     * requester, its scope covers THIS resource, not revoked, and any injected `checkGrant` returns true.
     * On pass the CEK is wrapped to `requesterSealPubKey` (recipient-mode envelope) so only the holder of
     * the matching sealing private key can unwrap it. On ANY failure returns `{ denied, reason }` — never a key.
     *
     * @param {object} opts
     * @param {CapabilityToken|object|string} opts.token
     * @param {string} opts.requesterPubKey       — caller's identity pubkey; MUST equal token.subject.
     * @param {string} opts.resourceId            — the resource whose key is requested.
     * @param {string} opts.requesterSealPubKey   — caller's X25519 SEALING pubkey (from generateKeypair) to
     *                                               receive the wrapped CEK.
     * @param {string} [opts.agent]                — ACP grant subject (grantee's WebID) when a `sharing` surface
     *                                               is injected; defaults to `requesterPubKey`.
     * @param {string} [opts.resourceUri]          — ACP target URI; defaults to `resourceUriFor(resourceId)`
     *                                               or the `resourceId` itself.
     * @param {import('../sharing/index.js').ShareMode[]} [opts.modes]  — override the construction-time modes.
     * @returns {Promise<{ wrappedKey: string, resourceId: string } | { denied: true, reason: string }>}
     */
    async releaseKey({ token, requesterPubKey, resourceId, requesterSealPubKey, agent, resourceUri, modes: callModes } = {}) {
      // ── Gate (deny-by-default) — the token gate is AUTHORITATIVE. Any failure denies here, BEFORE any key
      //    handover or ACP grant. An unexpected throw inside the gate also denies (never leak a key).
      const cek = await (async () => {
        try {
          if (!token)                return deny('no-token');
          if (!requesterPubKey)      return deny('no-requester');
          if (!requesterSealPubKey)  return deny('no-seal-pubkey');

          const k = keyring.get(resourceId);
          if (!k) return deny('unknown-resource');

          let parsed;
          try { parsed = token instanceof CapabilityToken ? token : CapabilityToken.fromJSON(token); }
          catch { return deny('malformed-token'); }

          // Signature + expiry + agent binding (only grants THIS broker issued verify).
          let ok;
          try { ok = CapabilityToken.verify(parsed, identity.pubKey); } catch { ok = false; }
          if (!ok) return deny('invalid-token');

          // Subject binding — the token may only be used by the peer it was issued to (no theft/forwarding).
          if (parsed.subject !== requesterPubKey) return deny('subject-mismatch');

          // Resource scope — per-resource isolation (item grain: exact via offeringMatches) OR container
          // coverage (list grain: `res.read:/list/<id>/` covers items at-or-below via the shared path rule).
          if (!scopeCovers(parsed.skill, resourceScope(resourceId))) return deny('wrong-scope');

          // Revocation.
          if (await isRevoked(parsed.id)) return deny('revoked');

          // Optional pod-side ACL seam (issuer trust-tier / pod ACL / rate limit).
          if (checkGrant) {
            let granted = false;
            try { granted = await checkGrant({ token: parsed, requesterPubKey, resourceId }); } catch { granted = false; }
            if (granted !== true) return deny('acl');
          }
          return k; // gate passed — hand back THIS resource's CEK
        } catch (err) {
          return deny('error', err);
        }
      })();
      if (cek && cek.denied) return cek; // gate denied → NO key handover, NO ACP grant (gate authoritative)

      // ── Happy path — wrap THIS resource's CEK to the requester's sealing pubkey.
      const wrappedKey = seal(cek, requesterSealPubKey);

      // ── Pod-side ACP reflection (defence in depth). Mirrors createCanonicalShare.share: pair the key
      //    handover with an ACP read-grant on THIS resource. A SHARING_GRANT_NOOP (a grant that landed nothing)
      //    THROWS out of here — we never report a key handover that the pod didn't actually authorize.
      if (sharing) {
        await sharing.grant({
          resourceUri: uriFor(resourceId, resourceUri),
          agent: agent || requesterPubKey,
          modes: callModes || modes,
        });
      }

      return { wrappedKey, resourceId };
    },

    /**
     * Revoke a previously-issued grant. Subsequent `releaseKey` with the token is denied (key custody).
     *
     * @param {string|object} arg
     *   • STRING — a token id: key-custody revocation only (back-compat; no ACP touched).
     *   • OBJECT `{ tokenId, resourceId?, resourceUri?, agent?, modes? }` — when a `sharing` surface is injected
     *     AND `agent` is supplied, ALSO calls `sharing.revoke(...)` so the pod denies the resource too. The
     *     key-custody revocation runs FIRST (fail-safe: the grantee is denied the key even if ACP throws); a
     *     SHARING_REVOKE_NOOP then PROPAGATES (a no-op ACP revoke is never mistaken for success).
     */
    async revoke(arg) {
      const { tokenId, resourceId, resourceUri, agent, modes: callModes } =
        typeof arg === 'string' ? { tokenId: arg } : (arg || {});

      // 1. KEY CUSTODY — mark the token revoked first, so the grantee can no longer obtain the CEK.
      if (tokenRegistry) await tokenRegistry.revoke(tokenId);
      else localRevoked.add(tokenId);

      // 2. ACP REVOKE — pod-side reflection. Only when a sharing surface is injected AND we know the subject.
      //    A no-op (SHARING_REVOKE_NOOP) throws and PROPAGATES — never swallowed.
      if (sharing && agent) {
        await sharing.revoke({
          resourceUri: uriFor(resourceId, resourceUri),
          agent,
          modes: callModes || modes,
        });
      }
    },
  };
}

function deny(reason, err) {
  const out = { denied: true, reason };
  if (err) out.message = err.message;
  return out;
}

/**
 * Reader-side helper: unwrap a granted CEK with the requester's sealing PRIVATE key, then open the sealed
 * body. Pure composition of `open` (recipient-mode CEK unwrap) + `openWithGroupKey` (body). Kept here so a
 * holder never has to know the two-step shape.
 *
 * @param {object} opts
 * @param {string} opts.wrappedKey       — `wrappedKey` from a successful `releaseKey`.
 * @param {string} opts.sealPrivateKey   — the requester's sealing PRIVATE key (matches requesterSealPubKey).
 * @param {string} opts.sealed           — the host-blind sealed body from `sealResource`.
 * @returns {string} the plaintext.
 */
export function openGrantedResource({ wrappedKey, sealPrivateKey, sealed }) {
  const cek = open(wrappedKey, sealPrivateKey);      // recipient-mode: only the matching private key opens
  return openWithGroupKey(sealed, cek);              // CEK opens the body
}
