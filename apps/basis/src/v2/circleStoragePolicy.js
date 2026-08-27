/**
 * circleStoragePolicy — drive stoop's authoritative circle storage policy from basis.
 *
 * A circle is a stoop circle; stoop owns the REAL storage decision (admin-gated, one-way —
 * `setCircleStoragePolicy` / `getCircleStoragePolicy`). This module is the call orchestration over an
 * injected `callSkill`, so a circle admin's choice actually reaches `podRouting.setCirclePolicy`.
 * Web + mobile share it; the shells inject their `callSkill` and the active circle id.
 *
 * ── THIS FILE USED TO BE A TRANSLATOR (until 2026-08-27) ─────────────────────────────────────────
 * basis said `none | shared | personal | hybrid`; stoop said `no-pod | centralised | decentralised |
 * hybrid`. So this module carried `POD_TO_TIER` and `TIER_TO_POD` — a lossless 1:1 map between two
 * names for one thing — and every read and write across the seam went through it.
 *
 * That table was also the PROOF the two vocabularies were identical, sitting in the repo the whole
 * time the question "do they cut the space differently?" was open. They do not. Both sides speak the
 * one vocabulary now (`@onderling/pod-routing`), so the translation is the identity function and is
 * deleted rather than kept as a no-op. What remains here is the part that was never translation: the
 * two calls, and the honest coercion of whatever stoop returns.
 *
 * NB this is the STORAGE-POSTURE axis (where shared content lives), distinct from `storagePosture`
 * (p0-p3 — the at-rest sealing posture the per-circle pod PRODUCER reads). Orthogonal, set
 * independently.
 */
import { normaliseCircleStoragePosture } from '@onderling/pod-routing';

/**
 * Read the circle's current storage tier from stoop and return it as a `pod`
 * axis value (so the settings form can hydrate the radio). Best-effort: any
 * error → null (the form keeps its local value).
 *
 * @param {object} a
 * @param {(appOrigin:string, opId:string, args:object)=>Promise<any>} a.callSkill
 * @param {string} a.circleId  the circle id (= stoop groupId)
 * @returns {Promise<{pod:string, groupPodUri:string|null}|null>}
 */
export async function loadCircleStoragePod({ callSkill, circleId } = {}) {
  if (typeof callSkill !== 'function' || !circleId) return null;
  try {
    const r = await callSkill('stoop', 'getCircleStoragePolicy', { groupId: circleId });
    if (!r || typeof r !== 'object' || r.error) return null;
    return { pod: normaliseCircleStoragePosture(r.policy), groupPodUri: r.groupPodUri ?? null };
  } catch {
    return null;
  }
}

/**
 * Push a circle's chosen `pod` value to stoop's circle storage policy. Admin-only
 * + one-way (no downgrade to no-pod) are enforced BY THE SKILL — this surfaces
 * the result/error verbatim so the shell can show a localized notice.
 *
 * @param {object} a
 * @param {(appOrigin:string, opId:string, args:object)=>Promise<any>} a.callSkill
 * @param {string} a.circleId       the circle id (= stoop groupId)
 * @param {string} a.pod            the circle `pod` axis value
 * @param {string} [a.groupPodUri]  required by stoop for shared/hybrid
 * @returns {Promise<{ok:true, storage:object}|{ok:false, error:string}>}
 */
export async function pushCircleStoragePolicy({ callSkill, circleId, pod, groupPodUri } = {}) {
  if (typeof callSkill !== 'function') return { ok: false, error: 'no-callskill' };
  if (!circleId) return { ok: false, error: 'groupId required' };
  const storagePolicy = normaliseCircleStoragePosture(pod);
  let r;
  try {
    r = await callSkill('stoop', 'setCircleStoragePolicy', {
      groupId: circleId,
      storagePolicy,
      ...(groupPodUri ? { groupPodUri } : {}),
    });
  } catch (e) {
    return { ok: false, error: `storage-policy-write-failed:${e?.message ?? 'unknown'}` };
  }
  if (!r || typeof r !== 'object') return { ok: false, error: 'no-result' };
  if (r.error) return { ok: false, error: r.error };
  return { ok: true, storage: r.storage ?? null };
}
