/**
 * confirmGate — the confirm gate at the DISPATCH waist (web ≡ mobile).
 *
 * `resolveDispatch` already EMITS `kind: 'needsConfirm'` for an op whose
 * manifest declares `surfaces.ui.confirm` with severity 'warn'/'danger'
 * (router.js branch) — but until 2026-07 neither shell HANDLED it:
 * web `circleApp.dispatchReady` and mobile `runCircleCommandResolved`
 * both fell through `kind !== 'ready'` → the "unknown" bubble, so the
 * declared red confirm never rendered and the op never ran.
 *
 * This module is the ONE shared handler (invariant #1: dispatch logic
 * lives once; the gate sits at the dispatch layer, so the row-button
 * path and the chat/slash path are intercepted uniformly):
 *
 *   - `confirmRequestFromRoute(route, {t})` — the presentation model the
 *     shell UI renders (severity styling hint + the MANIFEST's message,
 *     localised chrome via t()).
 *   - `confirmRequestForOp(op, {t, message})` — the same model for a control
 *     that dispatches the op directly (a panel row button, whose neighbours all
 *     call the skill straight): the gate still comes from the op's declaration,
 *     so such a control shares this dialog instead of growing one of its own.
 *   - `readyFromConfirm(route, catalogue)` — the explicit-accept
 *     continuation: the same dispatch, re-tagged 'ready' (verb looked up
 *     so scopeReadyDispatch keeps working).
 *   - `runConfirmGate({...})` — the driver both shells call at their
 *     `needsConfirm` branch: present → accept ⇒ execute EXACTLY once;
 *     cancel ⇒ never execute (quiet notice via onCancelNotice).
 *
 * The presenter is the only per-shell part (web: a DOM confirm dialog;
 * mobile: Alert.alert with a destructive button) — it receives the
 * request model and resolves truthy on explicit accept.
 *
 * Invariant guarded here: an op declaring `surfaces.ui.confirm`
 * (warn/danger) NEVER executes without an explicit confirmation step.
 */

import { translatorOr } from '../locales/translatorOr.js';

/**
 * @typedef {object} ConfirmRequest
 * @property {'warn'|'danger'} severity     styling hint (danger → red/destructive)
 * @property {string}          message      the manifest's confirm message (or a localised fallback)
 * @property {string}          title        localised dialog title
 * @property {string}          acceptLabel  localised accept-button label
 * @property {string}          cancelLabel  localised cancel-button label
 * @property {string}          opId
 * @property {string}          [appOrigin]
 */

/**
 * Build the presentation model for a `needsConfirm` route.
 *
 * @param {import('../router.js').NeedsConfirmDispatch} route
 * @param {{t?: Function}} [opts]
 * @returns {ConfirmRequest|null}  null when the route is not a needsConfirm
 */
export function confirmRequestFromRoute(route, { t } = {}) {
  if (!route || route.kind !== 'needsConfirm') return null;
  return buildRequest({
    severity: route.severity, message: route.message, opId: route.opId, appOrigin: route.appOrigin, t,
  });
}

/**
 * The same presentation model for a control that dispatches an op DIRECTLY
 * rather than through `resolveDispatch` — a row button in a panel, say, whose
 * neighbours all call the skill straight. The op's own `surfaces.ui.confirm`
 * still decides whether there is a gate at all and how severe it is (invariant
 * #4: declared in the manifest, never restated per shell), so such a control
 * gets the SAME dialog as the chat path rather than a second one of its own.
 *
 * `message` is for the case a static manifest string cannot cover: the same op
 * can carry a different consequence per target (the last admin stepping back
 * hands the circle over; any other demotion does not), and the caller has
 * already localised which. Absent, the manifest's message stands.
 *
 * @param {object|null} op        the manifest operation
 * @param {{t?: Function, message?: string}} [opts]
 * @returns {ConfirmRequest|null}  null when the op declares no warn/danger confirm
 */
export function confirmRequestForOp(op, { t, message } = {}) {
  const declared = op?.surfaces?.ui?.confirm;
  if (!declared || (declared.severity !== 'warn' && declared.severity !== 'danger')) return null;
  return buildRequest({
    severity: declared.severity,
    message: (typeof message === 'string' && message) ? message : declared.message,
    opId: op.id,
    t,
  });
}

/** The one ConfirmRequest shape, however the caller reached the gate. */
function buildRequest({ severity, message, opId, appOrigin, t }) {
  const tr = translatorOr(t, 'confirmGate.js');
  return {
    severity: severity === 'danger' ? 'danger' : 'warn',
    // The declared message is the body; only a declaration WITHOUT a message
    // falls back to the generic localised prompt.
    message: (typeof message === 'string' && message) ? message : tr('circle.confirm.default_message'),
    title:       tr('circle.confirm.title'),
    acceptLabel: tr('circle.confirm.accept'),
    cancelLabel: tr('circle.confirm.cancel'),
    opId,
    appOrigin,
  };
}

/**
 * The explicit-accept continuation: the confirmed route, re-tagged
 * `'ready'` so the shell's normal execute path (capability gate →
 * scopeReadyDispatch → runDispatch) runs it unchanged.  The op's verb is
 * looked up from the catalogue (needsConfirm doesn't carry it) so the
 * active-circle scope injection keeps working for mutation verbs.
 *
 * @param {import('../router.js').NeedsConfirmDispatch} route
 * @param {import('../manifestMerge.js').MergedCatalogue} [catalogue]
 * @returns {import('../router.js').ReadyDispatch}
 */
export function readyFromConfirm(route, catalogue) {
  if (!route || route.kind !== 'needsConfirm') {
    throw new TypeError('readyFromConfirm: a needsConfirm route is required');
  }
  const entry = catalogue?.opsById?.get(route.opId);
  return {
    kind:       'ready',
    opId:       route.opId,
    args:       route.args ?? {},
    appOrigin:  route.appOrigin,
    threadId:   route.threadId ?? null,
    replyShape: route.replyShape,
    verb:       entry?.op?.verb ?? null,
  };
}

/**
 * Drive the gate for one `needsConfirm` route: present the confirmation,
 * then either execute the confirmed dispatch (exactly once — promise
 * settlement is single-shot, so a double-firing presenter cannot
 * re-execute) or notify the quiet cancel.
 *
 * @param {object}   args
 * @param {import('../router.js').NeedsConfirmDispatch} args.route
 * @param {import('../manifestMerge.js').MergedCatalogue} [args.catalogue]
 * @param {Function} [args.t]
 * @param {(request: ConfirmRequest) => (boolean|Promise<boolean>)} args.present
 *        per-shell UI: resolve truthy ONLY on the user's explicit accept
 * @param {(ready: import('../router.js').ReadyDispatch) => any} args.execute
 * @param {() => any} [args.onCancelNotice]  quiet cancel notice (no-op dispatch)
 * @returns {Promise<{executed: boolean}>}
 */
export async function runConfirmGate({ route, request: prebuilt, catalogue, t, present, execute, onCancelNotice } = {}) {
  if (!prebuilt && (!route || route.kind !== 'needsConfirm')) {
    throw new TypeError('runConfirmGate: a needsConfirm route is required');
  }
  if (typeof present !== 'function' || typeof execute !== 'function') {
    throw new TypeError('runConfirmGate: present + execute are required');
  }
  const request = prebuilt ?? confirmRequestFromRoute(route, { t });
  let accepted = false;
  try { accepted = !!(await present(request)); }
  catch { accepted = false; }              // a broken presenter must never execute
  if (!accepted) {
    onCancelNotice?.();
    return { executed: false };
  }
  // A route continues as the same dispatch, re-tagged 'ready'. A caller that
  // brought its own request already holds what it means to run and executes it.
  await execute(route ? readyFromConfirm(route, catalogue) : undefined);
  return { executed: true };
}
