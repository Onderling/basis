/**
 * createOpBinding — (2026-05-21) — T2-tier helper for hand-coded
 * pages that want to read from the manifest without doing full
 * substrate rendering.
 *
 * Per `DESIGN-tier-policy.md`, a T2 page is hand-coded HTML/JSX that
 * still reads labels / severities / confirm messages from its app's
 * manifest. Pre- the pages did this manually:
 *
 *     const op = pinboardManifest.operations.find(o => o.id === 'signOutOfPod');
 *     if (!confirm(op.surfaces.ui.confirm.message)) return;
 *     await callSkill('signOutOfPod', {});
 *
 * With `createOpBinding`:
 *
 *     import { createOpBinding } from '/lib/web-adapter/createOpBinding.js';
 *     const binding = createOpBinding({ manifest: pinboardManifest, callSkill });
 *     await binding.confirmAndCall('signOutOfPod');
 *
 * Returns `{ findOp, confirmAndCall, labelFor }`.  See JSDoc on each.
 *
 * No DOM access — uses globalThis.confirm so it works in Node tests
 * (where vitest can stub confirm) and in browsers (the default
 * `window.confirm`).
 *
 * @param {object} args
 * @param {object} args.manifest      Per-app manifest with `operations[]`.
 * @param {Function} args.callSkill   Per-app skill dispatcher.  Receives
 *                                    (opId, args) and returns the skill's
 *                                    return value (or throws).
 * @param {Function} [args.confirmFn] Override for the confirmation prompt
 *                                    (defaults to `globalThis.confirm`).
 *                                    Useful for tests + non-DOM consumers.
 *
 * @returns {{
 *   findOp:        (opId: string) => object | undefined,
 *   confirmAndCall: (opId: string, args?: object) => Promise<*>,
 *   labelFor:      (opId: string, t?: Function) => string,
 * }}
 */
export function createOpBinding({ manifest, callSkill, confirmFn } = {}) {
  if (!manifest || typeof manifest !== 'object' || !Array.isArray(manifest.operations)) {
    throw new TypeError('createOpBinding: { manifest } with operations[] required');
  }
  if (typeof callSkill !== 'function') {
    throw new TypeError('createOpBinding: { callSkill } function required');
  }
  const ask = typeof confirmFn === 'function' ? confirmFn
            : (typeof globalThis !== 'undefined' && typeof globalThis.confirm === 'function'
                 ? globalThis.confirm.bind(globalThis)
                 : null);

  const byId = new Map(manifest.operations.map((op) => [op.id, op]));

  /**
   * Look up a manifest op by id.
   * @returns {object | undefined}
   */
  function findOp(opId) {
    return byId.get(opId);
  }

  /**
   * Resolve a label for an op, honouring labelKey when an localisation
   * function is supplied.
   *
   *   labelFor('signOutOfPod')           // → 'Uitloggen'  (fallback)
   *   labelFor('signOutOfPod', t)        // → t('profile.sign_out_label', 'Uitloggen')
   *
   * Falls back to the opId when no surfaces.ui exists.
   */
  function labelFor(opId, t) {
    const op = byId.get(opId);
    const ui = op?.surfaces?.ui;
    if (!ui) return opId;
    if (typeof t === 'function' && typeof ui.labelKey === 'string' && ui.labelKey !== '') {
      return t(ui.labelKey, ui.label ?? opId);
    }
    return ui.label ?? opId;
  }

  /**
   * Dispatch an op, honouring its confirm hint.
   *
   *   - If `op.surfaces.ui.confirm` is present with severity 'warn' or
   *     'danger', shows `confirm(message)` and returns `undefined` on
   *     cancel.
   *   - If severity is 'info' OR confirm is absent, dispatches
   *     immediately.
   *   - Returns the skill's return value (or whatever `callSkill`
   *     resolves to).
   *
   * Throws if the opId isn't declared in the manifest — the drift
   * canary prevents this at test time; throwing at runtime catches
   * any case the canary missed.
   *
   * @param {string} opId
   * @param {object} [args={}]   args passed to callSkill
   * @returns {Promise<*>}       skill result, or undefined if cancelled
   */
  async function confirmAndCall(opId, args = {}) {
    const op = byId.get(opId);
    if (!op) {
      throw new Error(`createOpBinding: manifest has no op "${opId}"`);
    }
    const c = op.surfaces?.ui?.confirm;
    if (c && (c.severity === 'warn' || c.severity === 'danger')) {
      if (typeof ask === 'function') {
        const msg = (typeof c.message === 'string' && c.message !== '')
          ? c.message
          : `${op.surfaces?.ui?.label ?? opId}?`;
        if (!ask(msg)) return undefined;
      }
      // No confirm function available → fall through (Node default
      // without a stub).  Tests should pass an explicit confirmFn.
    }
    return callSkill(opId, args);
  }

  return { findOp, confirmAndCall, labelFor };
}
