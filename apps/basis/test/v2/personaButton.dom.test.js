// @vitest-environment happy-dom
/**
 * The persona button (top right on every tab) paints the picture when it has one, else the initials, says it is the
 * persona button, and a tap opens the persona panel; the settings button (the gear) sits beside it and opens the
 * settings home.
 */
import { describe, it, expect, vi } from 'vitest';
import { renderPersonaButton } from '../../web/v2/personaButton.js';

const t = (k) => k;
describe('renderPersonaButton', () => {
  it('initials without a picture; its spoken name is the persona button; a tap opens', () => {
    const onOpen = vi.fn();
    const el = renderPersonaButton(document.createElement('div'), { avatar: { name: 'Frits de Roos', initials: 'FD' }, t, onOpen });
    expect(el.querySelector('.cc-persona-button__initials').textContent).toBe('FD');
    expect(el.querySelector('img')).toBeNull();
    const b = el.querySelector('.cc-persona-button__button');
    // its spoken name carries the availability its ring shows (no record: available)
    expect(b.getAttribute('aria-label')).toMatch(/^circle\.persona_button\.label_with_state/);
    expect(b.dataset.availability).toBe('offline');   // no relay connected: available, not connected
    b.click();
    expect(onOpen).toHaveBeenCalled();
  });
  it('the picture when there is one', () => {
    const el = renderPersonaButton(document.createElement('div'), { avatar: { name: 'F', initials: 'F' }, pictureUrl: 'blob:x', t });
    expect(el.querySelector('.cc-persona-button__picture').getAttribute('src')).toBe('blob:x');
    expect(el.querySelector('.cc-persona-button__initials')).toBeNull();
  });
  it('the settings button beside it opens the settings home', () => {
    const onSettings = vi.fn();
    const el = renderPersonaButton(document.createElement('div'), { avatar: { initials: 'F' }, t, onSettings });
    const gear = el.querySelector('.cc-persona-button__settings');
    expect(gear.getAttribute('aria-label')).toBe('circle.persona_button.settings');
    gear.click();
    expect(onSettings).toHaveBeenCalled();
    expect(renderPersonaButton(document.createElement('div'), { avatar: { initials: 'F' }, t }).querySelector('.cc-persona-button__settings')).toBeNull();
  });
});
