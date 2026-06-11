/**
 * @canopy/app-manifest — per-app declarative manifest + pure projectors.
 *
 * Layer: substrate.  The bundle-declaration format that feeds the §0
 * destination substrates (`@canopy/interface-registry`, `@canopy/protocol`)
 * and ships the chat/slash surface those substrates don't cover.
 *
 * Architectural boundary (PLAN guardrail #9, locked 2026-05-19):
 *   This package DECLARES.  `@canopy/interface-registry` runs per-type
 *   item rendering.  `@canopy/protocol` runs multi-step state machines.
 *   Designed forward-compatible with their public APIs — see README §Boundary.
 *
 * Phase: SP-0 (greenfield; no consumers until SP-1).
 */

export {
  validateManifest,
  VERBS,
  isCanonicalVerb,
  classifyItemTypes,
} from './validate.js';

export { paramsToJsonSchema } from './paramsToJsonSchema.js';
export { renderChat }          from './renderChat.js';
export { renderSlash }         from './renderSlash.js';
// renderGate — manifest → deterministic token-gate rules (the pre-LLM half; shared by the
// household TG-bot + the canopy-chat circle bot). Wraps renderSlash into the gate rule shape.
export { renderGate }          from './renderGate.js';
// renderCoverage — manifest → surface-coverage matrix (op × chat/slash/gate/web-mobile/inline):
// scan what's wired where, find gaps, plan inline menus.
export { renderCoverage, coverageGaps, formatCoverageMarkdown } from './renderCoverage.js';
// Slice A.1 (2026-05-20) — web/mobile surface projection.
// See DESIGN-navmodel-sketch.md for the NavModel shape +
// PLAN-gui-chat-uplift.md Slice A for the consumer roadmap.
export { renderWeb }           from './renderWeb.js';
// V0 alias: renderMobile === renderWeb (same NavModel, different adapter).
// Cross-surface equivalence is locked by test/crossSurfaceEquivalence.test.js
// per DESIGN-navmodel-sketch.md § Q4 (strict JSON equality default).
export { renderMobile }        from './renderMobile.js';

// JSDoc typedefs live here; importing the module forces it to be loaded
// so tooling can resolve type-only references.
export { __types__ }           from './schema.js';
