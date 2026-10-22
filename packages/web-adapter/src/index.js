/**
 * @onderling/web-adapter —.0 (PLAN-gui-chat-uplift.md).
 *
 * Shared pure-JS helpers used by every renderWeb-driven web page in
 * the monorepo. Pulled out of `apps/household/web/main.js` +
 * `apps/tasks-v0/web/dag.html` so consumers stop duplicating the same
 * 30-line stubs.
 *
 * Layer: substrate (no DOM dependency). Browser shells import this
 * package's individual files at runtime via static overlays (the same
 * `extraStaticFiles` mechanism `bin/tasks-ui.js` already uses for
 * `/lib/dagFlatten.js`).
 *
 * Tests run in Node (vitest). The helpers must work in both Node and
 * the browser without bundling — keep imports relative, ESM-only, and
 * never touch DOM/`window`.
 *
 * Forward direction (Slice C — tasks-mobile / renderMobile adapter,
 * pinboard web): the same helpers feed renderMobile's
 * appliesTo predicate (it would reinvent the same gate). When that
 * lands, `itemMatchesAppliesTo` + `deriveItemState` + `applyPrefilledParams`
 * stay device-independent (per Platform Parity); only `callSkill`
 * has a web-only wire shape — renderMobile's call shape is the same
 * A2A `/tasks/send` POST, so even that could be shared, with the
 * baseUrl parameterised.
 */

export { callSkill }            from './callSkill.js';
export { deriveItemState }      from './deriveItemState.js';
export { itemMatchesAppliesTo } from './itemMatchesAppliesTo.js';
export { applyPrefilledParams } from './applyPrefilledParams.js';
// section data-fetch helper. Honours
// section.dataSource; falls back to rule-b default.
export { fetchSectionItems }    from './fetchSectionItems.js';
// paramsSchema → platform-neutral form-field
// descriptors.  Resolves A.3 agent's multi-field-form signal.
export { schemaToFormFields }   from './schemaToFormFields.js';
// T2-tier helper for hand-coded pages that want
// to read confirm-severity + labels from the manifest.  Per
// DESIGN-tier-policy.md, this is the bridge that makes T2 cheap.
