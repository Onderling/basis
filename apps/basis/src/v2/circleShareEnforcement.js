/**
 * circleShareEnforcement — the PLATFORM-NEUTRAL assembly of a circle's cross-circle SHARE enforcement binder
 * . Both shells (web `circleApp.js`, mobile `circlePods.js`) resolve their platform
 * pod objects — the ACP `sharing` surface, the content seal `strategy`, the signed-in `podRoot`, the circle's
 * `controlAgent`, this device's per-circle `idKey` — and hand them here; this module composes the SAME
 * `makeCircleShareEnforcement` (+ best-effort `createCanonicalShare`) from them. Living once here is invariant
 * #1 (logic in shared src) / #2 (web≡mobile by construction): neither shell forks the assembly.
 *
 * It imports the substrate (`@onderling/item-store`, `@onderling/pod-client`, `@onderling/pod-onboarding`) but nothing
 * platform-specific (no DOM, no RN, no session objects) — those stay in the shells, which pass only plain deps.
 *
 * Returns the enforcement `{ onShare, onShareCanonical, revokeCanonical, onShareToPublishedKey, policy }` when the pod path is ACTIVE
 * (a signed-in `podRoot`, a real ACP `sharing` with grant+list, AND a resolved seal `strategy`); otherwise
 * null so the caller degrades to the in-memory `shared-ref` behaviour (no grant/seal/read-gate) — the additive
 * fallback both platforms share.
 */
import { makeCircleShareEnforcement } from '@onderling/item-store';
import { createCanonicalShare, assertScopedScheme, needsCopyToLeaveAudience } from '@onderling/pod-client';
import { makeResourceUriResolver, sharedRefResourceUri } from '@onderling/pod-onboarding/resourceUri';

/**
 * @param {object} deps
 * @param {{grant?:Function, list?:Function, revoke?:Function}} [deps.sharing]  the pod's ACP sharing surface
 *        (web: `prod.podClient.sharing`; mobile: the same). Requires grant+list to activate the pod path.
 * @param {{open?:Function}|null} [deps.strategy]  the circle's CONTENT seal/open strategy (p2/p3). null → no path.
 * @param {string} [deps.podRoot]  the signed-in real-pod root (the `resourceUriFor` base). Absent → null.
 * @param {{keyStore?:object, members?:Function}|null} [deps.controlAgent]  the circle's control agent — its
 *        group-key resource (`keyStore`) + live origin roster (`members()`) feed the canonical controller.
 * @param {{publicKey?:string, privateKey?:string}|null} [deps.idKey]  this device's per-circle sealing identity
 *        (already a group-key recipient) — the canonical controller key. Absent ⇒ no canonical hooks.
 * @param {(webid:string)=>(string|null|Promise<string|null>)} [deps.sealingKeyForRecipient]  resolve an
 *        OUT-OF-CIRCLE recipient's sealing public key from their WebID (the shells build it from the Contacten
 *        roster via `recipientSealingKeyResolver`). Lets a revoke evict exactly the named grantee instead of
 *        collaterally dropping the others. Absent ⇒ revoke stays conservative (roster-only rotation).
 * @returns {object|null}  the enforcement binder, or null when the pod path is inactive.
 */
export function buildCircleShareEnforcement({ sharing, strategy, podRoot, controlAgent, idKey, sealingKeyForRecipient } = {}) {
  if (!podRoot) return null;                                   // not signed in → memory path
  // Require BOTH a real ACP sharing surface AND a resolved seal strategy (p2/p3). p0/p1 or an unprovisioned
  // group key → null (decline the pod path rather than grant against plaintext).
  if (!sharing || typeof sharing.grant !== 'function' || typeof sharing.list !== 'function' || !strategy) {
    return null;
  }
  const resourceUriFor = sharedRefResourceUri(makeResourceUriResolver({ podUri: podRoot }));

  // objective L — the CANONICAL controller (share=grant/re-wrap, revoke=rotate), built best-effort from the
  // control agent's group-key resource + this device's sealing identity (already a recipient, so it can
  // unwrap-to-re-wrap on every grant). A circle whose control agent / sealing identity isn't resolvable simply
  // skips the canonical hooks (the copy/closed postures are unaffected).
  let canonicalShare;
  try {
    if (controlAgent?.keyStore && idKey?.publicKey && idKey?.privateKey && typeof sharing.revoke === 'function') {
      canonicalShare = createCanonicalShare({
        sharing,
        keyStore: controlAgent.keyStore,
        controllerKey: { publicKey: idKey.publicKey, privateKey: idKey.privateKey },
        resourceUriFor,
      });
    }
  } catch { canonicalShare = undefined; }

  // The live origin roster's sealing PUBLIC KEYS — re-wrapped to on every canonical grant so the origin
  // members never lose access (and seeded as `currentRecipients` on a published-key grant / rotated to on a
  // revoke). Best-effort: a control agent whose roster isn't resolvable yields an empty set.
  //
  // ROSTER-ONLY BY DESIGN — this is ALSO the revoke-side default for `remainingRecipients`, and a revokee is
  // named by WebID while this list is sealing keys. Widening it here would rotate the key back TO the very
  // recipient being revoked (a silent revocation failure). The grant-side widening lives in `grantRecipients`.
  const currentRecipients = () => {
    try { return (controlAgent?.members?.() ?? []).map((m) => m.publicKey).filter(Boolean); }
    catch { return []; }
  };

  // GRANT-side audience (grants-over-Peer step 2) — everyone who currently HOLDS this item's key:
  // the origin roster ∪ the group-key resource's own `recipients`, which includes out-of-circle recipients
  // granted EARLIER (who are, by definition, not in the roster).
  //
  // This fixes a real drop, verified against the real primitives: `grantMember` REPLACES the recipient set
  // with `[...currentRecipients, newRecipient]`, so passing the roster alone meant granting a SECOND
  // out-of-circle recipient silently revoked the FIRST (the earlier grantee could no longer unwrap the key).
  // The key resource is the durable record of who holds the key, so unioning it in is both the fix and the
  // honest source of truth — no extra bookkeeping to drift.
  //
  // Only the GRANT path uses this (see `grantRecipients` in makeCanonicalShareHook); revoke keeps the
  // conservative roster-only default above.
  const grantRecipients = async () => {
    const out = [];
    const seen = new Set();
    const add = (k) => { if (typeof k === 'string' && k && !seen.has(k)) { seen.add(k); out.push(k); } };
    for (const k of currentRecipients()) add(k);
    try {
      const cur = await controlAgent?.keyStore?.read?.();
      for (const k of (cur?.recipients ?? [])) add(k);
    } catch { /* no resource yet — the first grant bootstraps it */ }
    return out;
  };

  // ── REVOKE-side audience: evict EXACTLY the named party, nobody else ────────────────────────────────
  //
  // Rotating to the roster evicts the revokee — but also every unrelated OUT-OF-CIRCLE grantee, who is by
  // definition not in the roster (confirmed bug, story 1.2 in NOTE-multi-device-user-stories.md: revoke Bram
  // → Cato loses access too). The precise answer is "every current key-holder MINUS the revokee", which needs
  // the revokee's SEALING KEY — they are named by WebID, and the holder list is sealing keys.
  //
  // That mapping needs NO new bookkeeping; it is already derivable from two durable sources:
  //   • a circle MEMBER → the control agent's roster carries `{webId, publicKey}` directly.
  //   • an OUT-OF-CIRCLE grantee → their sealing key was DERIVED at grant time from their published Ed25519
  //     network key (`sealingPublicKeyFromNetworkKey`), a PURE deterministic map. Re-deriving it from the
  //     same contact reproduces exactly the key that was granted — hence the injected `sealingKeyForRecipient`
  //     (the shells build it from the Contacten roster; see `recipientSealingKeyResolver` in shareRecipients.js).
  const sealingKeyForWebid = async (webid) => {
    if (!webid) return null;
    try {
      for (const m of controlAgent?.members?.() ?? []) {
        if (m?.webId === webid && m.publicKey) return m.publicKey;
      }
    } catch { /* roster unresolvable — fall through */ }
    if (typeof sealingKeyForRecipient === 'function') {
      try { return (await sealingKeyForRecipient(webid)) || null; } catch { return null; }
    }
    return null;
  };

  // Current holders MINUS the revokee(s). FAIL-SAFE: if ANY revokee's key can't be resolved we cannot prove
  // they'd be excluded from the widened holder set, so we fall back to the conservative roster-only rotation —
  // which definitely evicts them (at the cost of also dropping other out-of-circle grantees, the old
  // behaviour). Never the other way round: a revoke must never leave the revoked party holding the key.
  const revokeRecipients = async (revokeeWebids = []) => {
    const who = Array.isArray(revokeeWebids) ? revokeeWebids.filter(Boolean) : [];
    if (who.length === 0) return currentRecipients();
    const drop = new Set();
    for (const webid of who) {
      const key = await sealingKeyForWebid(webid);
      if (!key) return currentRecipients();              // unresolvable → conservative, safe, lossy
      drop.add(key);
    }
    const holders = await grantRecipients();             // roster ∪ the key resource's own recipients
    return holders.filter((k) => !drop.has(k));
  };

  // The REMOVE-list companion to `revokeRecipients`: the exact sealing keys being evicted. Given to the
  // substrate, it prunes them from the LIVE key resource so a CONCURRENT grant survives (revoke-wins without
  // collaterally dropping it). Same resolution + same FAIL-SAFE: null when any revokee's key can't be
  // resolved, so the substrate falls back to the conservative roster-minus keep-list.
  const revokedKeysFor = async (revokeeWebids = []) => {
    const who = Array.isArray(revokeeWebids) ? revokeeWebids.filter(Boolean) : [];
    if (who.length === 0) return null;
    const drop = [];
    for (const webid of who) {
      const key = await sealingKeyForWebid(webid);
      if (!key) return null;                             // unresolvable → conservative keep-list path
      drop.push(key);
    }
    return drop;
  };

  // Enforcement `seal` is OMITTED on purpose: the cross-circle recipient re-seal (copy postures) is layered
  // ABOVE this binder in `shareItemAcrossCircles`. On read, `open: strategy.open` unseals a group-key source;
  // `composeReaderOpen` (in circleShare) adds the reader's own opener. `currentRecipients` re-wraps the group
  // key to the origin members PLUS the outside recipient on a canonical grant (never drops the origin members).
  const enforcement = makeCircleShareEnforcement({
    sharing, resourceUriFor, open: strategy.open,
    canonicalShare,
    currentRecipients,   // roster-only — the conservative fallback (must never include a revocable recipient)
    grantRecipients,     // roster ∪ current key-holders — so an earlier out-of-circle grantee isn't dropped
    revokeRecipients,    // current holders MINUS the named revokee(s) — evict exactly one, not the bystanders
    revokedKeysFor,      // the exact revoked keys — lets the substrate preserve a concurrent grant (revoke-wins)
  });

  // Phase 2 (objective L follow-up) — grant an OUT-OF-CIRCLE recipient (NOT in the origin roster) revocable
  // in-place access to a canonical item by their PUBLISHED Ed25519 network key (createCanonicalShare's
  // `shareToPublishedKey`: derive the sealing key from the published network key, re-wrap the group key to it +
  // ACP-grant read — the SAME wrap primitives, no new crypto). Guarded EXACTLY like `onShareCanonical`: present
  // ONLY when a canonical controller resolved (a control agent + this device's sealing identity). Absent ⇒ the
  // field is undefined and the app op degrades to the plain shared-ref write (the pre-L in-memory behaviour).
  //
  // NO separate revoke path: `enforcement.revokeCanonical` (rotate + ACP-revoke) already denies ANY WebID —
  // roster OR out-of-circle — by rotating the group key to the remaining recipients, so it IS the Phase-2
  // revoke. The origin roster is seeded as `currentRecipients` (default; a caller may override per-call).
  if (canonicalShare && typeof canonicalShare.shareToPublishedKey === 'function') {
    enforcement.onShareToPublishedKey = async ({ recipient, recipientNetworkKey, currentRecipients: roster, verify, ref, includeHistory = false } = {}) => {
      // D2, BOUND (batch 4) — an out-of-circle grant may only extend a SCOPED audience. The rule sat in
      // `assertScopedScheme` with nothing on this path calling it, so a group-key-sealed circle could
      // have its whole history handed to one outside grantee by a single grant. The strategy names the
      // scheme the content is actually sealed under; deny-by-default (absent/unknown throws too).
      // In-circle re-wraps (`onShareCanonical` / roster grants) are NOT audience extension and stay as
      // they are — this gate is exactly the out-of-circle door.
      assertScopedScheme(strategy?.scheme);
      // A GRANT — so the base is the widened one (roster ∪ current key-holders); an explicit per-call
      // `currentRecipients` still overrides. Roster-only here would drop earlier out-of-circle grantees.
      const cur = Array.isArray(roster) ? roster.filter(Boolean) : await grantRecipients();
      // `includeHistory` (default false) is threaded straight through — the op decides; the substrate re-wraps
      // the retained historic versions to the recipient only when explicitly opted in (see grantMember).
      return canonicalShare.shareToPublishedKey({ recipient, recipientNetworkKey, currentRecipients: cur, verify, ref, includeHistory });
    };
  }

  // D2 ROUTER (Frits 2026-08-06) — group-key content must LEAVE its audience as a re-sealed COPY, never an
  // in-place re-wrap (which hands the grantee the one key to the whole audience). Set ONLY for group-key: a
  // scoped scheme stays an in-place grant, and an absent/unknown scheme stays REFUSED by the throwing gate
  // (`assertScopedScheme`) — narrow on purpose so nothing but the group-key leak changes. The caller reads
  // this boolean to ROUTE to the copy path instead of catching a throw.
  enforcement.leaveAudienceNeedsCopy = needsCopyToLeaveAudience(strategy?.scheme);
  return enforcement;
}
