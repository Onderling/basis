/**
 * @onderling/agent-registry — canonical agent registry substrate.
 *
 * Standardisation Phase 52.10. See
 * `Project Files/Substrates/substrates-v2-coding-plan-2026-05-11.md`.
 */

export { createAgentRegistry }  from './src/AgentRegistry.js';
export { makeActorResolver }    from './src/makeActorResolver.js';
export {
  registryResourceUri,
  normaliseResource,
  emptyResource,
  RESOURCE_VERSION,
} from './src/resource.js';
export { withCAS } from './src/concurrency.js';
export { projectAgentCard } from './src/agentCard.js';
// identity step 2 — profile own/inherit property graph + root-derived profile creation
export {
  own, inherit, normaliseProperties, resolveProperty, effectiveProperties, setOwn, setInherit,
} from './src/profileProperties.js';
export { createProfile, profilePubKey, profileCircleAddress } from './src/createProfile.js';

// Per-skill EXPOSURE — which of an agent's skills are advertised, per circle. A discovery FILTER, not
// access control (the dispatch grant is the enforcement); owner-key gated agent-wide, with circles able
// to narrow but never widen. → src/skillExposure.js for the reasoning.
export {
  EMPTY_EXPOSURE, normalizeExposure, isSkillExposed, filterExposedSkills,
  setSkillExposure, setCircleSkillExposure,
} from './src/skillExposure.js';
export { loadProfile } from './src/loadProfile.js';
// circle-membership RESTORE data (NOTE-identity-profiles-and-portability "What the registry must
// gain") — per-circle { handle, address, proof, relays, key:{ref,posture} }
// records carried in the profile property graph so a NEW DEVICE re-derives circle state (and can OPEN
// pre-wipe content via the wrapped-key ref) after a phrase restore. Personal restore data, NOT a
// disclosed attribute — no disclosure ladder.
export {
  CIRCLE_MEMBERSHIPS_KEY, isKeyRef, isCircleMembershipRecord, normaliseCircleMembership,
  circleMembershipsOf, circleMembershipOf, circleKeyRefOf, circleMembershipsFromProperties,
  setCircleMembership,
} from './src/circleMembership.js';
// identity step 5A — encrypted-file/DB export of the profile set
export { exportProfileRegistry, importProfileRegistry, restoreProfilesInto } from './src/exportRegistry.js';
export { registerAgentBundle } from './src/registerAgentBundle.js';
// property layer (design Phase 0) — the typed vocabulary + the shared disclosure mechanism.
export { PROPERTY_TYPES, isPropertyType, descriptor, createVocabulary } from './src/propertyVocabulary.js';
// personal drivers (#3) — the `driver` property type: an open { kind, text, tags[] } value, governed
// by the same disclosure policy as any property. The matcher (#4) builds on this shape.
export { DRIVER_KINDS, isDriverKind, normalizeDriverKind, normalizeTag, normalizeTags, createDriver, isDriverValue, driverDescriptor, driversFromProperties } from './src/drivers.js';
// offering fold-in (NOTE-skills-properties-audit; rename NOTE-offering-rename-inventory.md)
// an offering is the human-profile "I can do X" DATA: a driver-like open item (kind `offering`,
// legacy `skill` read-accepted); the fixed taxonomy is DEMOTED to its coarse disclosure rung
// (text+tags → categoryId → ∅). The INVOCABLE A2A sense keeps the word "skill".
export { OFFERINGS_TAXONOMY, OFFERING_LADDER, deriveOfferingCategory, offeringDescriptor } from './src/offeringsTaxonomy.js';
// availability unification (NOTE-skills-properties-audit 4 5) — ONE person-level
// coarse-enum property (open/limited/away) folding the old per-skill `availability`
// sub-field AND the standalone `holidayMode` boolean; 'away' IS holiday mode.
export { AVAILABILITY_STATES, AVAILABILITY_AWAY, AVAILABILITY_LADDER, isAvailabilityState, availabilityState, isAway, availabilityDescriptor } from './src/availability.js';
// location fold-in (NOTE-skills-properties-audit §4, personal-properties design §2) — ONE
// person-level coarse-enum property with the CANONICAL disclosure ladder (in-area → region →
// municipality → district → coords) folding the bespoke stoop `profile.location` field.
export { LOCATION_LADDER, LOCATION_IN_AREA, isLocationValue, locationLabel, inArea, locationDescriptor } from './src/location.js';
// media property (deferred media-descriptor bridge; NOTE-reveal-state-and-profile-updates §1.4/§2.6)
// — the `media` property type: a persona attribute (e.g. `profilePicture`) whose VALUE is a SEALED
// MEDIA REF in @onderling/item-types' `media` item-type shape (a pointer/snapshot, blob://… + enc —
// NOT bytes). Governed by the same disclosure policy as any attribute; reuses the sealed-media
// surface chat photos already ride, no new mechanism.
export { PROFILE_PICTURE_KEY, isSealedMediaRef, mediaDescriptor, profilePictureDescriptor } from './src/mediaProperty.js';
// personal-drivers matcher (#4) — on-device, explainable-only (tag overlap + optional injected LLM judge).
export { deriveSignature, itemSignature, sharedTags, jaccard, scoreDriver, matchDrivers, matchDriversSemantic, matchProfileDrivers } from './src/driverMatch.js';
// matchable-aware matching (P4c) — profile↔profile match on the `matchable` axis: `matchableSignature`
// turns a candidate's releasedForMatching set into a signature, `matchProfilesMatchable` scores MY
// drivers against it. NOT a disclosure (fed to the on-device matcher only; see releasedForMatching).
export { matchableSignature, matchProfilesMatchable } from './src/driverMatch.js';
// anonymous-talk reveal ladder (#5b) — self-controlled, unilateral, ephemeral-default identity reveal.
export { REVEAL_LEVELS, isRevealLevel, revealRank, nextRevealLevel, ephemeralHandle, createParticipant, revealSelf, revealNext, presentSelf, presetForRevealLevel, revealLevelForPreset } from './src/revealLadder.js';
export { createDisclosurePolicy, setDisclosure, getDisclosure, releasedValues, releasedForMatching, isDisclosed, isMatchable, isRequestable } from './src/disclosure.js';
// reveal PRESETS (C7) — named amount-bundles (`handle → profile → full`) over disclosure's
// `enabled` axis; the single reveal-state home. Per-attribute booleans stay the truth.
export { REVEAL_PRESETS, isRevealPreset, revealPresetRank, nextRevealPreset, applyRevealPreset, revealPresetOf } from './src/disclosure.js';
// release DIFF — "did what I share in this context actually change?". The one comparator the
// profile-update propagation gates on (member side before sending, roster side before writing).
export { changedReleaseKeys, releaseUnchanged } from './src/disclosure.js';
// property layer (design Phase 1) — the canonical Request record + the governed-request check.
export { createRequest, requestHash, requestKeys } from './src/request.js';
export { checkRequestAllowed, DEFAULT_GOVERNED_POLICY } from './src/governedRequest.js';
// property layer (design Phase 4) — the neutral request form-spec + the pure egress gate/receipt.
export { requestForm } from './src/requestForm.js';
export { egressReceipt, gateEgress } from './src/requestGate.js';

// commons-governance G1 — signed endorsements of Agent Cards + the
// endorsement-backed curated catalog read-view (fills 's catalogSource seam).
export {
  issueEndorsement,
  verifyEndorsement,
  cardHash,
  ENDORSEMENT_VERSION,
} from './src/endorsement.js';
export {
  createEndorsementResource,
  endorsementResourceUri,
  normaliseEndorsementResource,
  emptyEndorsementResource,
  ENDORSEMENT_RESOURCE_VERSION,
} from './src/endorsementResource.js';
export { createCatalogSource } from './src/catalogSource.js';

// commons-governance G2 — the web-of-trust graph walk (multiple roots,
// transitive bounded-depth endorsement walk, trust-path-proximity ranking)
// that createCatalogSource consumes, plus a real A2A well-known card resolver
// seam (injected fetch; the hermetic default is an injected map).
export { walkTrustGraph, CURATOR_ROLES, DEFAULT_MAX_DEPTH } from './src/trustGraph.js';
export { createWellKnownCardResolver } from './src/wellKnownCardResolver.js';

// commons-governance G3 — federation + moderation: circle-scoped, admin-gated
// COMMUNITY catalogs (a community = a circle; writes gated to its admins via
// the circle's own policy), SUBSCRIBE/unsubscribe (a community's admins become
// the user's curator roots), fork/exit, and revoke. `expiresAt` lapse is
// already enforced by verifyEndorsement (G1) — the walk drops lapsed edges.
export { createCommunityCatalog, communityCatalogUri } from './src/communityCatalog.js';
export { createCommunitySubscriptions } from './src/subscriptions.js';
