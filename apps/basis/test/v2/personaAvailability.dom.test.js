/**
 * The person's availability, off Vandaag (Frits 2026-11-20, his written answer to point 4): a coloured RING around the
 * persona button, from one shared helper (`availabilityRing`: the state to an existing colour token), and the words
 * with the control in the persona panel (one row: the state, tap to change). Colour is never the only signal: the
 * button's accessible label names the state too.
 * @vitest-environment happy-dom
 */
import { describe, it, expect, vi } from 'vitest';
import { availabilityRing, availabilityRow, personaButtonLabel } from '../../src/v2/mijWords.js';
import { renderPersonaButton } from '../../web/v2/personaButton.js';
import { renderPersonaPanel } from '../../web/v2/personaPanel.js';
import { THEME } from '../../src/v2/theme.js';

const t = (k, v) => (v ? `${k}:${JSON.stringify(v)}` : k);
const NOW = Date.parse('2026-11-20T12:00:00Z');
const AWAY = { holiday: { active: true, until: '2026-12-01' } };

describe('the shared helper', () => {
  it('maps the state to an existing colour token: available green, quiet amber, away the soft ink', () => {
    expect(availabilityRing(null, { now: NOW })).toEqual({ state: 'available', token: 'green' });
    expect(availabilityRing(AWAY, { now: NOW })).toEqual({ state: 'away', token: 'inkSoft' });
    expect(availabilityRing({ quietHours: { enabled: true, from: '00:00', to: '23:59' } }, { now: NOW }).token).toBe('amber');
    for (const tok of ['green', 'amber', 'inkSoft']) expect(THEME.color[tok], tok).toBeTruthy();
  });

  it('the panel row says the state and that a tap changes it; the button label names the state', () => {
    expect(availabilityRow(null, { now: NOW, t })).toBe('circle.persona_panel.availability_row:{"state":"circle.profile.reading_available"}');
    expect(personaButtonLabel(AWAY, { now: NOW, t })).toContain('circle.persona_button.label_with_state');
    expect(personaButtonLabel(AWAY, { now: NOW, t })).toContain('reading_away');
  });
});

describe('web: the ring on the persona button, the row in the panel', () => {
  it('the button carries the ring of the state, and its label names it', () => {
    const el = renderPersonaButton(document.createElement('div'), { avatar: { initials: 'BB' }, availability: AWAY, now: NOW, t, onOpen: () => {} });
    const b = el.querySelector('.cc-persona-button__button');
    expect(b.dataset.availability).toBe('away');
    expect(b.style.boxShadow).toContain('var(--ink-soft)');
    expect(b.getAttribute('aria-label')).toContain('reading_away');
  });

  it('the panel holds one availability row; a tap opens the availability screen', () => {
    const onAvailability = vi.fn();
    const card = document.createElement('div');
    renderPersonaPanel(card, { model: { tabs: [], showAs: false }, t, availability: null, now: NOW, onAvailability });
    const rows = card.querySelectorAll('.cc-persona-panel__availability');
    expect(rows).toHaveLength(1);
    expect(rows[0].textContent).toBe('circle.persona_panel.availability_row:{"state":"circle.profile.reading_available"}');
    rows[0].click();
    expect(onAvailability).toHaveBeenCalled();
  });
});
