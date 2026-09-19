/**
 * updateBar — "there is a newer version; reload" (2026-09-19). @vitest-environment happy-dom
 * Paint only: shown when the shell says the site is ahead, one action, gone after it.
 */
import { describe, it, expect, vi } from 'vitest';
import { renderUpdateBar } from '../web/v2/updateBar.js';

const t = (k, v) => (v ? `${k}:${JSON.stringify(v)}` : k);

describe('renderUpdateBar', () => {
  it('paints the notice with the served tag and a reload action, once — a second call updates in place', () => {
    const host = document.createElement('div');
    const onReload = vi.fn();
    renderUpdateBar(host, { served: 'v0.1.13-alpha', t, onReload });
    const bar = host.querySelector('.cc-update');
    expect(bar.querySelector('.cc-update__text').textContent).toBe('circle.update.available:{"tag":"v0.1.13-alpha"}');
    bar.querySelector('.cc-update__reload').click();
    expect(onReload).toHaveBeenCalled();
    renderUpdateBar(host, { served: 'v0.1.14-alpha', t, onReload });
    expect(host.querySelectorAll('.cc-update').length).toBe(1);
    expect(host.querySelector('.cc-update__text').textContent).toContain('v0.1.14-alpha');
  });
});
