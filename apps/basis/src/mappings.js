/**
 * basis — extension-mapping verify gate (feedback-extension P2b).
 *
 * A downloaded mapping (loaded from the pod `mappings/` folder by
 * `@onderling/pod-routing` `loadMappings`) declares ops that are COMPOSITES of
 * existing opIds. Before any such mapping is merged into the catalogue, every
 * composite op must pass the **sandbox-by-construction** check ('s
 * `verifyComposite`): each step's opId must resolve to a declared op/atom in
 * the catalogue. A mapping that references an unknown opId is REFUSED at load
 * time — this is what makes loading a THIRD-PARTY mapping safe, and it's the
 * "verifier fail → refuse to load" path in DESIGN §1.5.
 *
 * Pure (no I/O): the caller injects the already-loaded mappings + the merged
 * catalogue, so this never imports pod-routing — keeping the logic dep-free
 * (the composition root wires loadMappings → verifyMappings → merge).
 *
 * Remote-binding ops (a bot's exposed skill — `binding: 'remote-skill@contact'`)
 * are NOT catalogue-verified: their handler is the bot, not a local atom, so the
 * contact-scoped bridge vouches for them instead.
 *
 * ONE VERIFIER (2026-09-05). A downloaded mapping is a FLOW that arrived from outside: its
 * composite ops already compile to flows and run on the one flow runner, so they are verified
 * as flows too (`verifyFlow` — the secrets rule: a secret-kind param may only bind by
 * reference, a flow may not produce a secret by value), and a mapping may declare `flows[]`
 * outright. Two more refusals apply to ANYTHING that arrives from outside, because an installed
 * mapping runs AS THE USER (the `policy: 'never'` door binds external callers only):
 *   · a step that names a NEVER_DELEGABLE op (reveal the recovery phrase, enrol or revoke a
 *     device, grant a connection) is WITHHELD — no download may chain those;
 *   · when the installer names a scope (the circle's apps), a step outside it is OUT OF SCOPE.
 * The consent card shows every refusal by name; an unknown op is still simply "missing".
 */

import { verifyComposite, compileCompositeToFlow } from './composite.js';
import { validateManifest, verifyFlow, NEVER_DELEGABLE } from '@onderling/app-manifest';

/** A mapping op is a remote-skill binding (handler is a contact/bot, not a local atom). */
function isRemoteBinding(op) {
  return op?.binding === 'remote-skill@contact' || !!op?.bindRef?.skillId;
}

/**
 * Verify ONE mapping against the catalogue. A mapping is valid only when every
 * composite op's steps resolve. Returns the union of unresolved `<app>/<op>`
 * refs across the mapping.
 *
 * @param {import('@onderling/pod-routing').Mapping} mapping
 * @param {{ opsById: Map<string, object> } | { has?: Function }} catalogue
 * @returns {{ ok: boolean, missing: string[] }}
 */
/** `app/op` → the catalogue's op (params and all), for verifyFlow; bare ids are not resolved here. */
function flowOpsFor(catalogue) {
  const m = catalogue?.opsById instanceof Map ? catalogue.opsById : null;
  const ops = new Map();
  if (!m) return ops;
  for (const [key, entry] of m) {
    const opId = key.includes('/') ? key.slice(key.indexOf('/') + 1) : key;
    const app = entry?.appOrigin;
    if (app) ops.set(`${app}/${opId}`, entry?.op ?? {});
  }
  return ops;
}

/** The refusals every flow from outside gets, beyond verifyFlow's own rules. */
function refusalsFor(flow, { scopeApps }) {
  const withheld = [];
  const outOfScope = [];
  for (const step of flow?.steps ?? []) {
    if (typeof step?.op !== 'string') continue;
    const cut = step.op.indexOf('/');
    if (cut < 0) continue;
    const app = step.op.slice(0, cut);
    const opId = step.op.slice(cut + 1);
    if (NEVER_DELEGABLE.has(`${app}.${opId}`)) withheld.push(step.op);
    if (Array.isArray(scopeApps) && scopeApps.length && !scopeApps.includes(app)) outOfScope.push(step.op);
  }
  return { withheld, outOfScope };
}

/**
 * Verify ONE mapping against the catalogue. A mapping is valid only when every composite op's
 * steps resolve, every flow (compiled composites and declared `flows[]` alike) passes the flow
 * verifier, no step names a never-delegable op, and — when the installer names a scope — no step
 * leaves it. Returns every problem by category, so the consent card can say why.
 *
 * @param {import('@onderling/pod-routing').Mapping} mapping
 * @param {{ opsById: Map<string, object> } | { has?: Function }} catalogue
 * @param {{ scopeApps?: string[]|null }} [opts]  the apps the installing scope allows (a circle's `policy.apps`)
 * @returns {{ ok: boolean, missing: string[], withheld: string[], outOfScope: string[], problems: string[] }}
 */
export function verifyMapping(mapping, catalogue, { scopeApps = null } = {}) {
  const missing = new Set();
  const withheld = new Set();
  const outOfScope = new Set();
  const problems = [];
  const ops = flowOpsFor(catalogue);
  const declaredFlows = new Map((mapping?.flows ?? []).filter((f) => f && typeof f.id === 'string').map((f) => [f.id, f]));
  const check = (flow) => {
    const r = refusalsFor(flow, { scopeApps });
    for (const w of r.withheld) withheld.add(w);
    for (const o of r.outOfScope) outOfScope.add(o);
    const v = verifyFlow(flow, { ops, flows: declaredFlows });
    // an unknown op is reported as MISSING (the old contract); every other problem keeps its sentence
    for (const pr of v.problems) {
      const m = /references unknown op "([^"]+)"/.exec(pr);
      if (m) missing.add(m[1]); else problems.push(pr);
    }
  };
  for (const op of mapping?.ops ?? []) {
    if (isRemoteBinding(op)) continue;          // bot vouches, not the catalogue
    if (Array.isArray(op?.steps)) {
      const res = verifyComposite(op, catalogue);
      for (const m of res.missing) missing.add(m);
      check(compileCompositeToFlow(op));
    }
    // A non-composite, non-remote op declares no references → nothing to verify.
  }
  for (const flow of declaredFlows.values()) check(flow);
  return {
    ok: missing.size === 0 && withheld.size === 0 && outOfScope.size === 0 && problems.length === 0,
    missing: [...missing], withheld: [...withheld], outOfScope: [...outOfScope], problems,
  };
}

/**
 * Partition a list of mappings into the ones safe to merge and the ones
 * refused (with the opIds they're missing — surfaced to the user).
 *
 * @param {Array<import('@onderling/pod-routing').Mapping>} mappings
 * @param {{ opsById: Map<string, object> }} catalogue
 * @returns {{ accepted: Array<object>, rejected: Array<{id: string, missing: string[]}> }}
 */
export function verifyMappings(mappings, catalogue, opts = {}) {
  const accepted = [];
  const rejected = [];
  for (const mapping of mappings ?? []) {
    const { ok, missing, withheld, outOfScope, problems } = verifyMapping(mapping, catalogue, opts);
    if (ok) accepted.push(mapping);
    else rejected.push({ id: mapping?.id, missing, ...(withheld.length ? { withheld } : {}), ...(outOfScope.length ? { outOfScope } : {}), ...(problems.length ? { problems } : {}) });
  }
  return { accepted, rejected };
}

/**
 * Convert a mapping into a `mergeManifests` source manifest. A Mode-2 mapping
 * needs NO special `callSkill`: its composite ops carry `steps`, so the router
 * emits a `composite` dispatch and `runCompositeOp` runs the steps through
 * the existing global `callSkill` — which already routes each step by its
 * `appOrigin`. So the mapping's ops just need to land in the catalogue.
 *
 * @param {import('@onderling/pod-routing').Mapping} mapping
 * @returns {{ app: string, operations: object[] }}
 */
export function mappingToManifest(mapping) {
  return {
    app: mapping.id,
    itemTypes: Array.isArray(mapping.itemTypes) ? mapping.itemTypes : [],  // required by validateManifest
    operations: (mapping.ops ?? []).map((op) => ({ ...op })),
    // A mapping's declared flows ride into the manifest like an app's own (verified above).
    ...(Array.isArray(mapping.flows) && mapping.flows.length ? { flows: mapping.flows.map((f) => ({ ...f })) } : {}),
  };
}

/**
 * Build `mergeManifests` sources from VERIFIED mappings, validating each one's
 * manifest and DROPPING any that's structurally invalid (so one bad mapping
 * can't throw the whole merge). Pair with `verifyMappings` first (the catalogue
 * gate); this is the manifest-shape gate.
 *
 * @param {Array<import('@onderling/pod-routing').Mapping>} mappings
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
