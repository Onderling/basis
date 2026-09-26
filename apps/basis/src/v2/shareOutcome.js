import { PROFILE_PICTURE_KEY } from '@onderling/agent-registry';

/**
 * WHAT A SHARE SAYS IT DID — one sentence, decided once, painted by every Mij and About-me screen on both shells.
 *
 * Four painters used to decide it themselves ("ok" → "Gedeeld ✓"), which is how a share that left the picture out
 * could still say it had shared: the re-seal drops a picture the circle cannot carry (no seal strategy for its media —
 * a pod-less circle today), the rest went out, and every painter saw `ok`. The share reports what it left out
 * (`dropped`), and this says so.
 *
 * @param {{ok?: boolean, reason?: string, dropped?: string[]}|null} res  what `shareDisclosureToCircle` answered
 * @param {{stopping?: boolean}} [o]  the push was a "stop sharing" (an empty release)
 * @returns {{key: string, params?: object}}
 */
export function shareOutcome(res, { stopping = false } = {}) {
  if (!res?.ok) return { key: 'circle.aboutme.share_failed', params: { reason: res?.reason ?? '' } };
  if (Array.isArray(res.dropped) && res.dropped.length) return { key: 'circle.aboutme.shared_without_picture' };
  return { key: stopping ? 'circle.mij.stopped_sharing' : 'circle.aboutme.shared_ok' };
}

/** The in-flight state, the same everywhere. */
export const SHARING_NOW = Object.freeze({ key: 'circle.aboutme.sharing_now' });

/**
 * Is this disclosure key refused in this circle — a picture where the circle cannot carry one? The one answer Mij asks
 * on both shells, beside the offer and beside a row already disclosed. `canCarryMedia(circleId)` → true · false · null
 * (unknown: no claim, offered as before).
 */
export function mediaRefusedHere(key, circleId, canCarryMedia) {
  return key === PROFILE_PICTURE_KEY && typeof canCarryMedia === 'function' && canCarryMedia(circleId) === false;
}
