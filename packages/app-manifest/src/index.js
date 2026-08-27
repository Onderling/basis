/**
 * @onderling/app-manifest — per-app declarative manifest + pure projectors.
 *
 * Layer: substrate.  The bundle-declaration format that feeds the §0
 * destination substrates (`@onderling/interface-registry`, `@onderling/protocol`)
 * and ships the chat/slash surface those substrates don't cover.
 *
 * Architectural boundary (PLAN guardrail #9, locked 2026-05-19):
 *   This package DECLARES.  `@onderling/interface-registry` runs per-type
 *   item rendering.  `@onderling/protocol` runs multi-step state machines.
 *   Designed forward-compatible with their public APIs — see README §Boundary.
 *
 * Phase: (greenfield; no consumers until).
 */

export {
  validateManifest,
  VERBS,
  isCanonicalVerb,
  classifyItemTypes,
  // L4 ≡ B — registry recognition for a declared noun/item-type (alias-aware).
  isRegistryType,
  // (feedback-extension) — composite-op `onError` policy allow-list.
  COMPOSITE_ON_ERROR,
  // B · (ruling) — settings-declaration allow-lists.
  SETTING_KINDS,
  SETTING_SCOPES,
  // Nav-chrome (D / Surface 1) — the shared NavTarget `kind` allow-list.
  NAV_TARGET_KINDS,
} from './validate.js';

// B · Layer 1 (2026-07-01) — the SDK ATOM CATALOGUE: the authoritative
// general-verb vocabulary a capability (verb × noun) keys off, plus alias
// resolution + classification.  Superset of the legacy `VERBS`.
export {
  ATOMS,
  ATOM_VERBS,
  // The named anchor of the verb × noun algebra (alias of ATOM_VERBS) — the
  // canonical verb set the enforcement fitness + manifest-standard reference.
  CANONICAL_ATOMS,
  ATOM_VERBS_WITH_ALIASES,
  isAtom,
  canonicalAtom,
  classifyVerb,
  atomFor,
} from './atoms.js';

// B · (ruling) — read helpers over manifest.settings (the wizard/form layer).
export {
  settingsOf,
  settingDefaults,
  isSettingRequired,
  buildSettingsForm,
} from './settings.js';

// B · Layer 1 — the (verb × noun) CAPABILITY set derived from a manifest
// (declared `nouns` ∪ derived from ops).  The unit the B gate authorises.
export { dispatchAtom, dispatchCapability } from './dispatchAtom.js';
export {
  capabilitiesOf,
  resolveAtom,
  resolveCapability,
  atomsForNoun,
  opNouns,
  capabilityKey,
} from './capabilities.js';
// §1b — the synthetic op-id codec for GENERIC (op-less) capabilities (catalogue synth ⇄ dispatch decode).
export { encodeGenericOpId, isGenericOpId, decodeGenericOpId } from './genericOp.js';

// B · (ruling) — the admin freedom template + the narrowed effective set the gate reads.
export {
  FREEDOM_LEVELS,
  OPT_OUT_CONSEQUENCES,
  DEFAULT_ROW,
  buildCapabilityMatrix,
  effectiveCapabilityKeys,
  affordanceTreatment,
} from './freedom.js';

// §6 standardisation — the manifest-conformance standard as a reusable check:
// structural validity + atom discipline + §1a noun-declaration discipline +
// projector totality. Runs per manifest; the cross-app fitness test asserts it
// over every apps/*/manifest.js. See src/conformance.js for the rule rationale.
export { manifestConformance } from './conformance.js';

export { paramsToJsonSchema } from './paramsToJsonSchema.js';

// ── The projectors — TWO FAMILIES over the one manifest ─────────────────────
// Frits' point (docs/architecture.md § "Two projector families"): the flat
// render* list quietly mixes two categories. Name them so a reader knows which
// a given projector belongs to — e.g. why renderAttachments is a peer of
// renderSlash and NOT the chat shell.
//
//   AFFORDANCE projectors — turn ops into ONE invocation surface each. A tap /
//     phrase / tool-call compiles to the SAME `{ opId, args }` → callSkill;
//     the surfaces are interchangeable at the waist (this IS `web ≡ mobile` on
//     the input side). renderChat (LLM tools) · renderSlash (/commands + NL
//     grammar) · renderGate (deterministic pre-LLM token gate) ·
//     renderAttachments (the attach "+" menu — an entry fires exactly like a
//     slash command). renderAttachments joins THIS family, next to renderSlash.
//
//   SHELL projectors — render the WHOLE platform UI (screens + nav) from the
//     same manifest. renderWeb + renderMobile (mobile re-exports web's NavModel;
//     they differ only in the platform adapter).
//
// renderCoverage is the META-projector — a matrix OVER the surfaces, not a
// surface of its own — so it sits outside both families.
import { renderChat }        from './renderChat.js';
import { renderSlash }       from './renderSlash.js';
import { renderGate }        from './renderGate.js';
import { renderAttachments } from './renderAttachments.js';
import { renderWeb }         from './renderWeb.js';
import { renderMobile }      from './renderMobile.js';

// AFFORDANCE family.
//   renderChat  — LLM tool definitions + system prompt.
//   renderSlash — /commands + deterministic NL grammar.
//   renderGate  — deterministic pre-LLM token-gate rules (from each op's
//                 `surfaces.slash.match`); shared by the household Telegram bot +
//                 the basis circle bot. Wraps renderSlash into the gate shape.
//   renderAttachments — the attach ("+") menu (from each op's `surfaces.attach`);
//                 peer of renderSlash. See renderAttachments.js.
// Re-exported in `from`-form so a documentation generator resolves each
// projector's own JSDoc at its defining module.
export { renderChat, matchesAppliesTo as chatMatchesAppliesTo,
  // The item-row button rule, shared with the embed cards so both surfaces offer one set.
  itemRowButtons } from './renderChat.js';
export { renderSlash } from './renderSlash.js';
export { renderGate } from './renderGate.js';
export { renderA2A, NEVER_DELEGABLE } from './renderA2A.js';
export { renderAttachments } from './renderAttachments.js';

// SHELL family (web + mobile surface projection).
//   renderWeb    — DOM pages + forms (NavModel).
//   renderMobile — alias: renderMobile === renderWeb (same NavModel, different
//                  adapter). Cross-surface equivalence is locked by
//                  test/crossSurfaceEquivalence.test.js (strict JSON equality).
export { renderWeb } from './renderWeb.js';
export { renderMobile } from './renderMobile.js';

/**
 * The AFFORDANCE projectors keyed by name — each turns the manifest's ops into one
 * invocation surface (chat tool-call, slash command, deterministic gate, attach menu),
 * all compiling to the same `{ opId, args }`. Frozen so consumers/tests can iterate a
 * family without re-listing its members (drift guard: a new projector joins here once).
 * @type {Readonly<Record<string, function>>}
 */
export const AFFORDANCE_PROJECTORS = Object.freeze({
  renderChat, renderSlash, renderGate, renderAttachments,
});

/**
 * The SHELL projectors keyed by name — each renders the whole platform UI (screens + nav)
 * from the same manifest. renderMobile re-exports renderWeb's NavModel; they differ only in
 * the platform adapter. Frozen (same drift-guard rationale as AFFORDANCE_PROJECTORS).
 * @type {Readonly<Record<string, function>>}
 */
export const SHELL_PROJECTORS = Object.freeze({ renderWeb, renderMobile });

// renderCoverage — manifest → surface-coverage matrix (op × chat/slash/gate/
// attach/web-mobile/inline): scan what's wired where, find gaps, plan menus.
export { renderCoverage, coverageGaps, formatCoverageMarkdown } from './renderCoverage.js';

// flows — the declared multi-step layer above ops (L7): the DAG declaration +
// the load-time verifier (bindings resolvable, kinds/secrets rules, acyclic).
export { verifyFlow, verifyFlows } from './flows.js';
// flowRunner — executes a declared flow as a resumable instance (pure, DI'd; the
// secrets rule at runtime: saveInstance never sees secret material).
export { createFlowRunner } from './flowRunner.js';
// renderFlow — the ONE flow projector: flow + instance → the view model both shells
// paint (progress · form-with-labelKeys · actions) — the wizard machinery, generalized.
export { renderFlow } from './renderFlow.js';

// JSDoc typedefs live here; importing the module forces it to be loaded
// so tooling can resolve type-only references.
export { __types__ }           from './schema.js';
