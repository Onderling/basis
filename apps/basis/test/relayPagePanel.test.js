/**
 * basis — Objective D / Surface 4: the my-data relay-URL editor
 * is the FIRST live consumer of openPagePanel's docked side-panel (simple-form).
 *
 * The `set-relay` manifest op declares `surfaces.page`; the my-data control is an
 * entry button that opens the generic panel; the panel auto-builds a form from
 * `op.params` (url · clear), dispatches via `callSkill`, and closes on success.
 * Mirrors `test/backToChat.test.js` (the openPagePanel back-to-chat consumer).
 *
 * @vitest-environment happy-dom
 */
import { describe, it, expect, vi } from 'vitest';

import { openPagePanel }      from '../src/web/pagePanel.js';
import { renderCircleMyData } from '../web/v2/circleMyData.js';
import { basisManifest } from '../manifest.js';

const NAV_BTN = '.basis-nav-back-button';
const setRelayOp = basisManifest.operations.find((o) => o.id === 'set-relay');
const tick = () => new Promise((r) => setTimeout(r, 0));

describe('set-relay — surfaces.page contract (#180)', () => {
  it('declares a page surface + the url/clear params the panel form needs', () => {
    expect(setRelayOp).toBeTruthy();
    expect(setRelayOp.surfaces.page).toMatchObject({ kind: 'side-panel' });
    const names = setRelayOp.params.map((p) => p.name);
    expect(names).toContain('url');
    expect(names).toContain('clear');
  });
});

describe('my-data relay control — routes through the side-panel', () => {
  it('renders an entry button that opens the panel (not the bespoke inline form)', () => {
    const onOpenRelayPanel = vi.fn();
    const container = document.createElement('div');
    renderCircleMyData(container, {
      t: (k) => k, onOpenRelayPanel, relayUrl: '', relayEnvUrl: 'ws://env:8787', only: ['relay'],   // the relay is a Verbinding section
    });
    const btn = container.querySelector('.cc-mydata__relay-open');
    expect(btn).not.toBeNull();
    // the inline text-field editor must NOT also render (routed to the panel instead)
    expect(container.querySelector('.cc-mydata__relay-input')).toBeNull();
    btn.click();
    expect(onOpenRelayPanel).toHaveBeenCalledTimes(1);
  });
});

describe('openPagePanel — set-relay live (simple-form)', () => {
  it('opens the panel, builds the form from op.params, and shows back-to-chat', () => {
    const panel = document.createElement('aside');
    panel.hidden = true;
    openPagePanel({
      container: panel, doc: document, op: setRelayOp, appOrigin: 'basis',
      callSkill: vi.fn(), onClose: vi.fn(),
      backTo: { returnTo: 'circle-1', label: '← back', onNavigate: vi.fn() },
    });
    expect(panel.hidden).toBe(false);
    expect(panel.querySelector('[name="url"]')).not.toBeNull();
    expect(panel.querySelector('[name="clear"]')).not.toBeNull();
    expect(panel.querySelector(NAV_BTN)).not.toBeNull();
  });

  it('dispatches via callSkill on submit and closes on success', async () => {
    const panel = document.createElement('aside');
    panel.hidden = true;
    const callSkill = vi.fn().mockResolvedValue({ ok: true, effective: 'ws://relay.test:8787' });
    const onDispatched = vi.fn();
    openPagePanel({
      container: panel, doc: document, op: setRelayOp, appOrigin: 'basis',
      callSkill, onDispatched, onClose: vi.fn(),
    });

    const urlInput = panel.querySelector('[name="url"]');
    urlInput.value = 'ws://relay.test:8787';
    // Submit the form (repo happy-dom pattern: dispatch the submit event).
    panel.querySelector('form').dispatchEvent(new Event('submit'));
    await tick();

    expect(callSkill).toHaveBeenCalledWith(
      'basis', 'set-relay',
      expect.objectContaining({ url: 'ws://relay.test:8787' }),
    );
    expect(onDispatched).toHaveBeenCalledTimes(1);
    // teardown: panel emptied + hidden again.
    expect(panel.hidden).toBe(true);
    expect(panel.innerHTML).toBe('');
  });

  it('keeps the panel open and surfaces the error when callSkill returns {ok:false}', async () => {
    const panel = document.createElement('aside');
    panel.hidden = true;
    const callSkill = vi.fn().mockResolvedValue({ ok: false, error: 'bad relay url' });
    openPagePanel({
      container: panel, doc: document, op: setRelayOp, appOrigin: 'basis',
      callSkill, onClose: vi.fn(),
    });
    panel.querySelector('[name="url"]').value = 'ws://relay.test:8787';
    panel.querySelector('form').dispatchEvent(new Event('submit'));
    await tick();

    expect(panel.hidden).toBe(false);
    expect(panel.querySelector('.cc-page-status-error')?.textContent).toBe('bad relay url');
  });
});
