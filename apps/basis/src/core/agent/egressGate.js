// Egress gate at the dispatch waist — property-layer Phase 4 / Hop 2.
// (plans/NOTE-property-layer-design.md §4 "Tier 0/1 egress gate", §2 receipt.)
//
// Wraps `callSkill` so that an op which would send the user's data to an EXTERNAL service passes through the
// gate ("the answer travels, not the data"): the disclosure decision + the governed-request check decide what
// (if anything) leaves, a governed-forbidden ask is BLOCKED entirely, and a truthful receipt (what was shared /
// withheld / whether nothing left) is surfaced. Ops NOT declared external-egress pass through UNCHANGED — so
// this is INERT for local/pod ops (all of today's). It is a ready-to-apply layer: install it around a
// callSkill and declare which ops are external-egress + how to build the gate inputs for them.
//
// The gate LOGIC lives in @onderling/agent-registry (gateEgress) and is fully tested there; this is only the
// dispatch-boundary composition — no transport, no UI (the shell renders `onReceipt`).
import { gateEgress } from '@onderling/agent-registry';

// Router-detection (§10a): "external-egress = the op resolves to a NON-LOCAL target". The PLATFORM decides this
// (not the app's self-declaration, not the user) — because a bot can't be trusted to declare its own egress.
// Today EVERY app-origin routes to a local handler / the user's own pod / an in-process agent, so none egress
// to a third party. `isExternalEgressOp` therefore returns false for all known-local origins (the gate stays
// inert) and — fail-SAFE — treats an UNKNOWN origin as external (an unrecognised target is gated, not trusted).
// When a real external route lands (an MCP tool, a remote A2A agent), its origin is simply not in this set and
// the gate activates for it. NOTE: per §10a the live callSkill is NOT wrapped until such an op exists — this
// classifier + wrapCallSkillWithEgressGate compose the ready-to-install seam.
export const LOCAL_APP_ORIGINS = Object.freeze(new Set(['household', 'tasks', 'pinboard', 'folio', 'calendar', 'agents']));

export function isExternalEgressOp(appOrigin /*, opId */) {
  return typeof appOrigin === 'string' && appOrigin.length > 0 && !LOCAL_APP_ORIGINS.has(appOrigin);
}

/**
 * @param {(appOrigin:string, opId:string, args:object)=>Promise<any>} callSkill  the underlying dispatch
 * @param {object} o
 * @param {Set<string>|((op:string)=>boolean)} [o.isExternalEgress]  which ops send data to an external service
 * @param {(appOrigin:string, opId:string, args:object)=>({request:object, released:object, contextType?:string}|null)} o.gateInputs
 *        build the gate inputs for an external op: the consumer's Request, the user's disclosed values
 *        (releasedValues(...)), and an optional governed context type. Return null/undefined ⇒ nothing to gate.
 * @param {(receipt:object)=>void} [o.onReceipt]  surface the zero-disclosure receipt / governed banner
 * @param {object} [o.policyTable]  governed-request policy table (defaults inside gateEgress)
 * @param {object} [o.vocabulary]   a createVocabulary(...) for the governed check
 * @returns {(appOrigin:string, opId:string, args:object)=>Promise<any>}  a wrapped callSkill
 */
export function wrapCallSkillWithEgressGate(callSkill, { isExternalEgress, gateInputs, onReceipt, policyTable, vocabulary } = {}) {
  const isExternal = typeof isExternalEgress === 'function'
    ? isExternalEgress
    : (_appOrigin, opId) => (isExternalEgress instanceof Set ? isExternalEgress.has(opId) : false);

  return async function gatedCallSkill(appOrigin, opId, args) {
    if (!isExternal(appOrigin, opId) || typeof gateInputs !== 'function') return callSkill(appOrigin, opId, args);

    const inputs = gateInputs(appOrigin, opId, args);
    if (!inputs || !inputs.request) return callSkill(appOrigin, opId, args);   // nothing declared → pass through

    const { allow, payload, receipt } = gateEgress({
      request: inputs.request, released: inputs.released, contextType: inputs.contextType, policyTable, vocabulary,
    });
    try { onReceipt?.(receipt); } catch { /* receipt/banner surfacing is best-effort — never block the call */ }

    // A governed-forbidden ask is BLOCKED — nothing leaves, the underlying op is never invoked.
    if (!allow) return { ok: false, error: 'egress-blocked', reason: 'governed-forbidden', receipt };

    // Only the gated payload (the coarse released set) travels — attach it under `_egress` for the external op.
    return callSkill(appOrigin, opId, { ...(args ?? {}), _egress: payload });
  };
}
