// @vitest-environment happy-dom
/**
 * The persona panel on the web, painted from the shared model (`personaPanelModel`): one tab per persona when there are
 * several (the general self first), the "Laat zien als" door kept, a close; the short view goes in the body it returns.
 */
import { describe, it, expect, vi } from 'vitest';
import { renderPersonaPanel } from '../../web/v2/personaPanel.js';
import { personaPanelModel } from '../../src/v2/personaPanel.js';

const t = (k) => k;
describe('renderPersonaPanel', () => {
  it('one persona: no tabs, no "Laat zien als", a body for the short view', () => {
    const card = document.createElement('div');
    const body = renderPersonaPanel(card, { model: personaPanelModel({ held: [{ id: 'default' }] }), t });
    expect(card.querySelector('.cc-persona-panel__tabs')).toBeNull();
    expect(card.querySelector('.cc-persona-panel__show-as')).toBeNull();
    expect(card.contains(body)).toBe(true);
  });
  it('several: a tab per persona (general first, the picked one marked); a tab, the door and close each report', () => {
    const onTab = vi.fn(); const onShowAs = vi.fn(); const onClose = vi.fn();
    const card = document.createElement('div');
    const model = personaPanelModel({ held: [{ id: 'werk', name: 'Werk' }, { id: 'default' }], selected: 'werk' });
    renderPersonaPanel(card, { model, t, onTab, onShowAs, onClose });
    const tabs = [...card.querySelectorAll('.cc-persona-panel__tab')];
    expect(tabs.map((b) => b.textContent)).toEqual(['circle.switcher.you', 'Werk']);
    expect(tabs[1].getAttribute('aria-selected')).toBe('true');
    tabs[0].click();
    expect(onTab).toHaveBeenCalledWith('default');
    card.querySelector('.cc-persona-panel__show-as').click();
    expect(onShowAs).toHaveBeenCalled();
    card.querySelector('.cc-persona-panel__close').click();
    expect(onClose).toHaveBeenCalled();
  });
});
