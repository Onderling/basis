// @vitest-environment happy-dom
/**
 * The switcher paints INTO a borrowed card (the overlay's `cc-overlay-card`, which carries the theme's background in
 * light and dark). It replaced the card's class with its own, so the rows floated over the page with no card behind
 * them (screen walk, 2026-10-22).
 */
import { describe, it, expect } from 'vitest';
import { renderPersonaSwitcher } from '../../web/v2/personaSwitcher.js';
import { switcherModel } from '../../src/v2/personaSet.js';

describe('renderPersonaSwitcher', () => {
  it('keeps the class of the card it paints into, and adds its own', () => {
    const card = document.createElement('div');
    card.className = 'cc-overlay-card';
    renderPersonaSwitcher(card, { model: switcherModel({ book: {}, held: [{ id: 'default', name: 'Jij' }, { id: 'p1', name: 'Werk' }] }), t: (k) => k });
    expect(card.classList.contains('cc-overlay-card')).toBe(true);
    expect(card.classList.contains('cc-persona-switcher')).toBe(true);
    expect(card.querySelectorAll('.cc-persona-switcher__row')).toHaveLength(2);
  });
});
