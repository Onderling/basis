/**
 * The assistant panel (the "+" sheet) shows two tabs: Gesprek (the thread and the line) and Maken (what is pinned and
 * the own acts). Only the shown tab's sections are visible; a tap on a tab is handed to the host; an open form shows on
 * Maken; a sheet opened on an own row (editing) has no tabs.
 * @vitest-environment happy-dom
 */
import { describe, it, expect } from 'vitest';
import { renderVandaagPlus } from '../../web/v2/vandaagPlus.js';

const t = (k) => k;
const visible = (el, id) => !el.querySelector(`[data-section="${id}"]`).hidden;
const base = { t, onRead: () => {}, onPick: () => {}, onTogglePin: () => {}, turns: [{ who: 'you', text: 'hoi' }], onForget: () => {} };

describe('the assistant panel\'s two tabs', () => {
  it('shows Gesprek by default: the thread and the line, not the acts', () => {
    const el = renderVandaagPlus(document.createElement('div'), base);
    const tabs = [...el.querySelectorAll('.circle-vandaag-plus__tab')];
    expect(tabs.map((b) => b.dataset.tab)).toEqual(['gesprek', 'maken']);
    expect(tabs.map((b) => b.getAttribute('aria-selected'))).toEqual(['true', 'false']);
    expect(visible(el, 'plus-thread')).toBe(true);
    expect(visible(el, 'plus-line')).toBe(true);
    expect(visible(el, 'plus-own')).toBe(false);
  });

  it('shows Maken when it was chosen: the own acts, not the line', () => {
    const el = renderVandaagPlus(document.createElement('div'), { ...base, tab: 'maken' });
    expect(visible(el, 'plus-own')).toBe(true);
    expect(visible(el, 'plus-line')).toBe(false);
    expect(el.querySelector('.circle-vandaag-plus__route')).toBeNull();
  });

  it('hands a tap on a tab to the host', () => {
    const taps = [];
    const el = renderVandaagPlus(document.createElement('div'), { ...base, onTab: (id) => taps.push(id) });
    el.querySelector('.circle-vandaag-plus__tab[data-tab="maken"]').click();
    expect(taps).toEqual(['maken']);
  });

  it('an open form shows on Maken, even when Gesprek was chosen', () => {
    const el = renderVandaagPlus(document.createElement('div'), { ...base, tab: 'gesprek', actId: 'household.note' });
    expect(el.querySelector('.circle-vandaag-plus__tab[data-tab="maken"]').getAttribute('aria-selected')).toBe('true');
    expect(visible(el, 'plus-own')).toBe(true);
    expect(el.querySelector('[data-section="plus-own"] form')).not.toBeNull();
  });

  it('opened on an own row to change it: no tabs, just the form', () => {
    const el = renderVandaagPlus(document.createElement('div'), { ...base, actId: 'household.note', editing: true, onRemove: () => {} });
    expect(el.querySelector('.circle-vandaag-plus__tabs')).toBeNull();
    expect(el.querySelector('form')).not.toBeNull();
  });
});
