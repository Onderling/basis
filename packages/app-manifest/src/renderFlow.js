/**
 * renderFlow — THE ONE FLOW PROJECTOR (the wizard machinery, generalized).
 *
 * Given a declared flow (flows.js) + a runner instance (flowRunner.js), produce the pure
 * VIEW MODEL both shells paint — the same move renderWeb makes for screens: the hand-written
 * per-wizard state modules + per-shell render layers collapse into declaration + this
 * projection + a thin painter per platform (web ≡ mobile by construction).
 *
 * The model answers exactly what a wizard surface needs:
 *   • progress — the declared steps with a display state: done | current | pending | skipped
 *     (skipped = a branch not taken, visible only once the flow is terminal — an honest
 *     progress bar never pretends an untaken branch was walked);
 *   • form — when the instance is awaiting-input: the params to collect, each with a
 *     deterministic labelKey (`flow.<flowId>.<step>.<param>`, overridable by the op param's
 *     own labelKey) so every string routes through t() (invariant 8);
 *   • actions — canSubmit / canCancel / canRestart, derived from status alone;
 *   • outcome — status, reason, produces.
 *
 * Pure and total: any instance state yields a model; no DOM, no RN, no t() calls here —
 * the shells resolve labelKeys.
 */

/**
 * @param {import('./flows.js').Flow} flow
 * @param {object|null} instance   a flowRunner instance (null = not started)
 * @param {object} [ctx]
 * @param {Map<string,object>|Object<string,object>} [ctx.ops]  opId → operation, for param labelKeys
 * @returns {{
 *   id: string, labelKey: string, status: string,
 *   progress: Array<{id: string, labelKey: string, state: 'done'|'current'|'pending'|'skipped'}>,
 *   form: null|{step: string, params: Array<{name: string, kind?: string, labelKey: string, required: boolean}>},
 *   actions: {canSubmit: boolean, canCancel: boolean, canRestart: boolean},
 *   reason: string|null,
 *   produces: object|null,
 * }}
 */
export function renderFlow(flow, instance, { ops } = {}) {
  const opOf = (id) => (ops instanceof Map ? ops.get(id) : ops?.[id]);
  const status = instance?.status ?? 'idle';
  const terminal = status === 'done' || status === 'failed' || status === 'cancelled';
  const currentId = status === 'awaiting-input' ? instance?.awaiting?.step : instance?.at ?? null;

  const progress = (flow.steps ?? []).map((s) => {
    let state = 'pending';
    if (instance?.steps && s.id in instance.steps) state = 'done';
    else if (!terminal && s.id === currentId) state = 'current';
    else if (terminal) state = 'skipped';           // terminal + never executed = the branch not taken
    return { id: s.id, labelKey: s.labelKey ?? `flow.${flow.id}.${s.id}`, state };
  });

  let form = null;
  if (status === 'awaiting-input' && instance?.awaiting) {
    const step = (flow.steps ?? []).find((s) => s.id === instance.awaiting.step);
    const op = step && step.op ? opOf(step.op) : null;
    form = {
      step: instance.awaiting.step,
      params: (instance.awaiting.params ?? []).map((p) => {
        const declared = (op?.params ?? []).find((d) => d?.name === p.name);
        return {
          name: p.name,
          kind: p.kind ?? declared?.kind,
          required: declared?.required ?? true,
          labelKey: declared?.labelKey ?? `flow.${flow.id}.${instance.awaiting.step}.${p.name}`,
        };
      }),
    };
  }

  return {
    id: flow.id,
    labelKey: flow.labelKey ?? `flow.${flow.id}.title`,
    status,
    progress,
    form,
    actions: {
      canSubmit: status === 'awaiting-input',
      canCancel: status === 'running' || status === 'awaiting-input',
      canRestart: status === 'failed' || status === 'cancelled',
    },
    reason: instance?.reason ?? null,
    produces: status === 'done' ? instance?.produces ?? null : null,
  };
}
