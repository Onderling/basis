/**
 * canopy-chat — extension-mapping verify gate (feedback-extension P2b).
 *
 * A downloaded mapping (loaded from the pod `mappings/` folder by
 * `@canopy/pod-routing` `loadMappings`) declares ops that are COMPOSITES of
 * existing opIds. Before any such mapping is merged into the catalog, every
 * composite op must pass the **sandbox-by-construction** check (P1's
 * `verifyComposite`): each step's opId must resolve to a declared op/atom in
 * the catalog. A mapping that references an unknown opId is REFUSED at load
 * time — this is what makes loading a THIRD-PARTY mapping safe, and it's the
 * "verifier fail → refuse to load" path in DESIGN §1.5.
 *
 * Pure (no I/O): the caller injects the already-loaded mappings + the merged
 * catalog, so this never imports pod-routing — keeping the logic dep-free
 * (the composition root wires loadMappings → verifyMappings → merge).
 *
 * Remote-binding ops (a bot's exposed skill — `binding: 'remote-skill@contact'`)
 * are NOT catalog-verified: their handler is the bot, not a local atom, so the
 * contact-scoped bridge (P4) vouches for them instead.
 */

import { verifyComposite } from './composite.js';
import { validateManifest } from '@canopy/app-manifest';

/** A mapping op is a remote-skill binding (handler is a contact/bot, not a local atom). */
function isRemoteBinding(op) {
  return op?.binding === 'remote-skill@contact' || !!op?.bindRef?.skillId;
}

/**
 * Verify ONE mapping against the catalog. A mapping is valid only when every
 * composite op's steps resolve. Returns the union of unresolved `<app>/<op>`
 * refs across the mapping.
 *
 * @param {import('@canopy/pod-routing').Mapping} mapping
 * @param {{ opsById: Map<string, object> } | { has?: Function }} catalog
 * @returns {{ ok: boolean, missing: string[] }}
 */
export function verifyMapping(mapping, catalog) {
  const missing = new Set();
  for (const op of mapping?.ops ?? []) {
    if (isRemoteBinding(op)) continue;          // bot vouches (P4), not the catalog
    if (Array.isArray(op?.steps)) {
      const res = verifyComposite(op, catalog);
      for (const m of res.missing) missing.add(m);
    }
    // A non-composite, non-remote op declares no references → nothing to verify.
  }
  return { ok: missing.size === 0, missing: [...missing] };
}

/**
 * Partition a list of mappings into the ones safe to merge and the ones
 * refused (with the opIds they're missing — surfaced to the user).
 *
 * @param {Array<import('@canopy/pod-routing').Mapping>} mappings
 * @param {{ opsById: Map<string, object> }} catalog
 * @returns {{ accepted: Array<object>, rejected: Array<{id: string, missing: string[]}> }}
 */
export function verifyMappings(mappings, catalog) {
  const accepted = [];
  const rejected = [];
  for (const mapping of mappings ?? []) {
    const { ok, missing } = verifyMapping(mapping, catalog);
    if (ok) accepted.push(mapping);
    else rejected.push({ id: mapping?.id, missing });
  }
  return { accepted, rejected };
}

/**
 * Convert a mapping into a `mergeManifests` source manifest. A Mode-2 mapping
 * needs NO special `callSkill`: its composite ops carry `steps`, so the router
 * emits a `composite` dispatch and `runCompositeOp` (P1) runs the steps through
 * the existing global `callSkill` — which already routes each step by its
 * `appOrigin`. So the mapping's ops just need to land in the catalog.
 *
 * @param {import('@canopy/pod-routing').Mapping} mapping
 * @returns {{ app: string, operations: object[] }}
 */
export function mappingToManifest(mapping) {
  return {
    app: mapping.id,
    itemTypes: Array.isArray(mapping.itemTypes) ? mapping.itemTypes : [],  // required by validateManifest
    operations: (mapping.ops ?? []).map((op) => ({ ...op })),
  };
}

/**
 * Build `mergeManifests` sources from VERIFIED mappings, validating each one's
 * manifest and DROPPING any that's structurally invalid (so one bad mapping
 * can't throw the whole merge). Pair with `verifyMappings` first (the catalog
 * gate); this is the manifest-shape gate.
 *
 * @param {Array<import('@canopy/pod-routing').Mapping>} mappings
 * @returns {{ sources: Array<{manifest: object}>, dropped: Array<{id: string, errors: object[]}> }}
 */
export function mappingsToSources(mappings) {
  const sources = [];
  const dropped = [];
  for (const mapping of mappings ?? []) {
    const manifest = mappingToManifest(mapping);
    const { ok, errors } = validateManifest(manifest);
    if (ok) sources.push({ manifest });
    else dropped.push({ id: mapping?.id, errors });
  }
  return { sources, dropped };
}
