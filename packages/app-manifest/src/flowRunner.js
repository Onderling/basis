/**
 * flowRunner — executes a DECLARED flow (see flows.js) as a resumable instance.
 *
 * Pure and dependency-injected: the composition hands in `callSkill` (already bound to the
 * owning app — every step executes through the waist), an instance persistence seam, and ids.
 * The runner owns ONLY traversal + binding resolution + the instance record; it renders
 * nothing (the projector's job) and resolves no secrets (the substrate's job).
 *
 * ── The instance record vs the TRANSIENT map (the secrets rule at runtime) ──────────────────
 * The instance is a persistable record: `{id, flowId, version, scope, status, at, steps,
 * produces}` — saved after EVERY step, which is what makes resume-after-interruption real.
 * Secret-kind needs NEVER enter it: they live in the caller-held `transient` map, are resolved
 * only at the moment a step executes, and by-`ref` bindings pass through as-is. `saveInstance`
 * therefore never sees secret material — pinned by test, mirroring the declare-time rule.
 *
 * ── Statuses ────────────────────────────────────────────────────────────────────────────────
 *   running → (saved between steps) → done | failed | awaiting-input | cancelled
 *   awaiting-input: the next step's op declares required params the bindings don't satisfy —
 *   the projector renders a form for `needs` and calls `resume(..., {input})`. Input is used
 *   for the CURRENT step only and is not persisted by the runner (the executed step's OUTPUT
 *   is — outputs are the record; inputs may be secrets).
 *   Version drift on resume (flow.version ≠ instance.version) → the instance RESTARTS
 *   (status back to running, step record cleared) — resuming into changed steps is the bug.
 */

/** Outcome of an op result: explicit `outcome` wins; else ok:false → 'error'; else 'ok'. */
function outcomeOf(result) {
  if (result && typeof result.outcome === 'string' && result.outcome) return result.outcome;
  return result && result.ok === false ? 'error' : 'ok';
}

function resolvePath(path, { flow, instance, transient }) {
  const flowNeed = /^\$flow\.needs\.(.+)$/.exec(path);
  if (flowNeed) {
    const name = flowNeed[1];
    if (transient && name in transient) return { found: true, value: transient[name] };
    const rec = instance.needs ?? {};
    return name in rec ? { found: true, value: rec[name] } : { found: false };
  }
  const stepOut = /^\$steps\.([A-Za-z0-9_-]+)\.(.+)$/.exec(path);
  if (stepOut) {
    const out = instance.steps?.[stepOut[1]]?.out;
    if (out == null) return { found: false };
    // dotted tail walks into the output object ('conflicts' or 'result.count')
    let v = out;
    for (const part of stepOut[2].split('.')) {
      if (v == null || typeof v !== 'object' || !(part in v)) return { found: false };
      v = v[part];
    }
    return { found: true, value: v };
  }
  return { found: false };
}

const isSecretDefault = (k) => k === 'secret';

/**
 * @param {object} deps
 * @param {(opId: string, args: object) => Promise<any>} deps.callSkill  bound to the owning app
 * @param {(instance: object) => Promise<void>|void} [deps.saveInstance] persistence seam —
 *        called after every step and on every terminal status; never receives secrets
 * @param {() => string} [deps.genId]
 * @param {(kind: string) => boolean} [deps.isSecretKind]
 * @param {(flowId: string) => import('./flows.js').Flow|undefined} [deps.flowById]  for flow-ref steps
 * @param {Map<string,object>|Object<string,object>} [deps.ops]  opId → operation — enables the
 *        awaiting-input round-trip (required declared params the bindings did not satisfy)
 */
export function createFlowRunner({ callSkill, saveInstance, genId, isSecretKind, flowById, ops } = {}) {
  if (typeof callSkill !== 'function') throw new Error('createFlowRunner: callSkill required');
  const save = typeof saveInstance === 'function' ? saveInstance : () => {};
  const id = typeof genId === 'function' ? genId : () => `flow-${Math.random().toString(36).slice(2, 10)}`;
  const secret = typeof isSecretKind === 'function' ? isSecretKind : isSecretDefault;
  const opOf = (opId) => (ops instanceof Map ? ops.get(opId) : ops?.[opId]);

  /** Split provided needs: persistable → instance record; secret-kind → caller's transient map. */
  function splitNeeds(flow, needs = {}) {
    const record = {}; const transient = {};
    for (const decl of flow.needs ?? []) {
      if (!(decl.name in needs)) continue;
      (secret(decl.kind) ? transient : record)[decl.name] = needs[decl.name];
    }
    return { record, transient };
  }

  async function execute(flow, instance, { transient = {}, input } = {}) {
    const byId = new Map(flow.steps.map((s) => [s.id, s]));
    let firstStep = true;
    while (instance.at) {
      const step = byId.get(instance.at);
      if (!step) { instance.status = 'failed'; instance.reason = `unknown-step:${instance.at}`; break; }

      // resolve bindings → args (by-ref passes the PATH's value through untouched — for a
      // secret need that value is the transient handle/material, used now, persisted never)
      const args = {};
      let missing = null;
      for (const [name, b] of Object.entries(step.bind ?? {})) {
        if (b.value !== undefined) { args[name] = b.value; continue; }
        const r = resolvePath(b.from ?? b.ref, { flow, instance, transient });
        if (r.found) args[name] = r.value;
        else if (!b.optional) (missing ??= []).push(name);
      }
      // input satisfies THIS step only (the awaiting-input round-trip); never persisted here
      if (input && firstStep) Object.assign(args, input);
      firstStep = false;

      if (missing && missing.length) { instance.status = 'failed'; instance.reason = `unresolved-binding:${missing.join(',')}`; break; }

      // op-step vs one-level flow-ref
      let result;
      if (step.flow) {
        const sub = flowById?.(step.flow);
        if (!sub) { instance.status = 'failed'; instance.reason = `unknown-flow:${step.flow}`; break; }
        const subRun = await start(sub, { needs: args, transient });
        result = subRun.status === 'done' ? { ok: true, outcome: 'ok', ...subRun.produces } : { ok: false, outcome: subRun.status };
      } else {
        // awaiting-input: a required declared param the bindings didn't produce
        const op = opOf(step.op);
        const required = (op?.params ?? []).filter((p) => p?.required && !(p.name in args));
        if (required.length) {
          instance.status = 'awaiting-input';
          instance.awaiting = { step: step.id, params: required.map((p) => ({ name: p.name, kind: p.kind })) };
          await save(instance);
          return instance;
        }
        try { result = await callSkill(step.op, args); }
        catch (e) { result = { ok: false, outcome: 'error', error: e?.message ?? String(e) }; }
      }

      const outcome = outcomeOf(result);
      instance.steps[step.id] = { outcome, out: result ?? null };
      delete instance.awaiting;

      if (step.next && Object.keys(step.next).length) {
        const to = outcome in step.next ? step.next[outcome]
          : ('else' in step.next ? step.next.else : undefined);
        if (to === undefined) { instance.status = 'failed'; instance.reason = `unmapped-outcome:${step.id}:${outcome}`; break; }
        instance.at = to;                       // null = declared end
        if (to === null) instance.status = 'done';
      } else {
        instance.at = null;
        instance.status = 'done';
      }
      await save(instance);
    }
    if (instance.status === 'running') instance.status = 'done';
    if (instance.status === 'done' && Array.isArray(flow.produces)) {
      instance.produces = {};
      for (const pr of flow.produces) {
        if (pr?.from) {
          const r = resolvePath(pr.from, { flow, instance, transient });
          if (r.found) instance.produces[pr.name] = r.value;
        }
      }
    }
    await save(instance);
    return instance;
  }

  /** Start a fresh instance. `needs` are split per the secrets rule; secrets ride `transient`. */
  async function start(flow, { needs = {}, transient: extraTransient = {} } = {}) {
    const { record, transient } = splitNeeds(flow, needs);
    Object.assign(transient, extraTransient);
    const instance = {
      id: id(), flowId: flow.id, version: flow.version ?? null,
      scope: flow.scope ?? 'device',
      status: 'running', at: flow.steps?.[0]?.id ?? null, steps: {}, needs: record,
    };
    if (!instance.at) { instance.status = 'failed'; instance.reason = 'no-steps'; await save(instance); return instance; }
    return execute(flow, instance, { transient });
  }

  /** Resume a persisted instance; version drift restarts it (never resume into changed steps). */
  async function resume(flow, instance, { transient = {}, input } = {}) {
    if ((flow.version ?? null) !== (instance.version ?? null)) {
      instance.version = flow.version ?? null;
      instance.status = 'running';
      instance.steps = {};
      instance.at = flow.steps?.[0]?.id ?? null;
      delete instance.awaiting;
      delete instance.reason;
      return execute(flow, instance, { transient });
    }
    if (instance.status === 'awaiting-input') instance.status = 'running';
    return execute(flow, instance, { transient, input });
  }

  function cancel(instance) { instance.status = 'cancelled'; instance.at = null; return save(instance), instance; }

  return { start, resume, cancel };
}
