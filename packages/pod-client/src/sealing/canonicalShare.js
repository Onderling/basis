// canonicalShare.js — objective L: the REVOCABLE CANONICAL cross-circle share.
//
// The `canonical` sharePosture (alongside closed / copy / trusted / registered): expose a sealed item to a
// recipient OUTSIDE its origin circle WITHOUT copying it. The item stays CANONICAL in its origin circle —
// there is exactly one copy, in one place — and the recipient's access is a REVOCABLE KEY GRANT. The
// recipient reads the canonical resource (origin URI) IN PLACE through the shared-ref path.
//
// This is COMPOSITION, not new crypto. It reuses the same two substrates the household control-agent
// already stands on (controlAgent.js), but scoped to ONE resource and to OUTSIDE recipients rather than a
// whole container's membership:
//   • share  = grantMember(item's group-key resource, +recipient's sealing key)  [O(1) re-wrap, same version]
//              + sharing.grant({ resourceUri, agent, modes:['read'] })            [the ACP read grant]
//              ⇒ the recipient can unwrapGroupKey → openWithGroupKey the canonical item. NO copy is written
//                into the recipient circle.
//   • shareToPublishedKey (Phase 2) = the SAME grant, for a recipient OUTSIDE the origin circle whose sealing
//              key you do NOT hold from the roster. You source it from their PUBLISHED NETWORK IDENTITY (their
//              Ed25519 network public key) via `sealingPublicKeyFromNetworkKey` — the same ed2curve
//              Ed25519→Curve25519 map `AgentIdentity` already uses for nacl.box, wrapped into the envelope's
//              own X25519 SPKI DER. It is a KEY-SOURCING step, NOT a new cipher: the derived key flows through
//              the IDENTICAL grantMember/unwrapGroupKey/rotate primitives. The recipient opens in place by
//              deriving their sealing PRIVATE key from the same network identity (`sealingKeyPairFromNetworkKey`).
//   • revoke = drop the recipient from the roster,
//              rotateGroupKeyResource(new group key → the REMAINING recipients)   [forward secrecy, +version]
//              + sharing.revoke({ resourceUri, agent, modes:['read'] })           [ACP denies the resource]
//              ⇒ content sealed under the NEW group key can't be opened by the revoked recipient, and the
//                pod denies them the resource.
//
// The SHARING_GRANT_NOOP / SHARING_REVOKE_NOOP contract (sharing/index.js, hardened 2026-05-16) is
// respected transitively: `sharing.grant`/`sharing.revoke` THROW on a null/undefined SDK return (a no-op
// that changed nothing), so a share/revoke that didn't actually land propagates as a throw here — it is
// never mistaken for success. We do NOT swallow it.
//
// ── CAVEAT — the standard crypto-revocation limit (stated honestly) ─────────────────────────────────────
// Rotation revokes access to FUTURE content only: anything sealed under the NEW group key (re-sealed or
// newly written after the rotation) is unreadable to the revoked recipient. It CANNOT un-seal what the
// recipient already decrypted or cached before revocation — that plaintext is out of our hands. Revocation
// here means "no further access", not "un-see". A caller who needs the revoked recipient locked out of
// EXISTING content must RE-SEAL that content under the new group key after revoke (see `reseal` below).
//
// ── PHASE 3 — HISTORIC-KEY RETENTION (open across rotations) ─────────────────────────────────────────────
// Rotation now RETAINS the outgoing group-key version (groupKeyResource.js `history`), so a STILL-GRANTED
// recipient can open content sealed under an OLDER version they lived through — read the canonical item IN
// PLACE across rotations via `open(sealedText, readerPrivateKey)`. This does NOT weaken forward secrecy: each
// retained version's envelope only lets its OWN recipients unwrap its key, so a revoked recipient — absent
// from every post-revocation version — still cannot open content sealed after their removal. Retention only
// restores a current recipient's access to content that predates a rotation, never a revoked recipient's
// access to content that postdates their revocation. A freshly-granted OUT-OF-CIRCLE recipient still gets the
// CURRENT version only (grant carries history forward untouched) — never retroactive access to pre-grant
// history. Expanding that (grant historic versions) is a deliberate POLICY choice, not the default.

import { param, PARAM_SCOPE, PARAM_KIND } from '@onderling/core';
import {
  grantMember, rotateGroupKeyResource, buildGroupKeyResource, unwrapGroupKey,
  openSealedAcrossVersions,
} from './groupKeyResource.js';
import { generateGroupKey, sealWithGroupKey, sealingPublicKeyFromNetworkKey } from './envelope.js';

/**
 * Build a canonical-share controller for a single sealed resource. Pure orchestration — pod I/O is injected
 * exactly as `createControlAgent` injects it:
 *
 * @param {object} a
 * @param {{ grant: Function, revoke: Function }} a.sharing   the ACP surface (client.sharing) — grant/revoke
 *        already enforce the SHARING_GRANT_NOOP / SHARING_REVOKE_NOOP contract (a no-op throws).
 * @param {{ read: () => any, write: (res:any) => any }} a.keyStore  reads/writes the item's group-key
 *        resource on the pod (e.g. `/.keys/<item>-vN.json`).
 * @param {{ publicKey: string, privateKey: string }} a.controllerKey  the origin-side granter's keypair. It
 *        is always a recipient of the key resource, so it can unwrap-to-re-wrap on every grant/rotate.
 * @param {string} [a.resourceUri]  the canonical item's pod resource URI (the ACP target). May instead be
 *        supplied per-call, or derived via `resourceUriFor(ref)`.
 * @param {(ref:object)=>(string|null)} [a.resourceUriFor]  maps a shared-ref → the canonical resource URI.
 * @param {string} [a.mode='read']  the ACP mode granted/revoked (canonical sharing is read-only by design).
 */
/**
 * One promise-chain per KEY STORE, so every controller writing the same group-key resource in this process
 * takes the grant critical section in turn. A chain is enough: each call waits for the previous to settle
 * before it reads, so no two grants compute from the same stale base. Errors are contained, so one failed
 * grant cannot wedge the queue. Cross-DEVICE races still need a store that can compare-and-swap
 * (`keyStore.writeIfUnchanged`) — see the note in the grant core.
 */
const _grantChains = new WeakMap();
function _serializerFor(keyStore) {
  return (fn) => {
    const prev = _grantChains.get(keyStore) ?? Promise.resolve();
    const run = prev.then(fn, fn);
    _grantChains.set(keyStore, run.then(() => undefined, () => undefined));
    return run;
  };
}

/** Bounded optimistic-concurrency retries for a grant (story 1.5); a grant is a pure union, so retrying is safe. */
// Parameter register (#36) — bounded optimistic-concurrency grant retries (scope:device, kind:internal).
const MAX_GRANT_ATTEMPTS = param({ key: 'podClient.grantAttempts', scope: PARAM_SCOPE.DEVICE, kind: PARAM_KIND.INTERNAL, default: 4 });

export function createCanonicalShare({ sharing, keyStore, controllerKey, resourceUri, resourceUriFor, mode = 'read' } = {}) {
  if (!sharing || typeof sharing.grant !== 'function' || typeof sharing.revoke !== 'function') {
    throw new Error('createCanonicalShare: sharing with grant/revoke required');
  }
  if (!keyStore || typeof keyStore.read !== 'function' || typeof keyStore.write !== 'function') {
    throw new Error('createCanonicalShare: keyStore with read/write required');
  }
  if (!controllerKey || !controllerKey.publicKey || !controllerKey.privateKey) {
    throw new Error('createCanonicalShare: controllerKey { publicKey, privateKey } required');
  }
  const withController = (pubs) => [...new Set([...pubs.filter(Boolean), controllerKey.publicKey])];

  function uriFor(ref) {
    const uri = resourceUri
      || (typeof resourceUriFor === 'function' ? resourceUriFor(ref) : null)
      || (ref && ref.sourceCircle && ref.sourceId ? `${ref.sourceCircle}/${ref.sourceId}` : null);
    if (!uri) throw new Error('createCanonicalShare: no canonical resource URI (pass resourceUri / resourceUriFor / a shared-ref)');
    return uri;
  }

    /**
     * The grant CORE, shared by `share` (roster key) and `shareToPublishedKey` (network-derived key). Given a
     * recipient's SEALING public key, wrap the group key to it (O(1) re-wrap at the same version, or bootstrap
     * the first resource) + ACP-grant read on the canonical resource. Not exposed — callers use the two
     * fronts below so the *source* of the sealing key stays explicit.
     */
  // Serialise the grant critical section (read → modify → write) within this process, keyed on the KEY STORE
  // rather than on this controller — two admins acting on one circle are two `createCanonicalShare`
  // instances over the SAME store, so an instance-local queue would not serialise them against each other.
  const _serialize = _serializerFor(keyStore);

  const _grantSealingKey = async ({ recipient, recipientKey, currentRecipients, uri, includeHistory = false }) => {
      // 1. KEY GRANT — add the recipient's sealing key to the item's group-key resource. O(1) re-wrap of the
      //    SAME key at the SAME version (grantMember), or bootstrap the first resource if none exists yet.
      //    `includeHistory` (default false) ALSO re-wraps the retained historic versions to the recipient
      //    (grantMember's `extra` envelopes) — an EXPLICIT opt-in; the default gives the current version only.
      //
      //    CONCURRENCY (story 1.5). This is a read → modify → write on ONE resource, so two admins granting
      //    in the same window both computed from a base that predated the other and the second write silently
      //    dropped the first grantee. Guarded here by OPTIMISTIC CONCURRENCY, using the resource itself as
      //    the version — no backend support required:
      //      • re-read immediately before writing; if the stored recipient set changed under us, recompute the
      //        grant on top of the LATEST resource (which unions in whoever landed meanwhile) and retry;
      //      • a store that CAN do a real compare-and-swap may expose `writeIfUnchanged(next, prev)` returning
      //        false on conflict — it is used when present, closing the window entirely.
      //    A grant only ever ADDS a recipient and keeps the same group key at the same version, so recomputing
      //    on the newest base is a pure union: no grant can be lost by retrying.
      const compute = (base) => (base
        ? grantMember(base, {
            newRecipient: recipientKey,
            granterPrivateKey: controllerKey.privateKey,
            // Union from the AUTHORITATIVE stored resource (`base.recipients`) ONLY — never the caller's
            // `currentRecipients` snapshot. The stored set is the current truth: a concurrent grantee that
            // landed is carried forward by re-reading it here (the serializer + CAS guarantee we read the
            // latest), while a subject a concurrent REVOKE just rotated out is NOT re-introduced by a stale
            // caller snapshot — this is what makes revoke win over a racing grant. `currentRecipients` seeds
            // only the FIRST resource (the bootstrap branch below), where there is no base to be authoritative.
            currentRecipients: withController(base.recipients ?? []),
            includeHistory,
          })
        : buildGroupKeyResource({
            version: 1,
            groupKey: generateGroupKey(),
            recipients: withController([...currentRecipients, recipientKey]),
          }));

      // The read → modify → write must be ATOMIC. Re-reading before writing is not enough: two callers can
      // both re-read before either writes (TOCTOU), which is exactly how the bug reproduced. So the section
      // is serialised through a per-controller queue — correct for concurrent grants in THIS process — and,
      // when the store can do a real compare-and-swap (`writeIfUnchanged`), that closes the CROSS-DEVICE
      // window too. Without such a store, simultaneous grants from two DEVICES remain racy; the union in
      // `compute` still limits the damage (each write carries forward whoever it can see).
      const next = await _serialize(async () => {
        for (let attempt = 0; attempt < MAX_GRANT_ATTEMPTS; attempt += 1) {
          const cur = await keyStore.read();
          const candidate = compute(cur);
          if (typeof keyStore.writeIfUnchanged === 'function') {
            const wrote = await keyStore.writeIfUnchanged(candidate, cur);
            if (wrote !== false) return candidate;
            continue;                                                   // another writer won — recompute
          }
          await keyStore.write(candidate);
          return candidate;
        }
        // Exhausted CAS retries: recompute once more on the newest base so the grant is never simply dropped.
        const latest = compute(await keyStore.read());
        await keyStore.write(latest);
        return latest;
      });

      // 2. ACP READ GRANT on the canonical resource. Throws SHARING_GRANT_NOOP if nothing landed — we let it
      //    propagate so a share that didn't actually grant is never reported as success.
      await sharing.grant({ resourceUri: uri, agent: recipient, modes: [mode] });

      return { keyResource: next, resourceUri: uri, recipientKey };
    };

  return {
    /**
     * SHARE — grant an OUTSIDE recipient revocable access to the canonical item, IN PLACE (no copy), using a
     * sealing public key you ALREADY hold (e.g. from the origin circle roster).
     *
     * @param {object} p
     * @param {string} p.recipient        the recipient's WebID (the ACP grant subject).
     * @param {string} p.recipientKey     the recipient's SEALING public key (added to the group-key resource).
     * @param {string[]} [p.currentRecipients]  the roster's other sealing public keys (origin members already
     *        holding the key). The controller is always included automatically.
     * @param {object} [p.ref]            a shared-ref, if the URI is derived from it.
     * @returns {Promise<{keyResource:object, resourceUri:string}>}
     */
    async share({ recipient, recipientKey, currentRecipients = [], includeHistory = false, ref } = {}) {
      if (!recipient) throw new Error('canonicalShare.share: recipient WebID required');
      if (!recipientKey) throw new Error('canonicalShare.share: recipient sealing public key required');
      return _grantSealingKey({ recipient, recipientKey, currentRecipients, uri: uriFor(ref), includeHistory });
    },

    /**
     * SHARE TO PUBLISHED KEY (Phase 2) — grant a recipient OUTSIDE the origin circle, one whose sealing key
     * you do NOT hold from the roster. You source it from their PUBLISHED NETWORK IDENTITY: their Ed25519
     * network public key (as `AgentIdentity.pubKey` publishes it). This derives the matching X25519 SEALING
     * public key (`sealingPublicKeyFromNetworkKey` — the same ed2curve map `AgentIdentity` uses for nacl.box,
     * NO new cipher) and grants to it exactly like `share`. The recipient opens IN PLACE by deriving their
     * sealing PRIVATE key from the same network identity (`sealingKeyPairFromNetworkKey`).
     *
     * OPTIONAL minimal handshake (`verify`): before granting, the caller can assert the published key is the
     * one they mean to grant to (e.g. matched against a QR/contact-card fingerprint). `verify(networkKey)`
     * returning `false` (or throwing) ABORTS the grant — nothing is written, nothing is ACP-granted. A full
     * contact-exchange/attestation handshake is Phase-3 follow-up; this is the minimal guard hook.
     *
     * @param {object} p
     * @param {string} p.recipient              the recipient's WebID (the ACP grant subject).
     * @param {string} p.recipientNetworkKey    the recipient's PUBLISHED Ed25519 network public key (b64url).
     * @param {string[]} [p.currentRecipients]  the origin members' sealing public keys (kept; controller auto-added).
     * @param {(networkKey:string)=>boolean} [p.verify]  optional guard — must return truthy to proceed.
     * @param {object} [p.ref]
     * @returns {Promise<{keyResource:object, resourceUri:string, recipientKey:string}>}  `recipientKey` is the
     *          derived sealing public key (so the caller can track/revoke this out-of-circle recipient later).
     */
    async shareToPublishedKey({ recipient, recipientNetworkKey, currentRecipients = [], includeHistory = false, verify, ref } = {}) {
      if (!recipient) throw new Error('canonicalShare.shareToPublishedKey: recipient WebID required');
      if (!recipientNetworkKey) throw new Error('canonicalShare.shareToPublishedKey: recipient published network key required');
      if (typeof verify === 'function' && !verify(recipientNetworkKey)) {
        throw new Error('canonicalShare.shareToPublishedKey: published network key failed verification — grant aborted');
      }
      // SOURCE the sealing key from the published network identity. Throws on a malformed / non-Ed25519 key,
      // so a bad published key is refused before anything is written or granted.
      const recipientKey = sealingPublicKeyFromNetworkKey(recipientNetworkKey);
      return _grantSealingKey({ recipient, recipientKey, currentRecipients, uri: uriFor(ref), includeHistory });
    },

    /**
     * REVOKE — deny an outside recipient future access. Rotate the group key to the REMAINING recipients and
     * ACP-revoke the resource. Post-revocation the recipient can open neither the new group key nor the
     * resource; a still-granted recipient is unaffected.
     *
     * @param {object} p
     * @param {string} p.recipient           the recipient's WebID (the ACP revoke subject).
     * @param {string[]} [p.remainingRecipients]  the sealing public keys that KEEP access (the roster minus
     *        the revoked recipient). The controller is always kept.
     * @param {object} [p.ref]
     * @returns {Promise<{keyResource:object, resourceUri:string}>}
     */
    async revoke({ recipient, revokedKeys, remainingRecipients = [], ref } = {}) {
      if (!recipient) throw new Error('canonicalShare.revoke: recipient WebID required');
      const uri = uriFor(ref);
      // The REMOVE-list — the sealing keys to prune. Given it, we rotate to the LIVE resource MINUS these,
      // so a concurrent grant that landed after this revoke's read SURVIVES (it stays in the live set) while
      // the revoked recipient is pruned. Without it we fall back to the caller's static keep-list (which
      // still locks the revoked recipient out, but cannot preserve a concurrent grant it never saw).
      const revoked = new Set(
        (Array.isArray(revokedKeys) ? revokedKeys : (revokedKeys ? [revokedKeys] : [])).filter(Boolean),
      );
      const rotateRecipients = (cur) => (revoked.size > 0
        ? withController((cur?.recipients ?? []).filter((k) => !revoked.has(k)))
        : withController(remainingRecipients));

      // 1. ROTATE — a fresh group key + new version, sealed ONLY to the remaining recipients (+controller).
      //    The revoked recipient is absent from the new resource ⇒ unwrapGroupKey throws for them, so content
      //    under the new key is unreadable to them (forward secrecy). Remaining recipients get the new key.
      //
      //    REVOKE-WINS (story 1.5, grant∥revoke). The rotate runs in the SAME serialized-CAS critical section
      //    as grants, so a grant and a revoke on this key store are ORDERED in-process, never interleaved, and
      //    a real compare-and-swap (`writeIfUnchanged`) closes the cross-device window. The new version is
      //    sealed to the caller's remaining set (which excludes the revoked recipient), so the revoked
      //    recipient is absent from it whatever a concurrent grant did — a grant cannot keep them in, and the
      //    grant core (above) cannot re-add them afterwards (it unions from the authoritative base, not a stale
      //    snapshot). ⚠ TRADEOFF (safety over liveness): a grant that landed AFTER this revoke's read is not
      //    carried into the rotation — that grantee must re-grant. The guarantee kept is that the REVOKED
      //    recipient is out; a concurrent grant losing to a revoke is a liveness cost, not a safety hole.
      const next = await _serialize(async () => {
        for (let attempt = 0; attempt < MAX_GRANT_ATTEMPTS; attempt += 1) {
          const cur = await keyStore.read();
          const candidate = rotateGroupKeyResource({
            previous: cur,
            recipients: rotateRecipients(cur),
          });
          if (typeof keyStore.writeIfUnchanged === 'function') {
            const wrote = await keyStore.writeIfUnchanged(candidate, cur);
            if (wrote !== false) return candidate;
            continue;                                                   // a concurrent write won — re-rotate
          }
          await keyStore.write(candidate);
          return candidate;
        }
        const cur = await keyStore.read();
        const latest = rotateGroupKeyResource({
          previous: cur,
          recipients: rotateRecipients(cur),
        });
        await keyStore.write(latest);
        return latest;
      });

      // 2. ACP REVOKE. Throws SHARING_REVOKE_NOOP on a null SDK return (a revoke that changed nothing) — we
      //    let it propagate so a no-op revoke surfaces instead of silently "succeeding".
      await sharing.revoke({ resourceUri: uri, agent: recipient, modes: [mode] });

      return { keyResource: next, resourceUri: uri };
    },

    /**
     * RE-SEAL existing content under the CURRENT group key. Optional companion to `revoke`: rotation alone
     * only locks the revoked recipient out of FUTURE content; to also deny them content that already exists,
     * re-seal it under the post-rotation key. The revoked recipient — absent from the new key resource —
     * then cannot open the re-sealed text either. (It still can't un-see anything they cached beforehand.)
     *
     * @param {string} plaintext   the already-opened content to re-seal under the current group key.
     * @param {string} [granterPrivateKey]  a current recipient's private key (defaults to the controller's).
     * @returns {Promise<string>}  the content sealed under the current group key.
     */
    async reseal(plaintext, granterPrivateKey = controllerKey.privateKey) {
      const cur = await keyStore.read();
      if (!cur) throw new Error('canonicalShare.reseal: no group-key resource to re-seal under');
      const groupKey = unwrapGroupKey(cur, granterPrivateKey);
      return sealWithGroupKey(plaintext, groupKey);
    },

    /**
     * OPEN — read the canonical item IN PLACE across key rotations (Phase 3). Given a recipient's private key,
     * resolve the group-key VERSION the content was sealed under from the resource's retained history and
     * open it — so a still-granted recipient opens BOTH pre- and post-rotation content, while a REVOKED
     * recipient (absent from every post-revocation version) cannot open content sealed after their removal
     * (forward secrecy). Version resolution is by authenticated trial (see `openSealedAcrossVersions`); the
     * content itself carries no version tag, so nothing about the sealed item changed. Non-sealed text passes
     * through unchanged.
     *
     * @param {string} sealedText        the group-key-sealed canonical item body.
     * @param {string} readerPrivateKey  the reader's sealing private key (roster key or network-derived).
     * @returns {Promise<string>}        the plaintext, or throws if the reader holds no version that opens it.
     */
    async open(sealedText, readerPrivateKey) {
      if (!readerPrivateKey) throw new Error('canonicalShare.open: reader private key required');
      const cur = await keyStore.read();
      if (!cur) throw new Error('canonicalShare.open: no group-key resource for this item');
      return openSealedAcrossVersions(sealedText, cur, readerPrivateKey);
    },
  };
}
