/**
 * basis-mobile — the PORTABLE interaction model behind the RN cross-circle SHARE screen
 * (objective L · invariant #2 web≡mobile). Vitest can't render RN components, so the screen's logic
 * lives here as pure, dependency-injected functions the `CircleShareScreen` view calls; the RN file is a
 * thin renderer (state + Pressables) over these.
 *
 * It is a THIN ADAPTER over the composition-root wrappers in `./circlePods.js` — it calls
 * `shareItemIntoCircle` / `listSharedItems` / `unshareItemFromCircle` (and `getCircleLists` to enumerate
 * the source circle's shareable items) and adds NO share/seal/revoke logic of its own (invariant #1). The
 * canonical-vs-copy gating is the SAME rule web's admin panel uses: an in-place canonical share (`item`
 * has no `sharedCopyOf`) is revocable; a re-sealed copy is a separate object and is not (`not_revocable`).
 */
import {
  shareItemIntoCircle as defaultShareItemIntoCircle,
  shareItemToPublishedKey as defaultShareItemToPublishedKey,
  listSharedItems as defaultListSharedItems,
  unshareItemFromCircle as defaultUnshareItemFromCircle,
  getCircleLists as defaultGetCircleLists,
} from './circlePods.js';
// objective L · Phase 2 — the SHARED (web≡mobile) out-of-circle recipient selector. Mobile uses the SAME
// selector web's `renderRecipientPicker` does — no mobile fork (invariants #1/#2).
import { pickableRecipients, outOfCircleLinkWarning } from '../../../basis/src/v2/shareRecipients.js';
import { shareErrorStatusKey } from '../../../basis/src/v2/circleShare.js';

/** The default wrapper set — the live composition root. Tests inject a fake `deps` in its place. */
export const defaultShareDeps = {
  shareItemIntoCircle: defaultShareItemIntoCircle,
  shareItemToPublishedKey: defaultShareItemToPublishedKey,
  listSharedItems: defaultListSharedItems,
  unshareItemFromCircle: defaultUnshareItemFromCircle,
  getCircleLists: defaultGetCircleLists,
};

// Re-export the shared selector + the D7 out-of-circle link-warning RULE so the RN view imports its ONE
// recipient projection (and one warning rule) from the screen model — web ≡ mobile by construction.
export { pickableRecipients, outOfCircleLinkWarning };

/**
 * The source circle's own items that can be shared OUT — resolved through the SAME lists service the
 * wrappers write to (`getCircleLists`), so the UI and the share op operate on one store. `shared-ref`
 * pointers (items shared INTO the circle) are filtered out — you share your own items, not the pointers.
 *
 * @returns {Promise<Array<{id:string, text:string, type?:string}>>}
 */
export async function loadShareableItems({ circleId, policy, deps = defaultShareDeps } = {}) {
  if (!circleId) return [];
  let svc;
  try { svc = await deps.getCircleLists(circleId, policy); } catch { svc = null; }
  const store = svc?.stores?.getStore?.(circleId);
  if (!store || typeof store.list !== 'function') return [];
  let items;
  try { items = await store.list(); } catch { items = []; }
  return (Array.isArray(items) ? items : [])
    .filter((it) => it && it.id && it.type !== 'shared-ref')
    .map((it) => ({ id: it.id, text: it.text ?? it.label ?? String(it.id), type: it.type }));
}

/**
 * Map ONE resolved shared entry (from `listSharedItems`) to a render row + its canonical gating. A
 * canonical (in-place) share carries no `sharedCopyOf` and is revocable in place; a copy is a separate
 * object → `revocable: false` → the screen shows `circle.share.not_revocable` instead of Stop sharing.
 */
export function shareRowFrom(entry) {
  const item = entry?.item ?? {};
  const ref = entry?.ref ?? {};
  const canonical = !item.sharedCopyOf;
  return {
    ref,
    item,
    label: item.text ?? item.label ?? String(ref.sourceId ?? ''),
    canonical,
    revocable: canonical,
  };
}

/**
 * The "shared INTO this circle" list, deny-by-default resolved for `recipient`, mapped to render rows.
 * @returns {Promise<Array<{ref:object, item:object, label:string, canonical:boolean, revocable:boolean}>>}
 */
export async function loadSharedRows({ circleId, recipient, policyOf, deps = defaultShareDeps } = {}) {
  if (!circleId) return [];
  let entries;
  try { entries = await deps.listSharedItems(circleId, { recipient, policyOf }); } catch { entries = []; }
  return (Array.isArray(entries) ? entries : []).map(shareRowFrom);
}

/**
 * The pickable share targets: the user's circles MINUS the source circle (you can't share an item into
 * its own circle — `shareOut` rejects `same-circle` anyway, so it must never be offered). Reuses the SAME
 * circle list the launcher already loaded (`loadCircles`) — no refetch/reimplementation of the registry.
 * Maps each to a stable `{ id, name }` render shape; a nameless circle falls back to its id as the label.
 *
 * @returns {Array<{id:string, name:string}>}
 */
export function pickableCircles({ circles, sourceCircleId } = {}) {
  return (Array.isArray(circles) ? circles : [])
    .filter((c) => c && c.id && c.id !== sourceCircleId)
    .map((c) => ({ id: c.id, name: c.name ?? c.title ?? String(c.id) }));
}

/** A t()-ready status: `{ ok, statusKey, params }` — the caller renders `t(statusKey, params)`. */
function status(ok, statusKey, params) { return { ok, statusKey, params }; }

/**
 * Share one of the circle's items OUT into `toCircleId`. Thin pass-through to `shareItemIntoCircle`; the
 * source posture (canonical vs copy) is decided by the wrapper + enforcement, not here. Returns a status
 * keyed to `circle.share.done` / `circle.share.failed`.
 */
export async function shareOut({
  itemId, fromCircleId, toCircleId, by, recipient, policyOf, deps = defaultShareDeps,
} = {}) {
  const target = String(toCircleId ?? '').trim();
  if (!itemId || !fromCircleId || !target) return status(false, 'circle.share.failed', { error: 'missing' });
  if (target === fromCircleId) return status(false, shareErrorStatusKey('same-circle'), { error: 'same-circle' });
  let r;
  try { r = await deps.shareItemIntoCircle({ itemId, fromCircleId, toCircleId: target, by, recipient, policyOf }); }
  catch (e) { return status(false, 'circle.share.failed', { error: e?.message ?? 'error' }); }
  if (r?.ok) return status(true, 'circle.share.done', { item: itemId, circle: target });
  // The KEY carries the explanation for a known code ("your pod is not connected…"), so a refusal reads as
  // something the person can act on rather than as a raw machine code. Unknown codes keep the old template.
  return status(false, shareErrorStatusKey(r?.error), { error: r?.error ?? 'unknown' });
}

/**
 * objective L · Phase 2 — share one of the circle's items OUT to an OUT-OF-CIRCLE PERSON (a contact),
 * ALONGSIDE `shareOut` (share to a circle's members). Thin pass-through to `shareItemToPublishedKey`; the
 * `recipientNetworkKey` is the contact's published key the SHARED `pickableRecipients` selector produced.
 * The pointer still lands in a distinct `toCircleId` (the op's target-circle requirement). Returns a status
 * keyed to `circle.share.to_person_done` / `circle.share.to_person_failed`.
 */
export async function shareToRecipient({
  itemId, fromCircleId, toCircleId, recipient, recipientNetworkKey, name, by, verify, includeHistory, policyOf,
  deps = defaultShareDeps,
} = {}) {
  // `toCircleId` is now OPTIONAL — a pure person-share needs no target circle. Empty ⇒ undefined (the shared
  // op grants on the source resource + returns the pointer to relay). The `shareOutOfCircle` policy decides.
  const target = String(toCircleId ?? '').trim() || undefined;
  if (!itemId || !fromCircleId) return status(false, 'circle.share.to_person_failed', { error: 'missing' });
  if (target && target === fromCircleId) return status(false, 'circle.share.to_person_failed', { error: 'same-circle' });
  if (!recipient || !recipientNetworkKey) return status(false, 'circle.share.to_person_failed', { error: 'missing-recipient' });
  let r;
  try {
    r = await deps.shareItemToPublishedKey({
      itemId, fromCircleId, toCircleId: target, by, recipient, recipientNetworkKey, verify, includeHistory, policyOf,
    });
  } catch (e) { return status(false, 'circle.share.to_person_failed', { error: e?.message ?? 'error' }); }
  // via:'copy' — the D2 seal gate re-sealed a COPY (group-key content can't grant in place out-of-circle);
  // tell the user outside-circle sharing differs (a copy, not revocable). Web parity (circleApp.js).
  if (r?.ok) return status(true, r?.via === 'copy' ? 'circle.share.to_person_done_copy' : 'circle.share.to_person_done', { item: itemId, name: name ?? recipient });
  return status(false, 'circle.share.to_person_failed', { error: r?.error ?? 'unknown' });
}

/**
 * Stop sharing a canonical (in-place) share. GUARDED: a non-canonical row never calls the revoke wrapper
 * — it returns `circle.share.not_revocable`, mirroring web's canonical-only gating. Revokes via
 * `unshareItemFromCircle` against the SOURCE circle/item captured in the row's `ref`. Returns a status
 * keyed to `circle.share.revoked` / `circle.share.revoke_failed`.
 */
export async function stopSharing({
  row, toCircleId, recipient, policyOf, deps = defaultShareDeps,
} = {}) {
  if (!row?.canonical) return status(false, 'circle.share.not_revocable');
  const { sourceCircle, sourceId } = row.ref ?? {};
  if (!sourceCircle || !sourceId) return status(false, 'circle.share.revoke_failed', { error: 'no-ref' });
  let r;
  try {
    r = await deps.unshareItemFromCircle({
      itemId: sourceId, fromCircleId: sourceCircle, toCircleId, recipient, policyOf,
    });
  } catch (e) { return status(false, 'circle.share.revoke_failed', { error: e?.message ?? 'error' }); }
  if (r?.ok) return status(true, 'circle.share.revoked', { recipient: recipient ?? '', item: sourceId });
  return status(false, 'circle.share.revoke_failed', { error: r?.error ?? 'unknown' });
}
