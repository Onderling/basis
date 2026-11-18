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

// Which apps reach OUTSIDE: the ones whose manifest declares the reserved host `'@placed'` (the hosts a box's operator
// places as toolboxes; none is fixed in the code). Derived from the manifests, never a hand list: the gate's list and the
// manifests agree by construction (a hand list of LOCAL origins used to stand here and had gone stale: lists, assistant
// and params were missing from it, so wrapping the waist would have gated them). Ledger L1035.
import { allManifests } from '../../v2/manifestSources.js';

/** The reserved host word: "the hosts a box's operator places" (docs/conventions/manifest-standard.md). */
export const PLACED_HOSTS = '@placed';

/** The app origins whose manifest declares `'@placed'`. */
export function externalOrigins(manifests = allManifests()) {
  return new Set((Array.isArray(manifests) ? manifests : []).filter((m) => Array.isArray(m?.hosts) && m.hosts.includes(PLACED_HOSTS)).map((m) => m.app));
}

/**
 * Does a call to this origin reach outside? Its manifest declares `'@placed'`, OR no manifest declares the origin at all
 * (fail-safe: an unrecognised target is gated, not trusted). Every known app that declares no placed host is local.
 */
export function isExternalEgressOp(appOrigin, _opId, manifests = allManifests()) {
  if (typeof appOrigin !== 'string' || !appOrigin) return false;
  const known = new Set((Array.isArray(manifests) ? manifests : []).map((m) => m?.app).filter(Boolean));
  return externalOrigins(manifests).has(appOrigin) || !known.has(appOrigin);
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
export function wrapCallSkillWithEgressGate(callSkill, { isExternalEgress, gateInputs, onReceipt, policyTable, vocabulary, toolCall = null } = {}) {
  const isExternal = typeof isExternalEgress === 'function'
    ? isExternalEgress
    : (_appOrigin, opId) => (isExternalEgress instanceof Set ? isExternalEgress.has(opId) : false);
  // the call's context (who asks, through which door, in which language) travels on, never dropped
  const call = (a, o, x, ctx) => (ctx === undefined ? callSkill(a, o, x) : callSkill(a, o, x, ctx));
  const toolOps = new Set(toolCall?.ops ?? ['useTool']);

  return async function gatedCallSkill(appOrigin, opId, args, ctx) {
    if (!isExternal(appOrigin, opId)) return call(appOrigin, opId, args, ctx);

    // A TOOLBOX'S TOOL (L1035): exactly the tool and its input leave; a toolbox that is not on is refused before the
    // call; every call is recorded (who, which toolbox, which tool, how it ended), never the words.
    if (toolCall && toolOps.has(opId)) {
      const { toolbox, tool, input } = args ?? {};
      const note = (outcome) => { try { toolCall.record?.({ person: ctx?.caller ?? ctx?.person ?? null, toolbox: toolbox ?? null, tool: tool ?? null, outcome }); } catch { /* the record never breaks a call */ } };
      if (typeof toolCall.isOn === 'function' && !(await toolCall.isOn(toolbox))) { note('refused'); return { ok: false, code: 'toolbox-off', name: toolbox ?? '' }; }
      let res;
      try { res = await call(appOrigin, opId, { toolbox, tool, ...(input !== undefined ? { input } : {}) }, ctx); } catch (e) { note('failed'); throw e; }
      note(res?.ok === false ? (res?.code === 'toolbox-off' || res?.code === 'tool-not-offered' || res?.code === 'toolbox-no-key' ? 'refused' : 'failed') : 'ok');
      return res;
    }
    if (typeof gateInputs !== 'function') return call(appOrigin, opId, args, ctx);

    const inputs = gateInputs(appOrigin, opId, args);
    if (!inputs || !inputs.request) return call(appOrigin, opId, args, ctx);   // nothing declared → pass through

    const { allow, payload, receipt } = gateEgress({
      request: inputs.request, released: inputs.released, contextType: inputs.contextType, policyTable, vocabulary,
    });
    try { onReceipt?.(receipt); } catch { /* receipt/banner surfacing is best-effort — never block the call */ }

    // A governed-forbidden ask is BLOCKED — nothing leaves, the underlying op is never invoked.
    if (!allow) return { ok: false, error: 'egress-blocked', reason: 'governed-forbidden', receipt };

    // Only the gated payload (the coarse released set) travels — attach it under `_egress` for the external op.
    return call(appOrigin, opId, { ...(args ?? {}), _egress: payload }, ctx);
  };
}
