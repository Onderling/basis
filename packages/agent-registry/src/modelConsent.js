/**
 * A persona's consent to a MODEL judging its drivers against what others post or ask. Matching without it is tag
 * overlap on the device; with it, an injected judge may read the driver and the post together. That is the person's
 * call, per persona: `model.consent` on the profile, inherited from the default persona like any property.
 *
 * With nothing said anywhere, the answer is ON only when the person configured a model on this device themselves —
 * that act is the opt-in — and OFF otherwise. A word on the profile (true or false) always wins over that default, so
 * a persona that said no stays no on a device that has a model.
 */
import { resolveProperty } from './profileProperties.js';

/** The profile property that holds a persona's word (true · false) on a model judging its drivers. */
export const MODEL_CONSENT_KEY = 'model.consent';

/**
 * Whether a model may judge this persona's drivers: its own word, else the default persona's, else — nothing said
 * anywhere — whether the person configured a model on this device.
 *
 * @param {(id: string) => object|null} getProfile
 * @param {string} personaId
 * @param {{ defaultProfileId?: string|null, modelConfigured?: boolean }} [opts]
 * @returns {boolean}
 */
export function modelConsentFor(getProfile, personaId, { defaultProfileId = null, modelConfigured = false } = {}) {
  const said = resolveProperty(getProfile, personaId, MODEL_CONSENT_KEY, { defaultProfileId });
  if (typeof said === 'boolean') return said;
  return modelConfigured === true;
}

/** The one gate on the judge seam: the judge is handed on only under a yes (`true`, nothing else). */
export function consentedJudge(judge, consent) {
  return consent === true && typeof judge === 'function' ? judge : undefined;
}
