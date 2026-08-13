/**
 * basis — composite-op runner + verifier (feedback-extension).
 *
 * The keystone primitive for "a slash-command that is merely a composite":
 * a new opId is defined — as pure DATA in a manifest — as a sequence of
 * EXISTING opIds (`op.steps`, see `@onderling/app-manifest` schema).  This
 * file runs that sequence and verifies it.
 *
 * Two pure functions, mirroring `bulkOps.js`/`dispatch.js`:
 *
 *   - `runCompositeOp(op, callSkill, ctx)` — runs `op.steps` sequentially,
 *     threading each step's RESULT forward into the next step's args via
 *     `argRef` (`from` = prior step index, `path` = dot-path into that
 *     result).  Best-effort, NO rollback (v0 non-goal); honours
 *     `op.onError` ('stop' default | 'continue').
 *
 *   - `verifyComposite(op, catalog) -> { ok, missing }` — the SANDBOX-BY-
 *     CONSTRUCTION fitness function (DESIGN §2.3): asserts every step's
 *     opId resolves in the merged catalog.  A composite that references an
 *     unknown opId is refused — at load time (reject the mapping) and in
 *     CI (reject first-party drift).  Exported so CI can reuse it.
 *
 * The runner is shared `src/` (NOT a shell), per CLAUDE.md invariant #1
 * (logic lives once) + DESIGN §2.1 (composite runner → `apps/basis/
 * src/`, migrate to `manifest-host` at the repo split).
 *
 * Since the flows substrate landed, a composite EXECUTES as a compiled flow on the one
 * flow runner (see `compileCompositeToFlow` + `runCompositeOp`) — `op.steps` stays as the
 * extension arc's linear declaration sugar; the execution engine lives once.
 */

import { createFlowRunner } from '@onderling/app-manifest';

/**
 * @typedef {object} CompositeStepResult
 * @property {number}              index       step index (0-based)
 * @property {string}              appOrigin
 * @property {string}              opId
 * @property {object}              args        the args the step was called with
 * @property {*}                   [payload]   the step's return value (on success)
 * @property {boolean}             ok          true when the step succeeded
 * @property {{code: string, message: string}} [error]  set when ok === false
 */

/**
 * @typedef {object} CompositeResult
 * @property {boolean}             ok          true when EVERY run step succeeded
 * @property {CompositeStepResult[]} steps     per-step results, in run order
 * @property {*}                   payload     the LAST successful step's payload
 *                                             (the composite's aggregate result)
 * @property {{total: number, ok: number, failed: number, ran: number}} stats
 * @property {{code: string, message: string}} [error]  first failing step's error
 *                                             (only when the composite is not ok)
 */

/**
 * Resolve a dot-path into a value.  Returns `undefined` for any missing
 * link (no throw) so `argRef` against an absent field degrades gracefully.
 *
 * @param {*}      obj
 * @param {string} path  e.g. 'item.id' or 'items.0.id'
 * @returns {*}
 */
export function resolvePath(obj, path) {
  if (obj == null || typeof path !== 'string' || path === '') return undefined;
  let cur = obj;
  for (const seg of path.split('.')) {
    if (cur == null) return undefined;
    cur = cur[seg];
  }
  return cur;
}

/**
 * COMPILE a composite op to a flow declaration (the reconciliation: flows are the declared
 * generalization, and a composite is the LINEAR SUGAR the extension arc keeps — it compiles
 * onto the ONE flow runner, so there is exactly one pipeline execution engine).
 *
 * The mapping, per composite semantic:
 *   - steps s0..sN linear; a step's outcome routes `error → stop-or-continue`, anything
 *     else proceeds (a composite treats every non-failure result as success);
 *   - `ctx` merged UNDER each step's args → per-step literal bindings, step args win;
 *   - `argRef` → an OPTIONAL `$steps.s<i>.<path>` binding (absent path ⇒ arg simply
 *     omitted — the composite's graceful-degrade contract);
 *   - step appOrigin rides as the qualified op id `<appOrigin>/<opId>`; the runner's
 *     callSkill wrapper splits it back out.
 *
 * Pure; compiled per run (`ctx` is only known then — composites are small).
 *
 * @param {import('@onderling/app-manifest').Operation} op
 * @param {object} ctx
 * @returns {object}  a Flow (see @onderling/app-manifest flows.js)
 */
export function compileCompositeToFlow(op, ctx = {}) {
  const onError = op.onError === 'continue' ? 'continue' : 'stop';
  const baseCtx = ctx && typeof ctx === 'object' ? ctx : {};
  const steps = op.steps.map((step, i) => {
    const bind = {};
    for (const [k, v] of Object.entries(baseCtx)) bind[k] = { value: v };
    for (const [k, v] of Object.entries(step.args ?? {})) bind[k] = { value: v };
    const ref = step.argRef;
    if (ref && typeof ref === 'object' && typeof ref.from === 'number') {
      const segs = (ref.path ?? '').split('.');
      const key  = ref.as || segs[segs.length - 1];
      if (key) bind[key] = { from: `$steps.s${ref.from}.${ref.path}`, optional: true };
    }
    const nextId = i === op.steps.length - 1 ? null : `s${i + 1}`;
    return {
      id: `s${i}`,
      op: `${step.appOrigin}/${step.opId}`,
      bind,
      next: onError === 'continue' ? { else: nextId } : { error: null, else: nextId },
    };
  });
  return { id: `composite:${op.id ?? 'anon'}`, kind: 'composite', scope: 'device', steps };
}

/**
 * Run a composite op's steps sequentially, threading results via `argRef`.
 *
 * Since the flows substrate landed this COMPILES to a flow and executes on the ONE flow
 * runner (`createFlowRunner`) — the sequential loop this file used to own was a parallel
 * pipeline system, and the no-parallel-structures rule retires it. The public contract is
 * unchanged: same signature, same `CompositeResult` envelope (adapted back from the flow
 * instance), ephemeral execution (no instance persistence, no pauses — the runner's
 * awaiting-input machinery only engages when an `ops` catalog is supplied, and a composite
 * deliberately runs without one: an unsatisfied param is the op's own failure to report).
 *
 * Best-effort, no rollback (v0).  `onError`:
 *   - 'stop' (default) → stop at the first failing step; remaining steps
 *     are NOT run (they're absent from `result.steps`).
 *   - 'continue' → run every step regardless; failures are recorded.
 *
 * A step "fails" when `callSkill` throws OR returns the `{ok: false, error}`
 * envelope (same convention as `runDispatch`/`runBulkOp`).
 *
 * @param {import('@onderling/app-manifest').Operation}  op   must have `op.steps`
 * @param {import('./dispatch.js').CallSkill}         callSkill
 * @param {object} [ctx]   extra args merged UNDER each step's args (e.g. the
 *                         active threadId/circle scope); a step's own args win.
 * @returns {Promise<CompositeResult>}
 */
export async function runCompositeOp(op, callSkill, ctx = {}) {
  if (!op || typeof op !== 'object' || !Array.isArray(op.steps)) {
    throw new TypeError('runCompositeOp: op.steps must be an array');
  }
  if (typeof callSkill !== 'function') {
    throw new TypeError('runCompositeOp: callSkill must be a function');
  }

  const flow = compileCompositeToFlow(op, ctx);

  // The runner's callSkill is app-bound; a composite's steps cross apps, so the wrapper
  // splits the qualified id back into (appOrigin, opId). Throws are normalized here (not
  // in the runner's catch) to keep the thrown error's `code` on the envelope.
  const capturedArgs = [];
  const runner = createFlowRunner({
    callSkill: async (qualified, args) => {
      const cut = qualified.indexOf('/');
      capturedArgs.push(args);
      try {
        return await callSkill(qualified.slice(0, cut), qualified.slice(cut + 1), args);
      } catch (err) {
        return {
          ok: false,
          outcome: 'error',
          error: { code: err?.code ?? 'composite-step-error', message: err?.message ?? String(err) },
          __thrown: true,
        };
      }
    },
  });

  const instance = await runner.start(flow, {});

  // Adapt the flow instance back into the CompositeResult envelope.
  /** @type {CompositeStepResult[]} */
  const steps = [];
  let lastOkPayload = null;
  let firstError = null;
  for (let i = 0; i < op.steps.length; i += 1) {
    const rec = instance.steps[`s${i}`];
    if (!rec) break; // stop-mode: never ran
    const src = op.steps[i];
    const base = { index: i, appOrigin: src.appOrigin, opId: src.opId, args: capturedArgs[i] ?? {} };
    if (rec.outcome === 'error') {
      const out = rec.out;
      const error = out?.__thrown
        ? out.error
        : {
            code:    'composite-step-error',
            message: typeof out?.error === 'string' ? out.error : (out?.error?.message ?? 'Step failed'),
          };
      const entry = { ...base, ok: false, error };
      if (!out?.__thrown) entry.payload = out;
      steps.push(entry);
      if (!firstError) firstError = error;
    } else {
      steps.push({ ...base, ok: true, payload: rec.out });
      lastOkPayload = rec.out;
    }
  }

  const okCount     = steps.filter((s) => s.ok).length;
  const failedCount = steps.length - okCount;
  const ok          = failedCount === 0;

  /** @type {CompositeResult} */
  const result = {
    ok,
    steps,
    payload: lastOkPayload,
    stats: {
      total:  op.steps.length,
      ran:    steps.length,
      ok:     okCount,
      failed: failedCount,
    },
  };
  if (!ok && firstError) result.error = firstError;
  return result;
}

/**
 * The composite VERIFIER (DESIGN §2.3 — sandbox-by-construction).
 *
 * A composite is valid only when EVERY step's opId resolves to a declared
 * op in the merged catalog.  Refuse a composite whose steps reference
 * unknown opIds — this is what makes loading a THIRD-PARTY mapping safe
 * (it can only ever bottom out in atoms already present + consented).
 *
 * Pure.  Exported so CI can run it as a fitness function over first-party
 * manifests (reject drift) and the load-time mapping loader can run it to
 * reject an unsatisfiable extension.
 *
 * Resolution is forgiving of the catalog's prefix-on-collision policy
 * (`manifestMerge.js`): a step resolves when EITHER the bare `opId` OR the
 * app-qualified `'<appOrigin>/<opId>'` key is present in the catalog.
 *
 * @param {import('@onderling/app-manifest').Operation} op   the composite op
 * @param {{ opsById: Map<string, {op: object, appOrigin: string}> } | { has?: Function }} catalog
 *        a `MergedCatalog` (uses `.opsById`) or any object exposing
 *        `has(opId)` / `opsById`.
 * @returns {{ ok: boolean, missing: string[] }}
 *        `missing` lists the unresolved `'<appOrigin>/<opId>'` refs.
 */
export function verifyComposite(op, catalog) {
  if (!op || !Array.isArray(op.steps)) {
    // Not a composite → nothing to verify; trivially ok.
    return { ok: true, missing: [] };
  }
  const has = catalogHas(catalog);
  const missing = [];
  for (const step of op.steps) {
    const opId      = step?.opId;
    const appOrigin = step?.appOrigin;
    const qualified = appOrigin ? `${appOrigin}/${opId}` : opId;
    if (!opId || !(has(opId) || (appOrigin && has(qualified)))) {
      missing.push(qualified ?? String(opId));
    }
  }
  return { ok: missing.length === 0, missing };
}

/**
 * Adapt a catalog into a `has(opId) -> boolean` probe.  Accepts a
 * `MergedCatalog` (`.opsById` Map), a bare `Map`/`Set`, or an object with
 * its own `has`.
 *
 * @param {*} catalog
 * @returns {(opId: string) => boolean}
 */
function catalogHas(catalog) {
  if (!catalog) return () => false;
  if (catalog.opsById instanceof Map) {
    const m = catalog.opsById;
    return (id) => m.has(id);
  }
  if (catalog instanceof Map || catalog instanceof Set) {
    return (id) => catalog.has(id);
  }
  if (typeof catalog.has === 'function') {
    return (id) => catalog.has(id);
  }
  return () => false;
}
