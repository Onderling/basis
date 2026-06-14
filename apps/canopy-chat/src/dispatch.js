/**
 * canopy-chat — dispatch.
 *
 * Takes a `ready` `RouteResult` from the router + a `callSkill`
 * function that knows how to invoke a skill on the right app's
 * agent.  Returns a `Reply` envelope the renderer consumes.
 *
 * Cross-app routing happens via the `appOrigin` field on the
 * dispatch: `callSkill` is responsible for picking the right
 * agent.  v0.1 ships a thin wrapper; the per-app agent wiring lands
 * in v0.1.3 (browser-bundled mesh agent slice).
 *
 * Pure-ish — the only side effect is the `callSkill` call.  Caller
 * passes a stub for tests.
 *
 * Phase v0.1 sub-slice 1.7 per `/Project Files/canopy-chat/coding-plan.md`.
 *
 * P1 (feedback-extension) adds the `'composite'` dispatch kind beside
 * `ready`/`needsForm`/`bulk`: when the resolved op carries `steps`, the
 * router emits a `composite` dispatch and `runCompositeDispatch` runs the
 * sequence via `runCompositeOp` (see `composite.js`).
 */

import { runCompositeOp } from './composite.js';

/**
 * @typedef {object} Reply
 * @property {*}              payload     opaque to the chat shell; renderer-specific
 * @property {string}         shape       effective Q28 reply shape (from RouteResult)
 * @property {string|null}    threadId
 * @property {{code: string, message: string}} [error]
 */

/**
 * @callback CallSkill
 * @param {string} appOrigin   which app's agent owns the skill
 * @param {string} opId
 * @param {object} args
 * @returns {Promise<*>}       arbitrary payload (the skill's reply shape)
 */

/**
 * Run a ready dispatch against the right app's agent.
 *
 * @param {import('./router.js').ReadyDispatch}  ready
 * @param {CallSkill}                            callSkill
 * @returns {Promise<Reply>}
 */
export async function runDispatch(ready, callSkill) {
  if (!ready || ready.kind !== 'ready') {
    throw new Error(
      `runDispatch: expected ready dispatch, got kind=${ready?.kind ?? '(none)'}`,
    );
  }
  if (typeof callSkill !== 'function') {
    throw new TypeError('runDispatch: callSkill must be a function');
  }

  const { opId, args, appOrigin, threadId, replyShape } = ready;

  try {
    const payload = await callSkill(appOrigin, opId, args);
    // v0.5.x defensive guard — when the skill returns an explicit
    // {ok: false, error} envelope, elevate it to reply.error so the
    // renderer falls back to the error-bubble path instead of force-
    // rendering the failure as the declared replyShape (which led to
    // a broken '? (unnamed)' embed-card in v0.5.0 when a skill was
    // missing on the real agent — user-reported 2026-05-23).
    if (payload && typeof payload === 'object'
        && payload.ok === false
        && typeof payload.error === 'string') {
      return {
        payload:  null,
        shape:    'text',
        threadId: threadId ?? null,
        error: {
          code:    'skill-error',
          message: payload.error,
        },
      };
    }
    return {
      payload,
      shape:    replyShape,
      threadId: threadId ?? null,
    };
  } catch (err) {
    return {
      payload:  null,
      shape:    'text',                     // errors always render as text in v0.1
      threadId: threadId ?? null,
      error: {
        code:    err?.code ?? 'dispatch-error',
        message: err?.message ?? String(err),
      },
    };
  }
}

/**
 * Run a `composite` dispatch (from the router) — P1, feedback-extension.
 *
 * Delegates to the shared `runCompositeOp` runner (sequential steps,
 * `argRef` threading, `onError`).  Wraps the aggregate into the same
 * `Reply` envelope the renderer consumes, so a composite renders exactly
 * like a single op: success → the last step's payload at the op's
 * declared `replyShape`; failure → the first failing step's error on the
 * error-bubble path.  The full per-step breakdown rides along on
 * `reply.composite` for renderers that want to show the chain.
 *
 * @param {import('./router.js').CompositeDispatch} composite
 * @param {CallSkill}                               callSkill
 * @returns {Promise<Reply>}
 */
export async function runCompositeDispatch(composite, callSkill) {
  if (!composite || composite.kind !== 'composite') {
    throw new Error(
      `runCompositeDispatch: expected composite dispatch, got kind=${composite?.kind ?? '(none)'}`,
    );
  }
  if (typeof callSkill !== 'function') {
    throw new TypeError('runCompositeDispatch: callSkill must be a function');
  }

  const { op, args, threadId, replyShape } = composite;

  let result;
  try {
    // The dispatch-level args (positional body / flags / injected scope)
    // thread into every step as ctx; a step's own args win over ctx.
    result = await runCompositeOp(op, callSkill, args ?? {});
  } catch (err) {
    return {
      payload:  null,
      shape:    'text',
      threadId: threadId ?? null,
      error: {
        code:    err?.code ?? 'composite-error',
        message: err?.message ?? String(err),
      },
    };
  }

  if (!result.ok) {
    return {
      payload:   null,
      shape:     'text',
      threadId:  threadId ?? null,
      composite: result,
      error: {
        code:    result.error?.code ?? 'composite-error',
        message: result.error?.message ?? 'Composite failed',
      },
    };
  }

  return {
    payload:   result.payload,
    shape:     replyShape,
    threadId:  threadId ?? null,
    composite: result,
  };
}
