// @vitest-environment happy-dom
/**
 * showConsentCard (P2c-3, web) — the plain consent-card modal. Rendered with an
 * injected `t` (key passthrough) in happy-dom; verifies Add/Decline wiring + the
 * refused path. Strings come from t() (asserted as keys here).
 */

import { describe, it, expect, vi, afterEach } from 'vitest';
import { showConsentCard } from '../src/web/extensionConsentCard.js';

afterEach(() => { document.body.innerHTML = ''; });   // happy-dom persists body across tests

const t = (k, vars) => (vars ? `${k}:${JSON.stringify(vars)}` : k);

const okResult = { ok: true, card: {
  id: 'fb', title: 'Buurtplan', scope: 'circle',
  needs: ['call-LLM'], commands: [{ command: '/feedback', invokes: ['household/addItem'] }],
} };

describe('showConsentCard', () => {
  it('renders Decline + Add; Add fires onAdd and closes the modal', () => {
    const onAdd = vi.fn(); const onDecline = vi.fn();
    const { el } = showConsentCard(okResult, { onAdd, onDecline, t });
    const buttons = [...el.querySelectorAll('button')];
    expect(buttons.map((b) => b.textContent)).toEqual(['circle.extension.decline', 'circle.extension.add']);
    expect(document.querySelector('.ext-consent-overlay')).toBeTruthy();
    buttons[1].click();                                   // Add
    expect(onAdd).toHaveBeenCalledTimes(1);
    expect(document.querySelector('.ext-consent-overlay')).toBeNull();   // closed
  });

  it('lists the commands + what they invoke', () => {
    const { el } = showConsentCard(okResult, { t });
    expect(el.textContent).toContain('/feedback');
    expect(el.textContent).toContain('household/addItem');
    expect(el.textContent).toContain('circle.extension.scope_circle');
  });

  it('Decline fires onDecline and closes', () => {
    const onDecline = vi.fn();
    const { el } = showConsentCard(okResult, { onDecline, t });
    el.querySelectorAll('button')[0].click();
    expect(onDecline).toHaveBeenCalledTimes(1);
    expect(document.querySelector('.ext-consent-overlay')).toBeNull();
  });

  it('a refused result shows the refusal + only a Decline (no Add)', () => {
    const onAdd = vi.fn(); const onDecline = vi.fn();
    const { el } = showConsentCard({ ok: false, missing: ['ghost/nope'] }, { onAdd, onDecline, t });
    expect(el.textContent).toContain('circle.extension.refused');
    const buttons = [...el.querySelectorAll('button')];
    expect(buttons).toHaveLength(1);
    buttons[0].click();
    expect(onDecline).toHaveBeenCalledTimes(1);
    expect(onAdd).not.toHaveBeenCalled();
  });
});
