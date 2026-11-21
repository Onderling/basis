/**
 * The person's availability, off Vandaag (Frits 2026-11-20, his written answer to point 4): a coloured RING around the
 * persona button, from one shared helper (`availabilityRing`: the state to an existing colour token), and the words
 * with the control in the persona panel (one row: the state, tap to change). Colour is never the only signal: the
 * button's accessible label names the state too.
 * @vitest-environment happy-dom
 */
import { describe, it, expect, vi } from 'vitest';
import { availabilityRing, availabilityRow, personaButtonLabel, connectedAtRelay } from '../../src/v2/mijWords.js';
import { renderPersonaButton } from '../../web/v2/personaButton.js';
import { renderPersonaPanel } from '../../web/v2/personaPanel.js';
import { THEME } from '../../src/v2/theme.js';

const t = (k, v) => (v ? `${k}:${JSON.stringify(v)}` : k);
const NOW = Date.parse('2026-11-20T12:00:00Z');
const AWAY = { holiday: { active: true, until: '2026-12-01' }, quietHours: { enabled: true, from: '00:00', to: '23:59' } };   // away wins over quiet
const QUIET = { quietHours: { enabled: true, from: '00:00', to: '23:59' } };

describe('the shared helper: availability and connection, four states (Frits 2026-11-20)', () => {
  it('connection is the relay fact the shells show: connected at one of its relays', () => {
    expect(connectedAtRelay([{ url: 'a', connected: false }, { url: 'b', connected: true }])).toBe(true);
    expect(connectedAtRelay([{ url: 'a', connected: false }])).toBe(false);
    expect(connectedAtRelay([])).toBe(false);
    expect(connectedAtRelay(null)).toBe(false);
  });

  it('away > quiet > available and connected > available, not connected; existing tokens, away never grey or danger', () => {
    expect(availabilityRing(AWAY, { now: NOW, connected: true })).toEqual({ state: 'away', token: 'blue' });
    expect(availabilityRing(QUIET, { now: NOW, connected: true })).toEqual({ state: 'quiet', token: 'amber' });
    expect(availabilityRing(null, { now: NOW, connected: true })).toEqual({ state: 'available', token: 'green' });
    expect(availabilityRing(null, { now: NOW, connected: false })).toEqual({ state: 'offline', token: 'inkSoft' });
    expect(availabilityRing(null, { now: NOW })).toEqual({ state: 'offline', token: 'inkSoft' });
    for (const tok of ['green', 'amber', 'inkSoft', 'blue']) expect(THEME.color[tok], tok).toBeTruthy();
  });

  it('the panel row and the button label say the state in words, connection included', () => {
    expect(availabilityRow(null, { now: NOW, connected: false, t })).toBe('circle.persona_panel.availability_row:{"state":"circle.profile.reading_available_offline"}');
    expect(availabilityRow(null, { now: NOW, connected: true, t })).toBe('circle.persona_panel.availability_row:{"state":"circle.profile.reading_available_connected"}');
    expect(personaButtonLabel(AWAY, { now: NOW, t })).toContain('circle.persona_button.label_with_state');
    expect(personaButtonLabel(AWAY, { now: NOW, t })).toContain('reading_away');
    expect(personaButtonLabel(null, { now: NOW, connected: false, t })).toContain('reading_available_offline');
  });
});

describe('web: the ring on the persona button, the row in the panel', () => {
  it('the button carries the ring of the state, and its label names it', () => {
    const el = renderPersonaButton(document.createElement('div'), { avatar: { initials: 'BB' }, availability: AWAY, connected: true, now: NOW, t, onOpen: () => {} });
    const b = el.querySelector('.cc-persona-button__button');
    expect(b.dataset.availability).toBe('away');
    expect(b.style.boxShadow).toContain('var(--blue)');
    expect(b.getAttribute('aria-label')).toContain('reading_away');
  });

  it('the panel holds one availability row; a tap opens the availability screen', () => {
    const onAvailability = vi.fn();
    const card = document.createElement('div');
    renderPersonaPanel(card, { model: { tabs: [], showAs: false }, t, availability: null, connected: true, now: NOW, onAvailability });
    const rows = card.querySelectorAll('.cc-persona-panel__availability');
    expect(rows).toHaveLength(1);
    expect(rows[0].textContent).toBe('circle.persona_panel.availability_row:{"state":"circle.profile.reading_available_connected"}');
    rows[0].click();
    expect(onAvailability).toHaveBeenCalled();
  });
});
