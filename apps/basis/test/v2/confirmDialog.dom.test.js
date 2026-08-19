// @vitest-environment happy-dom
/**
 * confirmDialog — the web presenter of the confirm gate.
 *
 * The full web chain over the real DOM renderer, driven the way
 * circleApp wires it (needsConfirm route → shared runConfirmGate →
 * renderConfirmDialog as the presenter → executeResolved):
 *   - the DANGER dialog renders with the MANIFEST's confirm message
 *     (revokeAgent — the red Tier C affordance)
 *   - the accept button carries the danger styling hint
 *   - confirm click → the dispatch executes (once, as 'ready')
 *   - cancel click / ESC / backdrop → no dispatch, quiet notice
 */
import { describe, it, expect, vi } from 'vitest';

import { agentsManifest } from '../../../agents/manifest.js';
import { mergeManifests } from '../../src/manifestMerge.js';
import { resolveDispatch } from '../../src/router.js';
import { confirmRequestFromRoute, runConfirmGate } from '../../src/v2/confirmGate.js';
import { renderConfirmDialog } from '../../web/v2/confirmDialog.js';

const catalogue = mergeManifests([{ manifest: agentsManifest }]);
const t = (k) => k;
const REVOKE_MSG = agentsManifest.operations.find((o) => o.id === 'revokeAgent').surfaces.ui.confirm.message;

function mount() { const el = document.createElement('div'); document.body.appendChild(el); return el; }

function revokeRoute() {
  return resolveDispatch(
    { kind: 'slash', opId: 'revokeAgent', args: { agentId: 'summary-bot' }, command: '(bot)', body: '' },
    catalogue,
  );
}

/** The presenter exactly as circleApp wraps it (promise + unmount on settle). */
function domPresenter(container) {
  return (request) => new Promise((resolve) => {
    renderConfirmDialog(container, {
      request,
      onResolve: (accepted) => { container.remove(); resolve(accepted); },
    });
  });
}

describe('renderConfirmDialog — the danger dialog renders the manifest message', () => {
  it('shows the manifest confirm message + localised chrome, accept styled danger', () => {
    const el = mount();
    renderConfirmDialog(el, { request: confirmRequestFromRoute(revokeRoute(), { t }), onResolve: () => {} });
    expect(el.dataset.severity).toBe('danger');
    expect(el.querySelector('.cc-confirm__message').textContent).toBe(REVOKE_MSG);
    expect(el.querySelector('.cc-confirm__title').textContent).toBe('circle.confirm.title');
    const accept = el.querySelector('.cc-confirm__accept');
    expect(accept.textContent).toBe('circle.confirm.accept');
    expect(accept.dataset.severity).toBe('danger');
    expect(accept.classList.contains('cc-confirm__accept--danger')).toBe(true);
    expect(el.querySelector('.cc-confirm__cancel').textContent).toBe('circle.confirm.cancel');
    el.remove();
  });

  it('resolves exactly once even when a button is double-clicked', () => {
    const el = mount();
    const onResolve = vi.fn();
    renderConfirmDialog(el, { request: confirmRequestFromRoute(revokeRoute(), { t }), onResolve });
    const accept = el.querySelector('.cc-confirm__accept');
    accept.click();
    accept.click();
    el.querySelector('.cc-confirm__cancel').click();
    expect(onResolve).toHaveBeenCalledTimes(1);
    expect(onResolve).toHaveBeenCalledWith(true);
    el.remove();
  });
});

describe('the full web chain — gate + dialog + dispatch', () => {
  it('confirm click dispatches the confirmed ready route (exactly once)', async () => {
    const el = mount();
    const execute = vi.fn();
    const onCancelNotice = vi.fn();
    const run = runConfirmGate({
      route: revokeRoute(), catalogue, t,
      present: domPresenter(el), execute, onCancelNotice,
    });
    // The dialog is up with the manifest's message; click the red confirm.
    expect(document.querySelector('.cc-confirm__message').textContent).toBe(REVOKE_MSG);
    document.querySelector('.cc-confirm__accept').click();
    const r = await run;
    expect(r.executed).toBe(true);
    expect(execute).toHaveBeenCalledTimes(1);
    expect(execute).toHaveBeenCalledWith(expect.objectContaining({
      kind: 'ready', opId: 'revokeAgent', args: { agentId: 'summary-bot' }, appOrigin: 'agents',
    }));
    expect(onCancelNotice).not.toHaveBeenCalled();
    expect(document.querySelector('.cc-confirm')).toBeNull();   // unmounted after settle
  });

  it('cancel click never dispatches; the quiet notice fires; the dialog unmounts', async () => {
    const el = mount();
    const execute = vi.fn();
    const onCancelNotice = vi.fn();
    const run = runConfirmGate({
      route: revokeRoute(), catalogue, t,
      present: domPresenter(el), execute, onCancelNotice,
    });
    document.querySelector('.cc-confirm__cancel').click();
    const r = await run;
    expect(r.executed).toBe(false);
    expect(execute).not.toHaveBeenCalled();
    expect(onCancelNotice).toHaveBeenCalledTimes(1);
    expect(document.querySelector('.cc-confirm')).toBeNull();
  });

  it('ESC cancels (never accepts)', async () => {
    const el = mount();
    const execute = vi.fn();
    const run = runConfirmGate({
      route: revokeRoute(), catalogue, t,
      present: domPresenter(el), execute, onCancelNotice: () => {},
    });
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
    const r = await run;
    expect(r.executed).toBe(false);
    expect(execute).not.toHaveBeenCalled();
  });
});
