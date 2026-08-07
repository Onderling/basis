/**
 * circleShare — the app-level cross-circle SHARE op (· the vertical slice that WIRES the merged
 * item-store substrate into a live, invocable operation). Pure + injectable so web≡mobile share this one
 * implementation and it's testable at the substrate seam (no DOM, no live pod).
 *
 * It threads three substrate seams and NOTHING platform-specific:
 *   • shareIntoAudience(stores, { …, onShare }) — writes the per-item `shared-ref` into the TARGET circle
 *     and, on a pod-active source, lands the ACP read-grant (+ optional re-seal) via the injected onShare.
 *   • resolveSharedRef(stores, ref, { policy, recipient }) — DENY-BY-DEFAULT cross-circle read: a
 *     non-recipient (or an unopenable envelope) resolves to null, so ciphertext/plaintext never leaks.
 *   • listShared(stores, circleId) — the target circle's `shared-ref`s (its surfacing list).
 *
 * The `{ onShare, policy }` binder (makeCircleShareEnforcement) is built at the app's POD site and injected
 * here as `enforcementFor(circleId) → { onShare, policy } | null`. Absent (no pod session / no sealing
 * strategy) it returns null and the whole op degrades to the in-memory `shared-ref` behaviour — byte-for-byte
 * the pre-K path (no grant, no seal, no read gate).
 *
 * Per-circle stores: each circle's lists service owns its OWN DataSource / seal strategy, so a circle's
 * `shared-ref` bookkeeping and its source-item read must go through THAT circle's store — the ref lands
 * sealed for the target's readers, and the source item opens with the source's strategy. We compose a tiny
 * SYNCHRONOUS `{ getStore }` facade over the pre-resolved per-circle stores — exactly the shape
 * shareIntoAudience / resolveSharedRef expect (they call getStore(circleId) synchronously).
 */
import { shareIntoAudience, resolveSharedRef, listShared, unsealItem, isCanonicalPosture, shareContainerTree } from '@onderling/item-store';
import { normalizeCirclePolicy } from './circlePolicy.js';

/**
 * The storage postures that PROMISE client-side sealing (`circlePolicy.storagePosture`). p0 (trusted host)
 * and p1 (TEE) promise no client-side seal, so the in-memory / no-pod path is their honest behaviour.
 */
const SEALING_POSTURES = new Set(['p2', 'p3']);

/**
 * Would this share silently break the circle's own posture promise?
 *
 * The pod-tier `enforcement` is what performs the seal + the ACP grant; `buildCircleShareEnforcement` returns
 * NULL whenever there is no podRoot — which is exactly what a device looks like after the person signs out of
 * their pod mid-flow. Without this check the share still succeeds: `shareOneResolved` passes
 * `enforcement?.onShare*` (undefined), `shareIntoAudience` writes a PLAIN `shared-ref`, and the caller is told
 * `{ok:true}` — indistinguishable from a sealed, granted share (story 7.3).
 *
 * The refusal is scoped to circles that actually made the promise. A p0/p1 circle — including the DEFAULT,
 * `p0` — is unaffected, so the deliberate no-pod/in-memory mode keeps working exactly as before.
 *
 * @param {object} policy       the normalized SOURCE circle policy
 * @param {object|null} enforcement  the pod-tier binder (null ⇒ no pod session)
 * @returns {boolean}
 */
function sealPromiseUnmet(policy, enforcement) {
  return SEALING_POSTURES.has(policy?.storagePosture) && !enforcement;
}

/**
 * The locale key that EXPLAINS a share failure, for the one place a user meets it.
 *
 * Every share op returns a machine code (`seal-unavailable`, `sharing-closed`, …) and both shells used to
 * interpolate that code raw into "Share failed: {error}." — so a refusal read as `Share failed:
 * seal-unavailable.`, which tells someone nothing about what to do next. Each known code now has a full
 * sentence; an unknown code still falls back to the old generic template, so a new error can never render
 * as a missing string.
 *
 * @param {string} code  the `error` field of a failed share result
 * @returns {string} a locale key — a complete sentence for known codes, the generic template otherwise
 */
export function shareErrorStatusKey(code) {
  const known = new Set([
    'seal-unavailable', 'sharing-closed', 'sharing-admin-only', 'share-prohibited',
    'posture-floor', 'no-stores', 'same-circle', 'missing-args', 'not-canonical',
  ]);
  return known.has(code) ? `circle.share.error.${String(code).replace(/-/g, '_')}` : 'circle.share.failed';
}

/**
 * Which share postures ride the COPY re-seal mechanism (a SEPARATE object sealed to the recipient(s), source
 * untouched). Decision "option 2": `trusted` and `registered` currently share the SAME copy mechanism as
 * `copy` — the only difference between the three is WHO MAY INITIATE (the slice-2 initiator gate), which is
 * already enforced above. The `canonical` posture (objective L) is the COMPLEMENT: it re-wraps the source in
 * place, revocably, WITHOUT minting a copy — it rides `enforcement.onShareCanonical` (createCanonicalShare),
 * NOT this copy path (see the canonical branch in shareItemAcrossCircles + isCanonicalPosture).
 */
export const usesCopyReseal = (p) => p === 'copy' || p === 'trusted' || p === 'registered';

/**
 * compose a source-circle enforcement `policy` with the READER's OWN opener so a cross-circle
 * recipient can decrypt content re-sealed to THEIR key. Copy mode wraps the content to the recipient's
 * TARGET-circle sealing key, so the reader opens with their target-circle private key (`readerOpen`); a
 * group-key (p2) source still opens with the source enforcement's own opener (`policy.openText`).
 *
 * Combined at the PER-TEXT level (deny-by-default, leak-safe): plaintext passes straight through; a sealed
 * field is opened by whichever key fits — the reader's (`readerOpen`) or the source group's (`openText`).
 * A recipient opener passes plaintext through and THROWS on a foreign envelope (it never returns ciphertext),
 * so if NEITHER key opens a sealed field the combined opener throws ⇒ `resolveSharedRef` drops the ref.
 * `checkGrant` is untouched.
 *
 * @param {{checkGrant?:Function, open?:Function, openText?:Function}|null} policy  the source-circle policy
 * @param {(text:string)=>string|Promise<string>} [readerOpen]  the reader's per-text opener (their key)
 */
export function composeReaderOpen(policy, readerOpen) {
  if (typeof readerOpen !== 'function') return policy ?? undefined;
  const groupOpenText = typeof policy?.openText === 'function' ? policy.openText : null;
  const perTextOpen = async (text) => {
    if (typeof text !== 'string') return text;
    // The reader's own key first (copy-mode content sealed to them). A recipient opener returns plaintext
    // unchanged and throws on a foreign envelope — so a success here is either plaintext or MY decrypt.
    try { return await readerOpen(text); } catch { /* not mine — try the source group opener */ }
    if (groupOpenText) return groupOpenText(text);   // group source: decrypts, or throws on a foreign envelope
    throw new Error('composeReaderOpen: not a recipient of this sealed field');
  };
  return {
    ...(policy || {}),
    open: (item) => unsealItem(item, perTextOpen),
  };
}

/**
 * A synchronous `{ getStore(circleId) }` registry over already-resolved per-circle stores. The substrate
 * calls getStore synchronously; the async per-circle service resolution (pod vs memory) is done by the
 * caller BEFORE composing this facade.
 *
 * @param {Map<string, object>|Record<string, object>} storeByCircle  circleId → its CircleItemStore
 */
export function makeCrossCircleStores(storeByCircle) {
  const map = storeByCircle instanceof Map
    ? storeByCircle
    : new Map(Object.entries(storeByCircle || {}));
  return {
    getStore(circleId) {
      const s = map.get(circleId);
      if (!s) throw new Error(`makeCrossCircleStores: no resolved store for circle "${circleId}"`);
      return s;
    },
  };
}

/**
 * Share ONE item from a source circle into a target circle's audience.
 *
 * @param {object} args
 * @param {(circleId:string)=>Promise<{stores:{getStore:Function}}|null>} args.resolveService  resolve a
 *        circle's lists service (its `.stores` is a createCircleStores registry). Sealed-pod when active,
 *        else the memory/IDB default.
 * @param {string} args.itemId
 * @param {string} args.fromCircleId
 * @param {string} args.toCircleId
 * @param {string} [args.by]
 * @param {string} [args.recipient]           single recipient WebID (pod grant target)
 * @param {string[]} [args.recipients]        multiple recipient WebIDs (a circle share → its members)
 * @param {string[]} [args.recipientKeys] share-policy — the recipients' SEALING PUBLIC KEYS,
 *        resolved by the caller against the TARGET circle's roster (`recipientSealKeyFor(toCircleId,…)`).
 *        Threaded to the write-side re-seal so a cross-circle recipient (NOT in the source's group key) can
 *        decrypt. Absent ⇒ no re-seal (group-key posture / plaintext source).
 * @param {(item:object, keys:string[])=>(object|Promise<object>)} [args.sealCopy] share-policy
 *        an injected recipient re-sealer (built from `@onderling/pod-client` `recipientStrategy` + item-store's
 *        `sealItem`; pod-layer, so this module stays pod-client-free). Used by the copy-reseal postures
 *        (`copy`/`trusted`/`registered` — see usesCopyReseal) to produce a SEPARATE object sealed to the
 *        recipient(s), leaving the source untouched.
 * @param {(circleId:string)=>Promise<{onShare?:Function, policy?:object}|null>} [args.enforcementFor]
 *        the pod-tier binder for a circle (built at the pod site). Null ⇒ memory path (no grant/seal).
 * @param {(circleId:string)=>number} [args.postureOf]  target confidentiality (the posture-floor check).
 * @param {(circleId:string)=>(object|Promise<object>)} [args.policyOf]  the SOURCE circle's admin policy
 *        lookup (its `sharePosture` + `admins`). Injected so the caller wires the real per-circle policy;
 *        normalized via normalizeCirclePolicy. Missing/unreadable ⇒ default `'closed'` (deny-by-default).
 * @returns {Promise<{ok:true, ref:object}|{ok:false, error:string, cause?:any}>}
 */
export async function shareItemAcrossCircles({
  resolveService, itemId, fromCircleId, toCircleId, by,
  recipient, recipients, recipientKeys, sealCopy, enforcementFor, postureOf, policyOf,
} = {}) {
  if (typeof resolveService !== 'function' || !itemId || !fromCircleId || !toCircleId) {
    return { ok: false, error: 'missing-args' };
  }
  if (fromCircleId === toCircleId) return { ok: false, error: 'same-circle' };

  // INITIATOR GATE by the SOURCE circle's sharePosture (crypto-free; the write/read mechanics below
  // are unchanged when the gate passes). Missing/unreadable policy ⇒ normalizeCirclePolicy → default 'closed'
  // (deny-by-default, consistent with).
  let srcPolicy;
  try { srcPolicy = typeof policyOf === 'function' ? await policyOf(fromCircleId) : undefined; }
  catch { srcPolicy = undefined; }
  const policy = normalizeCirclePolicy(srcPolicy);
  const posture = policy.sharePosture;
  if (posture === 'closed') return { ok: false, error: 'sharing-closed' };
  if (posture === 'registered' && !policy.admins.includes(by)) {
    return { ok: false, error: 'sharing-admin-only' };
  }
  // 'copy' / 'trusted' ⇒ any member may initiate → proceed. All three of copy/trusted/registered then ride the
  // SAME copy re-seal mechanism below (usesCopyReseal); the posture only decided WHO could initiate.

  const [fromSvc, toSvc] = await Promise.all([resolveService(fromCircleId), resolveService(toCircleId)]);
  if (!fromSvc?.stores || !toSvc?.stores) return { ok: false, error: 'no-stores' };

  const stores = makeCrossCircleStores(new Map([
    [fromCircleId, fromSvc.stores.getStore(fromCircleId)],
    [toCircleId,   toSvc.stores.getStore(toCircleId)],
  ]));

  // Pod-active source? build the WRITE-side onShare (ACP grant + optional re-seal) for the SOURCE item's pod.
  // Null ⇒ memory path: shareIntoAudience just writes the ref (unchanged behaviour).
  const enforcement = typeof enforcementFor === 'function' ? await enforcementFor(fromCircleId) : null;
  // A circle that promised sealing (p2/p3) must not fall through to the plaintext write when the pod session
  // is gone — refuse LOUDLY instead of reporting a success that did not seal or grant anything (story 7.3).
  if (sealPromiseUnmet(policy, enforcement)) {
    return { ok: false, error: 'seal-unavailable', posture: policy.storagePosture };
  }

  return shareOneResolved({
    stores, itemId, fromCircleId, toCircleId, by, posture,
    recipient, recipients, recipientKeys, sealCopy, enforcement, postureOf,
  });
}

/**
 * The per-item WRITE path, factored so BOTH the single-item op (shareItemAcrossCircles) and the SENDABLE-LIST
 * op (shareContainerAcrossCircles) fan EXACTLY the same three-branch mechanic over PRE-RESOLVED stores +
 * enforcement + the source posture (already gated). No policy/resolve here — the caller gated + resolved once.
 *
 *   • CANONICAL → in-place revocable grant (no copy); the pod-tier `onShareCanonical` re-wraps + ACP-grants.
 *   • COPY re-seal (copy/trusted/registered, when pod+sealer+keys present) → a SEPARATE sealed object shared.
 *   • Fallback → plain `shared-ref` (memory path) or in-place re-seal via the enforcement's `onShare`.
 *
 * @returns {Promise<{ok:true, ref:object}|{ok:false, error:string, cause?:any}>}
 */
async function shareOneResolved({
  stores, itemId, fromCircleId, toCircleId, by, posture,
  recipient, recipients, recipientKeys, sealCopy, enforcement, postureOf,
}) {
  const keys = Array.isArray(recipientKeys) ? recipientKeys.filter(Boolean) : [];

  // CANONICAL (objective L) — share the item IN PLACE, revocably, with NO copy. `usesCopyReseal` is false for
  // this posture, so it never rides the copy branch below; instead `shareIntoAudience` writes ONLY the
  // `shared-ref` pointer and the pod-tier `onShareCanonical` hook GRANTS the recipient(s) into the source
  // item's group-key resource (createCanonicalShare.share: key re-wrap + ACP read grant). The recipient then
  // opens the CANONICAL resource in place — never a duplicated item (no `sharedCopyOf`). Absent a canonical
  // enforcement (memory path / no pod / not signed in), it degrades to the plain `shared-ref` write — the
  // pre-L in-memory behaviour, byte-for-byte (no grant).
  // D2 ROUTER (Frits 2026-08-06): group-key content may NOT re-wrap its key to another circle IN PLACE — a
  // cross-circle share of it leaves as a re-sealed COPY (the copy branch below), the SAME procedure as an
  // out-of-circle person share. `leaveAudienceNeedsCopy` is set only on the pod path when the scheme is
  // group-key / sealed-forward / absent; false for a scoped scheme, and undefined on the memory path (no
  // enforcement → the plain-ref canonical branch below runs unchanged). A SAME-circle member-add is a
  // different flow (grantMember/join) and never reaches here — only cross-circle shares do.
  const mustCopy = !!enforcement?.leaveAudienceNeedsCopy;

  if (isCanonicalPosture(posture) && !mustCopy) {
    return shareIntoAudience(stores, {
      itemId, fromCircleId, toCircleId, by, recipient, recipients, recipientKeys: keys, postureOf,
      onShare: enforcement?.onShareCanonical,   // grant IN PLACE; undefined on the memory path → plain ref write
    });
  }

  // COPY re-seal: write a SEPARATE object sealed to the recipient(s), source UNTOUCHED, and share THAT copy
  // (the shared-ref points at the copy; the ACP grant lands on the copy). Cleanest re-seal — works for ANY
  // source posture (the source item is read through its own store, opened at rest, then re-sealed fresh to the
  // recipients' keys), and never locks the source's own members out of the canonical item.
  //
  // Decision "option 2": `copy`, `trusted`, AND `registered` all ride this ONE mechanism (usesCopyReseal). The
  // three postures differ ONLY in who may initiate (the slice-2 gate above: `closed` refuses, `registered`
  // admin-only, `copy`/`trusted` any member); the re-seal mechanism is now shared. The revocable in-place
  // *canonical* posture is handled ABOVE (its own branch — no copy); see isCanonicalPosture.
  if ((usesCopyReseal(posture) || mustCopy) && enforcement?.onShare && typeof sealCopy === 'function' && keys.length) {
    const fromStore = stores.getStore(fromCircleId);
    const srcItem = await fromStore.get(itemId);
    if (!srcItem) return { ok: false, error: 'item-not-found' };
    let copy;
    try {
      const sealed = await sealCopy(srcItem, keys);
      // Drop the source id so `put` MINTS a fresh resource (a separate object) — never overwrites the source.
      const { id: _srcId, ...sealedNoId } = sealed;
      copy = await fromStore.put({ ...sealedNoId, sharedCopyOf: itemId }, { by });
    } catch (cause) {
      return { ok: false, error: 'share-seal-failed', cause };
    }
    return shareIntoAudience(stores, {
      itemId: copy.id, fromCircleId, toCircleId, by, recipient, recipients, postureOf,
      onShare: enforcement.onShare,   // grant on the copy; no further re-seal (already sealed to the recipients)
    });
  }

  // FAIL LOUD — a canonical circle whose group-key content must leave as a COPY, but the copy machinery (pod
  // onShare + a sealer + recipient keys) isn't ALL present: refuse rather than fall through to the in-place
  // re-wrap below, which would be exactly the group-key leak this router exists to stop. Production always
  // wires `sealCopy`, so this is the belt-and-braces path, not the common one.
  if (isCanonicalPosture(posture) && mustCopy) {
    return { ok: false, error: 'seal-scope-copy-unavailable' };
  }

  // Fallback (no pod/keys, or an enforcement without onShare) — in-place ref path: write the ref to the source
  // item and let the enforcement's injected `seal` (if any) re-wrap IN PLACE, fed the recipients' sealing keys.
  // A copy-reseal posture (copy/trusted/registered) reaches here only when the copy branch's preconditions
  // (pod onShare + a sealer + recipient keys) aren't ALL met, degrading to the pre-re-seal behaviour.
  return shareIntoAudience(stores, {
    itemId, fromCircleId, toCircleId, by, recipient, recipients, recipientKeys: keys, postureOf,
    onShare: enforcement?.onShare,
  });
}

/**
 * SENDABLE LISTS (journey J5) — send a WHOLE list (a container + its children, order preserved) into another
 * circle. Today a bare container share is a single self-pointer whose children do NOT travel
 * (shareItemAcrossCircles shares ONLY the named item). This op closes that gap WITHOUT a bundle format: it
 * gates + resolves ONCE (same source circle/posture for every node), then FANS the SAME per-item write path
 * (`shareOneResolved`) over the container subtree via item-store's `shareContainerTree` — the container plus
 * every descendant (list-items, nested lists, tasks), each landing its own `shared-ref`. The recipient rebuilds
 * the nesting from the shared items' own `embeds`/`containedBy` structure (see shareContainerTree).
 *
 * Mirrors `shareItemAcrossCircles`' shape + INITIATOR GATE exactly — `containerId` replaces `itemId`; the return
 * is the fan report `{ ok, container, order, shared, failed }` (ok iff EVERY node shared).
 *
 * @param {object} args  — as shareItemAcrossCircles, but `containerId` (the list root) instead of `itemId`
 * @param {number} [args.maxDepth]  subtree cycle/depth guard (forwarded to shareContainerTree)
 * @returns {Promise<{ok:boolean, container?:string, order?:string[],
 *                     shared?:Array<{itemId:string,ref:object}>, failed?:Array<object>, error?:string}>}
 */
export async function shareContainerAcrossCircles({
  resolveService, containerId, fromCircleId, toCircleId, by,
  recipient, recipients, recipientKeys, sealCopy, enforcementFor, postureOf, policyOf, maxDepth,
} = {}) {
  if (typeof resolveService !== 'function' || !containerId || !fromCircleId || !toCircleId) {
    return { ok: false, error: 'missing-args' };
  }
  if (fromCircleId === toCircleId) return { ok: false, error: 'same-circle' };

  // INITIATOR GATE — ONCE for the whole list (every node shares from the SAME source circle/policy).
  let srcPolicy;
  try { srcPolicy = typeof policyOf === 'function' ? await policyOf(fromCircleId) : undefined; }
  catch { srcPolicy = undefined; }
  const policy = normalizeCirclePolicy(srcPolicy);
  const posture = policy.sharePosture;
  if (posture === 'closed') return { ok: false, error: 'sharing-closed' };
  if (posture === 'registered' && !policy.admins.includes(by)) {
    return { ok: false, error: 'sharing-admin-only' };
  }

  const [fromSvc, toSvc] = await Promise.all([resolveService(fromCircleId), resolveService(toCircleId)]);
  if (!fromSvc?.stores || !toSvc?.stores) return { ok: false, error: 'no-stores' };

  const stores = makeCrossCircleStores(new Map([
    [fromCircleId, fromSvc.stores.getStore(fromCircleId)],
    [toCircleId,   toSvc.stores.getStore(toCircleId)],
  ]));

  const enforcement = typeof enforcementFor === 'function' ? await enforcementFor(fromCircleId) : null;
  if (sealPromiseUnmet(policy, enforcement)) {          // same promise, checked once for the whole subtree
    return { ok: false, error: 'seal-unavailable', posture: policy.storagePosture };
  }

  // Fan the SAME single-item write path over the subtree (container first, children in order; idempotent).
  return shareContainerTree(stores, {
    containerId, fromCircleId, toCircleId, maxDepth,
    shareNode: (itemId) => shareOneResolved({
      stores, itemId, fromCircleId, toCircleId, by, posture,
      recipient, recipients, recipientKeys, sealCopy, enforcement, postureOf,
    }),
  });
}

/**
 * Share ONE canonical item OUT to an OUT-OF-CIRCLE recipient (objective L · Phase 2) — one who is NOT in the
 * origin roster, identified ONLY by their PUBLISHED Ed25519 network key. This op is now POLICY-GOVERNED by the
 * SOURCE circle's `shareOutOfCircle` axis (circlePolicy.js), and the target circle is OPTIONAL (a person-share
 * needs no target circle to land a pointer in).
 *
 *   • `prohibit` → REFUSED ({ok:false, error:'share-prohibited'}) — the admin blocked out-of-circle sharing.
 *   • `notify`   → REVOCABLE CANONICAL in-place grant: rides `enforcement.onShareToPublishedKey` (derive the
 *       recipient's sealing key from their published network key, re-wrap the item's group key to it + land the
 *       ACP read grant on the CANONICAL resource — NO copy). A `shared-ref` pointer is written into `toCircleId`
 *       when one is given (so the recipient surfaces it via `listSharedResolved`); with NO `toCircleId` the
 *       grant lands on the source resource directly and the (unpersisted) ref is returned for the caller to
 *       relay. THEN a best-effort NOTICE is emitted so the circle knows an item was shared out — its TARGET is
 *       the per-circle `notifyOutOfCircle` setting (circlePolicy.js): `'admins'` (default) pings the circle's
 *       admins via the injected `notify` emitter; `'post'` lands a category-tagged noticeboard post via the
 *       injected `post` emitter instead. See `emitOutOfCircleNotice`.
 *   • `silent`   → COPY: a SEPARATE object sealed to the recipient's network-derived key (privacy — leaves NO
 *       ACP grant or shared-ref trace on the CANONICAL item), reusing the copy-reseal machinery. See
 *       `shareSilentCopyToPublishedKey`.
 *
 * `includeHistory` (default FALSE) — a freshly-granted out-of-circle recipient gets the CURRENT content only;
 * the item's PRE-GRANT history is withheld unless this is explicitly set, in which case the retained historic
 * group-key versions are re-wrapped to the recipient (grantMember's `extra` path). Copy mode is the current
 * content only — history N/A.
 *
 * Absent a canonical enforcement (memory path / no pod / not signed in) the notify path degrades to the plain
 * `shared-ref` write (no grant) and the silent path degrades to a plain copy — byte-for-byte the pre-policy
 * fallbacks. REVOKE reuses `revokeItemShare` unchanged (rotate + ACP-revoke denies any WebID).
 *
 * @param {object} args
 * @param {(circleId:string)=>Promise<{stores:{getStore:Function}}|null>} args.resolveService
 * @param {string} args.itemId
 * @param {string} args.fromCircleId          the SOURCE (origin) circle the canonical item lives in
 * @param {string} [args.toCircleId]          OPTIONAL target circle the `shared-ref` pointer lands in (notify)
 *        / the recipient's delivery circle (silent). Omit for a pure person-share (grant lands on the source).
 * @param {string} [args.by]                  the initiator (the notify payload actor)
 * @param {string} args.recipient             the out-of-circle recipient's WebID (the ACP grant subject)
 * @param {string} args.recipientNetworkKey   the recipient's PUBLISHED Ed25519 network public key (b64url)
 * @param {boolean} [args.includeHistory=false]  opt-in: also grant the retained pre-grant history (notify only)
 * @param {(networkKey:string)=>boolean} [args.verify]  optional handshake guard — falsy/throw ⇒ grant aborts.
 * @param {(circleId:string)=>Promise<{onShareToPublishedKey?:Function, onShare?:Function}|null>} [args.enforcementFor]
 * @param {(circleId:string)=>number} [args.postureOf]  target confidentiality (the posture-floor check).
 * @param {(circleId:string)=>(object|Promise<object>)} [args.policyOf]  the SOURCE circle's admin policy.
 * @param {(item:object, keys:string[])=>(object|Promise<object>)} [args.sealCopy]  the injected recipient
 *        re-sealer (pod-layer; keeps this module pod-client-free) — REQUIRED for the `silent` copy path.
 * @param {(networkKey:string)=>string} [args.sealingKeyFromNetworkKey]  derive the recipient's SEALING public
 *        key from their published network key (pod-client `sealingPublicKeyFromNetworkKey`) — silent path.
 * @param {(payload:object)=>any} [args.notify]  best-effort ADMINS emitter — called on a successful
 *        `notify`-mode share when `notifyOutOfCircle === 'admins'` (the default). The composition root wires it
 *        to `@onderling/notify-envelope` (the admin peers). Never blocks/fails the share.
 * @param {(post:object)=>any} [args.post]  best-effort NOTICEBOARD-post emitter — called instead of `notify`
 *        when `notifyOutOfCircle === 'post'`. Receives a category-tagged post (`category:'permission-log'` +
 *        `logKind`) the composition root writes to the circle's board. Never blocks/fails the share.
 * @param {(to:string, envelope:object)=>any} [args.sendSharedCopy]  SILENT path only — best-effort relay sender
 *        that pushes the sealed COPY to the recipient's peer (`to` = their published network key = peer address)
 *        as a `{subtype:'shared-copy', sealed, itemMeta, from}` envelope. Injected from the composition root
 *        (`agent.sendPeerMessage`), keeping this module transport-free. Absent ⇒ no delivery (pointer-only).
 * @returns {Promise<{ok:true, ref:object}|{ok:false, error:string, cause?:any}>}
 */
export async function shareItemToPublishedKey({
  resolveService, itemId, fromCircleId, toCircleId, by,
  recipient, recipientNetworkKey, includeHistory = false, verify,
  enforcementFor, postureOf, policyOf, sealCopy, sealingKeyFromNetworkKey, notify, post, sendSharedCopy,
} = {}) {
  if (typeof resolveService !== 'function' || !itemId || !fromCircleId) {
    return { ok: false, error: 'missing-args' };
  }
  if (toCircleId && fromCircleId === toCircleId) return { ok: false, error: 'same-circle' };
  if (!recipient || !recipientNetworkKey) return { ok: false, error: 'missing-recipient' };

  // GOVERNANCE — the SOURCE circle's `shareOutOfCircle` axis decides whether/how out-of-circle sharing runs.
  // (This REPLACES the old sharePosture/`not-canonical` gate for person-shares; sharePosture still governs
  // circle→circle sharing in shareItemAcrossCircles.)
  let srcPolicy;
  try { srcPolicy = typeof policyOf === 'function' ? await policyOf(fromCircleId) : undefined; }
  catch { srcPolicy = undefined; }
  const policy = normalizeCirclePolicy(srcPolicy);
  const outOfCircle = policy.shareOutOfCircle;
  if (outOfCircle === 'prohibit') return { ok: false, error: 'share-prohibited' };

  const fromSvc = await resolveService(fromCircleId);
  if (!fromSvc?.stores) return { ok: false, error: 'no-stores' };
  const toSvc = toCircleId ? await resolveService(toCircleId) : null;
  if (toCircleId && !toSvc?.stores) return { ok: false, error: 'no-stores' };

  const storeMap = new Map([[fromCircleId, fromSvc.stores.getStore(fromCircleId)]]);
  if (toCircleId) storeMap.set(toCircleId, toSvc.stores.getStore(toCircleId));
  const stores = makeCrossCircleStores(storeMap);

  const enforcement = typeof enforcementFor === 'function' ? await enforcementFor(fromCircleId) : null;

  // SILENT — a privacy copy sealed to the recipient; no canonical ACP grant / shared-ref trace on the item.
  if (outOfCircle === 'silent') {
    return shareSilentCopyToPublishedKey({
      stores, fromCircleId, toCircleId, itemId, by, recipient, recipientNetworkKey,
      enforcement, sealCopy, sealingKeyFromNetworkKey, postureOf, sendSharedCopy,
    });
  }

  // D2 ROUTER (Frits 2026-08-06) — group-key content can't be granted IN PLACE to an outsider (that would hand
  // them the whole circle's key). It leaves as a re-sealed COPY — the SAME mechanism as `silent`, but STILL
  // notified: mint the copy, then emit the out-of-circle notice. Tagged `via:'copy', revocable:false` so the
  // UI can show that sharing OUTSIDE a circle differs from inside (no in-place revoke on a copy the recipient
  // already holds). Previously this hard-errored `share-grant-failed` on a group-key circle.
  if (enforcement?.leaveAudienceNeedsCopy) {
    const copyResult = await shareSilentCopyToPublishedKey({
      stores, fromCircleId, toCircleId, itemId, by, recipient, recipientNetworkKey,
      enforcement, sealCopy, sealingKeyFromNetworkKey, postureOf, sendSharedCopy,
    });
    if (copyResult.ok) {
      await emitOutOfCircleNotice({
        target: policy.notifyOutOfCircle, itemId, fromCircleId, toCircleId, recipient, by, notify, post,
      });
      return { ...copyResult, via: 'copy', revocable: false };
    }
    return copyResult;
  }

  // NOTIFY (default) — the revocable canonical in-place grant, then a best-effort circle/admin notification.
  const grant = enforcement?.onShareToPublishedKey;
  const onShare = typeof grant === 'function'
    ? ({ ref }) => grant({ recipient, recipientNetworkKey, verify, includeHistory, ref })
    : undefined;
  const result = await grantToPublishedKey({ stores, fromCircleId, toCircleId, itemId, by, recipient, postureOf, onShare });

  if (result.ok) {
    // Best-effort NOTICE (never fails the already-landed share). TARGET is the per-circle setting.
    await emitOutOfCircleNotice({
      target: policy.notifyOutOfCircle, itemId, fromCircleId, toCircleId, recipient, by, notify, post,
    });
  }
  return result;
}

/**
 * Emit the out-of-circle NOTICE for a landed `notify`-mode share. The TARGET is a per-circle policy setting
 * (`notifyOutOfCircle`, circlePolicy.js): `'admins'` (default) pings the circle's admins via the injected
 * `notify` emitter; `'post'` writes a NOTICEBOARD post via the injected `post` emitter instead. Both emitters
 * are injected from the composition root (this module stays transport-free) and BEST-EFFORT — a notice failure
 * never fails the already-landed share.
 *
 * The `'post'` path tags the post `category:'permission-log'` + `logKind:'item-shared-out-of-circle'` so a
 * FUTURE dedicated "logging" section can filter these permission notices OUT of the main board. The logging
 * section itself is DEFERRED — today the post just carries the forward-compatible tag (`type:'post'`, so it
 * reuses the existing noticeboard item machinery).
 */
async function emitOutOfCircleNotice({ target, itemId, fromCircleId, toCircleId, recipient, by, notify, post }) {
  const payload = { event: 'item-shared-out-of-circle', itemId, fromCircleId, toCircleId, recipient, by };
  try {
    if (target === 'post' && typeof post === 'function') {
      await post({ type: 'post', category: 'permission-log', logKind: 'item-shared-out-of-circle', ...payload });
    } else if (typeof notify === 'function') {
      await notify(payload);
    }
  } catch { /* best-effort — a notice failure never fails the share */ }
}

/**
 * The canonical (notify-mode) grant, factored so the `toCircleId`-present and `toCircleId`-absent cases share
 * one grant hook. WITH a target circle: reuse `shareIntoAudience` (writes the `shared-ref` pointer + grants) —
 * byte-for-byte the pre-policy behaviour. WITHOUT one: synthesize the ref (NOT persisted anywhere) and call the
 * grant hook directly, so the ACP + key grant land on the source resource and the caller relays the returned
 * pointer. Memory path (no hook) with no target circle ⇒ nothing to write, ok with the synthesized ref.
 */
async function grantToPublishedKey({ stores, fromCircleId, toCircleId, itemId, by, recipient, postureOf, onShare }) {
  if (toCircleId) {
    return shareIntoAudience(stores, { itemId, fromCircleId, toCircleId, by, recipient, postureOf, onShare });
  }
  const item = await stores.getStore(fromCircleId).get(itemId);
  if (!item) return { ok: false, error: 'item-not-found' };
  const ref = {
    type: 'shared-ref', sourceCircle: fromCircleId, sourceId: itemId, sourceType: item.type,
    sharedBy: by ?? 'unknown', posture: Number.isFinite(item.posture) ? item.posture : 0,
  };
  if (typeof onShare === 'function') {
    try { await onShare({ ref, item, recipient, stores }); }
    catch (cause) { return { ok: false, error: 'share-grant-failed', cause }; }
  }
  return { ok: true, ref };
}

/**
 * SILENT out-of-circle share — mint a COPY sealed to the recipient's network-derived sealing key (privacy: the
 * canonical item keeps NO ACP grant / shared-ref trace), reusing the copy-reseal machinery. The recipient's
 * sealing public key is derived from their published network key via the injected `sealingKeyFromNetworkKey`
 * (keeps this module pod-client-free). With a delivery `toCircleId` a `shared-ref` to the COPY is written there
 * (discovery via `listSharedResolved`); with none the copy is ACP-granted directly and the pointer is returned
 * for out-of-band relay. Missing the injected sealer/derivation/pod hook ⇒ degrade to a plain (unsealed) copy —
 * the memory fallback, mirroring `shareItemAcrossCircles`' copy branch.
 *
 * DELIVERY (Frits' call) — the sealed copy is ALSO pushed over the relay directly to the recipient's peer as a
 * typed `{ subtype:'shared-copy', sealed, itemMeta, from }` envelope, via the injected `sendSharedCopy` (the
 * composition root wires it to `agent.sendPeerMessage`, keeping this module transport-free). The recipient's
 * peer address IS their published network key (`recipientNetworkKey` = the contact's `peerAddr`/`pubKey`). The
 * send is BEST-EFFORT: a relay failure never fails the already-minted+granted copy (mirrors the `notify` seam).
 * The recipient's app ingests the envelope into a "shared with me" store (see makeHandleSharedCopy) and opens
 * each copy with the sealing key derived from its OWN network identity — no pod pointer required for delivery.
 */
async function shareSilentCopyToPublishedKey({
  stores, fromCircleId, toCircleId, itemId, by, recipient, recipientNetworkKey,
  enforcement, sealCopy, sealingKeyFromNetworkKey, postureOf, sendSharedCopy,
}) {
  const fromStore = stores.getStore(fromCircleId);
  const srcItem = await fromStore.get(itemId);
  if (!srcItem) return { ok: false, error: 'item-not-found' };

  // Best-effort relay delivery of the minted copy to the recipient's peer (their network key = their address).
  const deliverCopy = async (copy) => {
    if (typeof sendSharedCopy !== 'function' || !recipientNetworkKey) return;
    const envelope = {
      subtype: 'shared-copy',
      sealed:  copy,
      itemMeta: {
        sourceCircle: fromCircleId, sourceType: srcItem.type,
        sharedCopyOf: itemId, copyId: copy.id, silent: true,
      },
      from: by ?? 'unknown',
    };
    try { await sendSharedCopy(recipientNetworkKey, envelope); }
    catch { /* best-effort — the copy is already minted + granted; delivery is fire-and-forget */ }
  };

  let recipientKey = null;
  if (typeof sealingKeyFromNetworkKey === 'function') {
    try { recipientKey = sealingKeyFromNetworkKey(recipientNetworkKey); }
    catch (cause) { return { ok: false, error: 'share-seal-failed', cause }; }
  }

  // Sealed copy path — needs the injected sealer + a derived recipient key + a pod grant hook.
  if (typeof sealCopy === 'function' && recipientKey && typeof enforcement?.onShare === 'function') {
    let copy;
    try {
      const sealed = await sealCopy(srcItem, [recipientKey]);
      const { id: _srcId, ...sealedNoId } = sealed;
      copy = await fromStore.put({ ...sealedNoId, sharedCopyOf: itemId }, { by });
    } catch (cause) { return { ok: false, error: 'share-seal-failed', cause }; }

    // Push the sealed copy over the relay to the recipient's peer (independent of the pod-pointer landing below).
    await deliverCopy(copy);

    if (toCircleId) {
      // Deliver via a shared-ref to the COPY in the delivery circle (grant lands on the copy, source untouched).
      return shareIntoAudience(stores, {
        itemId: copy.id, fromCircleId, toCircleId, by, recipient, postureOf, onShare: enforcement.onShare,
      });
    }
    const ref = {
      type: 'shared-ref', sourceCircle: fromCircleId, sourceId: copy.id, sourceType: srcItem.type,
      sharedBy: by ?? 'unknown', silent: true,
    };
    try { await enforcement.onShare({ ref, recipient, stores }); }
    catch (cause) { return { ok: false, error: 'share-grant-failed', cause }; }
    return { ok: true, ref };
  }

  // Degraded memory path — still produce a SEPARATE object (a plain copy) so the op's shape holds; no grant.
  const { id: _id, ...srcNoId } = srcItem;
  const copy = await fromStore.put({ ...srcNoId, sharedCopyOf: itemId }, { by });
  await deliverCopy(copy);
  const ref = {
    type: 'shared-ref', sourceCircle: fromCircleId, sourceId: copy.id, sourceType: srcItem.type,
    sharedBy: by ?? 'unknown', silent: true,
  };
  if (toCircleId) await stores.getStore(toCircleId).put(ref, { by });
  return { ok: true, ref };
}

/**
 * UN-SHARE (objective L) — REVOKE a recipient's canonical access to an item shared out of `fromCircleId`.
 * Only the `canonical` posture has a revocable in-place grant to rotate; the copy postures minted a SEPARATE
 * object (deleting that copy is a different op) and `closed` never shared, so those return `not-canonical`.
 *
 * The revoke composes the pod-tier `enforcement.revokeCanonical` (createCanonicalShare.revoke): rotate the
 * item's group key to the REMAINING recipients (forward secrecy) + ACP-revoke the departing recipient(s). It
 * then best-effort drops the `shared-ref` pointer from the target circle so the item stops surfacing there —
 * though the deny-by-default read gate ALREADY drops it for the revoked recipient (ACP revoke), so the
 * pointer cleanup is cosmetic, not the security boundary.
 *
 * @param {object} args
 * @param {(circleId:string)=>Promise<{stores:{getStore:Function}}|null>} args.resolveService
 * @param {string} args.itemId
 * @param {string} args.fromCircleId               the SOURCE (origin) circle the canonical item lives in
 * @param {string} [args.toCircleId]               the target circle to drop the `shared-ref` pointer from
 * @param {string} [args.recipient]                a single recipient WebID to revoke
 * @param {string[]} [args.recipients]             multiple recipient WebIDs to revoke
 * @param {string[]} [args.remainingRecipients]    sealing keys that KEEP access (defaults to the origin roster)
 * @param {(circleId:string)=>Promise<{revokeCanonical?:Function}|null>} [args.enforcementFor]
 * @param {(circleId:string)=>(object|Promise<object>)} [args.policyOf]  the SOURCE circle's admin policy
 * @returns {Promise<{ok:true}|{ok:false, error:string, cause?:any}>}
 */
export async function revokeItemShare({
  resolveService, itemId, fromCircleId, toCircleId,
  recipient, recipients, remainingRecipients, enforcementFor, policyOf,
} = {}) {
  if (typeof resolveService !== 'function' || !itemId || !fromCircleId) return { ok: false, error: 'missing-args' };

  let srcPolicy;
  try { srcPolicy = typeof policyOf === 'function' ? await policyOf(fromCircleId) : undefined; }
  catch { srcPolicy = undefined; }
  if (!isCanonicalPosture(normalizeCirclePolicy(srcPolicy).sharePosture)) return { ok: false, error: 'not-canonical' };

  const enforcement = typeof enforcementFor === 'function' ? await enforcementFor(fromCircleId) : null;
  if (typeof enforcement?.revokeCanonical !== 'function') return { ok: false, error: 'no-canonical-enforcement' };

  // The `shared-ref` shape the canonical controller derives the source resource URI from (resourceUriFor).
  const ref = { type: 'shared-ref', sourceCircle: fromCircleId, sourceId: itemId };
  try {
    await enforcement.revokeCanonical({ ref, recipient, recipients, remainingRecipients });
  } catch (cause) {
    return { ok: false, error: 'revoke-failed', cause };
  }

  // Best-effort: drop the target circle's pointer(s) to this canonical item (cosmetic — the ACP revoke +
  // group-key rotation are the boundary). Skipped silently if the store lacks a delete or the target is absent.
  if (toCircleId) {
    try {
      const toSvc = await resolveService(toCircleId);
      const store = toSvc?.stores?.getStore?.(toCircleId);
      if (store && typeof store.delete === 'function') {
        const refs = await listShared({ getStore: () => store }, toCircleId);
        for (const r of refs) {
          if (r?.sourceCircle === fromCircleId && r?.sourceId === itemId) await store.delete(r.id);
        }
      }
    } catch { /* best-effort */ }
  }
  return { ok: true };
}

/**
 * objective L follow-up — OUTBOUND canonical shares: enumerate what circle `fromCircleId` has shared OUT into
 * the given candidate circles, by scanning each target circle's `shared-ref`s for `sourceCircle === fromCircleId`.
 *
 * ENUMERABILITY (stated honestly): a `shared-ref` persists only (source item, target circle) — NOT the
 * per-recipient grant list (recipients are resolved from the target roster at share time and never stored). So
 * this is the finest grain the substrate bookkeeping supports: (itemId, toCircleId) pairs, not (item, recipient).
 * De-dupes identical (itemId, toCircleId) pointers. There is no cross-circle index, so the caller must supply the
 * candidate `circleIds` to scan (e.g. the user's own circles).
 *
 * @param {object} args
 * @param {(circleId:string)=>Promise<{stores:{getStore:Function}}|null>} args.resolveService
 * @param {string} args.fromCircleId    the SOURCE circle whose outbound shares we list
 * @param {string[]} args.circleIds     candidate target circles to scan
 * @returns {Promise<Array<{toCircleId:string, itemId:string, sourceType?:string}>>}
 */
export async function listOutboundShares({ resolveService, fromCircleId, circleIds } = {}) {
  if (typeof resolveService !== 'function' || !fromCircleId || !Array.isArray(circleIds)) return [];
  const out = [];
  const seen = new Set();
  for (const toCircleId of circleIds) {
    if (!toCircleId || toCircleId === fromCircleId) continue;
    let svc;
    try { svc = await resolveService(toCircleId); } catch { svc = null; }
    if (!svc?.stores) continue;
    let refs;
    try { refs = await listShared(svc.stores, toCircleId); } catch { refs = []; }
    for (const ref of refs) {
      if (ref?.sourceCircle !== fromCircleId || !ref?.sourceId) continue;
      const key = `${toCircleId}\u0000${ref.sourceId}`;
      if (seen.has(key)) continue;
      seen.add(key);
      out.push({ toCircleId, itemId: ref.sourceId, sourceType: ref.sourceType });
    }
  }
  return out;
}

/**
 * objective L follow-up — AUTO-REVOKE a departing member. When `recipient` is removed from / leaves
 * `fromCircleId`, revoke their canonical access to every item that circle SHARED OUT — reusing the SAME revoke
 * path (`revokeItemShare` → `enforcement.revokeCanonical`), never a second revoke mechanism.
 *
 * ENUMERABILITY / OVER-REVOCATION (honest): because the substrate stores no per-recipient grant list (see
 * listOutboundShares), we cannot tell WHICH of a circle's outbound shares a given member actually received. We
 * therefore rotate EVERY outbound canonical share of the circle away from the departing member. That over-revokes
 * (a member who never received a given share still triggers its key rotation) but is forward-secret and leaks
 * nothing. A precise "revoke only what this member held, keep every OTHER recipient exactly" needs new
 * bookkeeping — a per-item recipient registry — which the `shared-ref` does not carry today.
 *
 * Non-canonical source circles are a silent no-op (`revokeItemShare` returns `not-canonical`, counted as
 * `skipped`). Best-effort: one revoke failing never throws — it is collected in `failed` so the caller can
 * surface it WITHOUT blocking the member removal.
 *
 * @param {object} args
 * @param {(circleId:string)=>Promise<{stores:{getStore:Function}}|null>} args.resolveService
 * @param {(circleId:string)=>Promise<{revokeCanonical?:Function}|null>} [args.enforcementFor]
 * @param {(circleId:string)=>(object|Promise<object>)} [args.policyOf]
 * @param {string} args.fromCircleId    the circle the member is removed from / leaving (the SHARE source)
 * @param {string[]} args.circleIds     candidate target circles to scan for this circle's outbound shares
 * @param {string} args.recipient       the departing member's WebID (the ACP revoke subject)
 * @param {string[]} [args.remainingRecipients]  sealing keys that KEEP access (defaults to the origin roster)
 * @returns {Promise<{ok:boolean, attempted:number, revoked:number, skipped:number,
 *                     failed:Array<{itemId:string, toCircleId:string, error:string}>}>}
 */
export async function revokeAllForMember({
  resolveService, enforcementFor, policyOf, fromCircleId, circleIds, recipient, remainingRecipients,
} = {}) {
  if (typeof resolveService !== 'function' || !fromCircleId || !recipient) {
    return { ok: false, attempted: 0, revoked: 0, skipped: 0, failed: [] };
  }
  const shares = await listOutboundShares({ resolveService, fromCircleId, circleIds });
  let revoked = 0;
  let skipped = 0;
  const failed = [];
  for (const { itemId, toCircleId } of shares) {
    let r;
    try {
      r = await revokeItemShare({
        resolveService, enforcementFor, policyOf,
        itemId, fromCircleId, toCircleId, recipient, remainingRecipients,
      });
    } catch (cause) { r = { ok: false, error: 'revoke-threw', cause }; }
    if (r?.ok) revoked += 1;
    else if (r?.error === 'not-canonical') skipped += 1;
    else failed.push({ itemId, toCircleId, error: r?.error ?? 'unknown' });
  }
  return { ok: failed.length === 0, attempted: shares.length, revoked, skipped, failed };
}

/**
 * The READ path: everything shared INTO `circleId`, resolved through the source's enforcement policy.
 * DENY-BY-DEFAULT — a ref the reader isn't a recipient of resolves to null and is DROPPED (never surfaced).
 *
 * @param {object} args
 * @param {(circleId:string)=>Promise<{stores:{getStore:Function}}|null>} args.resolveService
 * @param {string} args.circleId              the target circle whose shared items we surface
 * @param {string} [args.recipient]           who is reading (the grant-check subject; my WebID on a pod)
 * @param {(circleId:string)=>Promise<{policy?:object}|null>} [args.enforcementFor]  source-circle binder
 * @param {(text:string)=>string|Promise<string>} [args.readerOpen] — the READER's own per-text
 *        opener (their TARGET-circle sealing key). Composed with the source enforcement's `open` so content
 *        re-sealed to the reader (copy mode) decrypts; a non-recipient's opener throws ⇒ the ref is dropped.
 * @returns {Promise<Array<{ref:object, item:object}>>}  only the refs that RESOLVED (deny-safe)
 */
export async function listSharedResolved({
  resolveService, circleId, recipient, enforcementFor, readerOpen,
} = {}) {
  if (typeof resolveService !== 'function' || !circleId) return [];
  const svc = await resolveService(circleId);
  if (!svc?.stores) return [];

  const refs = await listShared(svc.stores, circleId);
  const out = [];
  for (const ref of refs) {
    if (!ref?.sourceCircle) continue;
    const srcSvc = await resolveService(ref.sourceCircle);
    if (!srcSvc?.stores) continue;
    const stores = makeCrossCircleStores(new Map([
      [circleId,          svc.stores.getStore(circleId)],
      [ref.sourceCircle,  srcSvc.stores.getStore(ref.sourceCircle)],
    ]));
    const enforcement = typeof enforcementFor === 'function' ? await enforcementFor(ref.sourceCircle) : null;
    // compose the reader's own opener so a copy re-sealed to the reader's key decrypts.
    const policy = composeReaderOpen(enforcement?.policy, readerOpen);
    // DENY-BY-DEFAULT: null (non-recipient / unopenable) is dropped — no plaintext, no ciphertext.
    const item = await resolveSharedRef(stores, ref, { policy, recipient });
    if (item) out.push({ ref, item });
  }
  return out;
}
