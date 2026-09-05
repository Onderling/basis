// Charter consent (participant side) — the pure logic behind the feedback requested-attributes consent step
// (property-layer Phase 3 + the shared-profile LIFT; plans/NOTE-property-layer-design.md §7 + §9 remainder 1).
//
// Given a project's declared charter (config.charter = { version?, attributes:[{key,purpose}] } — the PM's
// request), this produces: the consent items to render, an immutable choice model, exactly what rides the
// contribution (released coarse attributes + charterHash), and an on-device rare-combo WARNING.
//
// ★ LIFTED onto the SHARED disclosure layer: a "consent" is now a mini **profile** (an own/inherit property
// graph — `setOwn`) + a shared **disclosure policy** (`@onderling/agent-registry`), keyed by the project as the
// context. So a value the participant picks is stored as a profile PROPERTY and a per-context disclosure — the
// same shapes any app/bot uses. Today the graph is held locally per project; when the participant's REAL
// profile graph is available, only `getProfile` changes (point it at the registry) and place/age are curated
// ONCE and reused across apps. The vocabulary (buckets, place-validation, charterHash, the warning) stays with
// @onderling/attribute-charter; the disclosure MECHANISM is now the shared one.
import { createCharter, charterHash, charterKeys, disclosureWarning, bucketsFor, isValidValue } from '@onderling/attribute-charter';
import { setOwn, createDisclosurePolicy, setDisclosure, getDisclosure, releasedValues } from '@onderling/agent-registry';

/** Validate + build the charter a project declared (null when the project has none). */
export function charterFromConfig(projectId, cfgCharter) {
  if (!cfgCharter || !Array.isArray(cfgCharter.attributes) || cfgCharter.attributes.length === 0) return null;
  return createCharter({ projectId, version: cfgCharter.version ?? 1, attributes: cfgCharter.attributes });
}

/** The rows a consent UI renders: each requested attribute + its purpose + its allowed buckets. */
export function consentItems(charter) {
  return (charter?.attributes ?? []).map((a) => ({ key: a.key, purpose: a.purpose, buckets: bucketsFor(a.key) ?? null }));
}

/**
 * A fresh consent = a mini PROFILE (property graph) + a shared disclosure POLICY, with the project as the
 * disclosure context. Default-WITHHOLD (empty policy). Serialisable; all functions below are pure transforms.
 */
export function emptyConsent(projectId) {
  return { projectId, properties: {}, policy: createDisclosurePolicy() };
}

/** Set a coarse value for an attribute → an OWN profile property (immutable). Does NOT enable sharing. */
export function setConsentValue(consent, key, value) {
  if (!isValidValue(key, value)) throw new RangeError(`setConsentValue: ${JSON.stringify(value)} is not a coarse allowed value for ${key}`);
  return { ...consent, properties: setOwn(consent.properties, key, value) };
}

/** Enable/disable sharing an attribute for THIS project context (immutable; default withheld). */
export function toggleConsent(consent, key, on) {
  return { ...consent, policy: setDisclosure(consent.policy, consent.projectId, key, { enabled: on === true }) };
}

/** getProfile for the local consent graph — swap this for the registry lookup to reuse a real profile. */
function localProfileCtx(consent) {
  return {
    getProfile: (id) => (id === consent.projectId ? { properties: consent.properties } : null),
    profileId: consent.projectId,
    defaultProfileId: consent.projectId,
  };
}

/**
 * What this consent will attach to a contribution: the released coarse attributes (only charter-requested +
 * enabled + valued) via the SHARED disclosure layer, plus the charterHash. Withheld attributes are ABSENT.
 *
 * `profileCtx` is the SWAP POINT for cross-app reuse (§9 remainder / §7 load-bearing decision): pass a
 * `{ getProfile, profileId, defaultProfileId }` pointing at the user's REAL agent-registry profile and the
 * values come from there (curated once, reused across apps) — no other change. Omit it and the release reads
 * the local consent graph (today's feedback path). The disclosure POLICY still governs what's enabled.
 *
 * @param {object} consent
 * @param {object} charter
 * @param {{getProfile:Function, profileId:string, defaultProfileId?:string}} [profileCtx]  external profile (real registry)
 * @returns {{ attributes: object, charterHash: string }}
 */
export function consentRelease(consent, charter, profileCtx = null) {
  const request = { items: charterKeys(charter).map((key) => ({ key })) };
  const ctx = profileCtx && typeof profileCtx.getProfile === 'function' ? profileCtx : localProfileCtx(consent);
  const attributes = releasedValues(ctx, request, consent.policy, consent.projectId);
  return { attributes, charterHash: charterHash(charter) };
}

/** The keys this consent currently shares for the charter (enabled AND has a value). */
export function enabledConsentKeys(consent, charter) {
  return charterKeys(charter).filter((key) =>
    getDisclosure(consent.policy, consent.projectId, key).enabled && consent.properties[key]);
}

/**
 * The on-device low-leak warning: is the participant's enabled combo likely rare in a cohort of ~n?
 * `n` (approximate cohort size) may be absent → the warning is inert (warn:false).
 */
export function consentWarning(consent, charter, n, mode = 'normal') {
  return disclosureWarning({ enabledKeys: enabledConsentKeys(consent, charter), n, mode });
}
