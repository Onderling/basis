/**
 * flows — the declared multi-step layer ABOVE ops (ledger L7, ratified 2026-08-12).
 *
 * A flow is a DECLARED DAG of steps. Each step references an opId (anything effectful or
 * observable is an op — pure arg-gathering is the projector's form, never a step kind) or a
 * flowId (one nesting level; acyclic ACROSS expansion). Data moves by DECLARED PATH BINDINGS
 * (`$flow.needs.x` / `$steps.<id>.<name>`) — no expression language: the moment something is
 * computational, it is an op. Branching is declared outcome→next edges (restore proves the
 * need: its probe branches three ways). The flow INSTANCE at runtime is a typed item with a
 * `scope` (device-local instances must never sync) — and THE SECRETS RULE binds here at
 * declare time: a secret-kind value may only travel BY REFERENCE (a handle the substrate
 * resolves inside its own boundary), and a flow may never PRODUCE a secret by value.
 *
 * This module is the DECLARATION + LOAD-TIME VERIFIER only (the verifyMapping/verifyComposite
 * pattern: loud at declare/install, cheap at run). The runner and the one flow projector live
 * with the composition (and reconcile with the composite-op machinery — never two parallel
 * pipeline systems).
 *
 * @typedef {object} Flow
 * @property {string} id            stable flow id (namespaced by the owning manifest's app)
 * @property {string} [kind]        optional classifier (e.g. 'ceremony', 'wizard')
 * @property {'device'|'circle'} [scope='device']  where instances live; device NEVER syncs
 * @property {FlowStep[]} steps     declaration order; steps[0] is the entry
 * @property {import('./schema.js').Param[]} [needs]     inputs + preconditions
 * @property {Array<{name:string, kind?:string}>} [produces]  outputs (kind 'secret' forbidden)
 * @property {Array<{kind:string, target?:string}>} [effects] declared world-changes — the
 *           honesty layer: drives the consent surface + irreversible-confirm policy + trail
 * @property {string} [version]     bumped when steps change; the runner restarts a resumed
 *           instance whose version differs
 *
 * @typedef {object} FlowStep
 * @property {string} id
 * @property {string} [op]          the opId this step executes (op-step)
 * @property {string} [flow]        the flowId this step runs (flow-ref step; one level deep)
 * @property {Object<string, Binding>} [bind]  param name → binding
 * @property {Object<string, string|null>} [next]  outcome → next step id (null = flow ends);
 *           a step with NO `next` ends the flow after it
 *
 * @typedef {object} Binding
 * @property {string} [from]   by-VALUE path: '$flow.needs.<name>' | '$steps.<stepId>.<name>'
 * @property {string} [ref]    by-REFERENCE path (same grammar) — REQUIRED for secret kinds
 * @property {*}      [value]  literal
 */

const PATH_RE = /^\$(flow\.needs|steps\.[A-Za-z0-9_-]+)\.[A-Za-z0-9_.-]+$/;

/** One binding: exactly one of from/ref/value. */
function bindingMode(b) {
  const modes = ['from', 'ref', 'value'].filter((k) => b != null && b[k] !== undefined);
  return modes.length === 1 ? modes[0] : null;
}

function pathParts(p) {
  // '$steps.probe.status' → {root:'steps', id:'probe', name:'status'} · '$flow.needs.x' → {root:'flow', name:'x'}
  const m = /^\$flow\.needs\.(.+)$/.exec(p);
  if (m) return { root: 'flow', name: m[1] };
  const s = /^\$steps\.([A-Za-z0-9_-]+)\.(.+)$/.exec(p);
  if (s) return { root: 'steps', id: s[1], name: s[2] };
  return null;
}

/**
 * Verify ONE flow against its manifest context. Pure; returns every problem, not the first.
 *
 * @param {Flow} flow
 * @param {object} ctx
 * @param {Map<string, object>|Object<string,object>} ctx.ops    opId → operation (the manifest's,
 *        already composed — the verifier does not resolve app prefixes)
 * @param {Map<string, Flow>|Object<string,Flow>} [ctx.flows]    flowId → flow (for flow-ref steps)
 * @param {(kind: string) => boolean} [ctx.isSecretKind]         default: kind === 'secret'
 * @returns {{ok: boolean, problems: string[]}}
 */
export function verifyFlow(flow, { ops, flows, isSecretKind } = {}) {
  const problems = [];
  const P = (msg) => problems.push(`flow "${flow?.id ?? '?'}": ${msg}`);
  const opOf = (id) => (ops instanceof Map ? ops.get(id) : ops?.[id]);
  const flowOf = (id) => (flows instanceof Map ? flows.get(id) : flows?.[id]);
  const secret = typeof isSecretKind === 'function' ? isSecretKind : (k) => k === 'secret';

  if (!flow || typeof flow.id !== 'string' || !flow.id) return { ok: false, problems: ['flow: missing id'] };
  const steps = Array.isArray(flow.steps) ? flow.steps : [];
  if (!steps.length) P('no steps');
  if (flow.scope !== undefined && flow.scope !== 'device' && flow.scope !== 'circle') P(`unknown scope "${flow.scope}"`);

  // produces may not carry a secret by value — a flow instance persists its outputs.
  for (const pr of flow.produces ?? []) {
    if (pr && secret(pr.kind)) P(`produces "${pr.name}" is secret-kind — a flow may not produce a secret by value`);
  }
  for (const ef of flow.effects ?? []) {
    if (!ef || typeof ef.kind !== 'string' || !ef.kind) P('effects entries need a kind');
  }

  // step table + uniqueness
  const byId = new Map();
  for (const s of steps) {
    if (!s || typeof s.id !== 'string' || !s.id) { P('a step is missing its id'); continue; }
    if (byId.has(s.id)) P(`duplicate step id "${s.id}"`);
    byId.set(s.id, s);
  }

  const needsByName = new Map((flow.needs ?? []).map((n) => [n?.name, n]));

  for (const s of byId.values()) {
    // exactly one of op | flow
    const isOp = typeof s.op === 'string' && s.op;
    const isFlow = typeof s.flow === 'string' && s.flow;
    if (!!isOp === !!isFlow) { P(`step "${s.id}" must reference exactly one of op|flow`); continue; }
    const target = isOp ? opOf(s.op) : flowOf(s.flow);
    if (!target) P(`step "${s.id}" references ${isOp ? `unknown op "${s.op}"` : `unknown flow "${s.flow}"`}`);
    if (isFlow && target && Array.isArray(target.steps) && target.steps.some((t) => typeof t?.flow === 'string')) {
      P(`step "${s.id}" nests flow "${s.flow}" which itself nests a flow — one nesting level (raise the cap on real need)`);
    }
    // next targets exist
    for (const [outcome, to] of Object.entries(s.next ?? {})) {
      if (to !== null && !byId.has(to)) P(`step "${s.id}" next["${outcome}"] → unknown step "${to}"`);
    }
    // bindings: mode + path grammar + resolvable source + the secrets rule against the op's params
    const params = isOp && target ? new Map((target.params ?? []).map((p) => [p?.name, p])) : null;
    for (const [name, b] of Object.entries(s.bind ?? {})) {
      const mode = bindingMode(b);
      if (!mode) { P(`step "${s.id}" bind "${name}": exactly one of from|ref|value`); continue; }
      if ((mode === 'from' || mode === 'ref')) {
        const path = b[mode];
        if (typeof path !== 'string' || !PATH_RE.test(path)) { P(`step "${s.id}" bind "${name}": bad path "${path}"`); continue; }
        const pp = pathParts(path);
        if (pp.root === 'flow' && !needsByName.has(pp.name)) P(`step "${s.id}" bind "${name}": $flow.needs.${pp.name} is not declared`);
        if (pp.root === 'steps' && !byId.has(pp.id)) P(`step "${s.id}" bind "${name}": source step "${pp.id}" does not exist`);
        if (pp.root === 'steps' && pp.id === s.id) P(`step "${s.id}" bind "${name}": a step cannot bind from itself`);
        // secrets: a secret-kind SOURCE (declared need) may only travel by-ref
        if (pp.root === 'flow') {
          const need = needsByName.get(pp.name);
          if (need && secret(need.kind) && mode !== 'ref') P(`step "${s.id}" bind "${name}": secret-kind "${pp.name}" must bind by ref`);
        }
      }
      // secrets: a secret-kind op PARAM may only be bound by-ref, never by value/literal
      if (params && params.has(name) && secret(params.get(name)?.kind) && mode !== 'ref') {
        P(`step "${s.id}" bind "${name}": op param is secret-kind — bind by ref`);
      }
    }
  }

  // acyclicity over declared next-edges (+ the implicit "no edge = end"); DFS with colour marks
  const WHITE = 0; const GREY = 1; const BLACK = 2;
  const colour = new Map([...byId.keys()].map((k) => [k, WHITE]));
  const dfs = (id, trail) => {
    colour.set(id, GREY);
    const s = byId.get(id);
    for (const to of Object.values(s?.next ?? {})) {
      if (to === null || !byId.has(to)) continue;
      if (colour.get(to) === GREY) P(`cycle: ${[...trail, id, to].join(' → ')} (flows are DAGs; loops only as explicit retry markers)`);
      else if (colour.get(to) === WHITE) dfs(to, [...trail, id]);
    }
    colour.set(id, BLACK);
  };
  if (steps.length && byId.size) dfs(steps[0].id, []);
  // unreachable steps (never targeted, not the entry)
  const targeted = new Set([steps[0]?.id]);
  for (const s of byId.values()) for (const to of Object.values(s.next ?? {})) if (to) targeted.add(to);
  for (const id of byId.keys()) if (!targeted.has(id)) P(`step "${id}" is unreachable from the entry`);

  return { ok: problems.length === 0, problems };
}

/**
 * Verify a manifest's whole `flows[]` block (ids unique across the block; each flow verified
 * with the block as the flow-ref index).
 *
 * @param {{operations?: object[], flows?: Flow[]}} manifest
 * @param {object} [opts]  forwarded to verifyFlow (isSecretKind)
 * @returns {{ok: boolean, problems: string[]}}
 */
export function verifyFlows(manifest, opts = {}) {
  const flows = Array.isArray(manifest?.flows) ? manifest.flows : [];
  const problems = [];
  const ops = new Map((manifest?.operations ?? []).map((op) => [op?.id, op]));
  const index = new Map();
  for (const f of flows) {
    if (f?.id && index.has(f.id)) problems.push(`duplicate flow id "${f.id}"`);
    if (f?.id) index.set(f.id, f);
  }
  for (const f of flows) {
    const r = verifyFlow(f, { ops, flows: index, ...opts });
    problems.push(...r.problems);
  }
  return { ok: problems.length === 0, problems };
}
