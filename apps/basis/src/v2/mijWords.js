/**
 * The availability (the persona button's ring and label, the panel's row) and Me's agents rows in words — said once, for both shells' painters.
 * Kept apart from `mijScreen.js` so a painter does not pull in the materializer.
 */

import { normalizeAvailability, isPushSuppressed } from './memberAvailability.js';

/**
 * The availability reading of a stored record at `now`: available · quiet until … · away (until …). No record is
 * available (the default), never a guess.
 * @returns {{key: 'availability', state: 'available'|'quiet'|'away', until?: string|null}}
 */
export function availabilityReading(record, now = Date.now()) {
  const a = normalizeAvailability(record ?? {});
  if (a.holiday.active && isPushSuppressed({ ...a, quietHours: { ...a.quietHours, enabled: false } }, new Date(now))) return { key: 'availability', state: 'away', until: a.holiday.until };
  if (isPushSuppressed(a, new Date(now))) return { key: 'availability', state: 'quiet', until: a.quietHours.to };
  return { key: 'availability', state: 'available' };
}

/**
 * Is this device connected? The relay fact the shells already show (the connection points list): connected at one of
 * its relays (`agent.relays.list()` rows' `connected`). No relays, or none answering: not connected.
 * @param {Array<{connected?: boolean}>|null} rows
 */
export function connectedAtRelay(rows) {
  return Array.isArray(rows) && rows.some((r) => r?.connected === true);
}

/**
 * The person's presence now: availability AND connection, one of four states, in this precedence (Frits 2026-11-20):
 * away (holiday) > quiet (quiet hours) > available and connected > available but not connected (`offline`).
 * @returns {{state: 'away'|'quiet'|'available'|'offline', until?: string|null}}
 */
export function presenceReading(record, { now = Date.now(), connected = false } = {}) {
  const r = availabilityReading(record, now);
  if (r.state !== 'available') return r;
  return { key: 'availability', state: connected ? 'available' : 'offline' };
}

// the ring's colour per state: existing theme tokens only (src/v2/theme.js), no palette of its own; away is calm and
// clearly not grey, never danger
const RING_TOKEN = Object.freeze({ available: 'green', offline: 'inkSoft', quiet: 'amber', away: 'blue' });

/**
 * The person's presence as a RING around the persona button (Frits 2026-11-20: availability left Vandaag): the state
 * now (`presenceReading`) and the theme colour token that rings the button. Colour is never the only signal: the
 * button's label (`personaButtonLabel`) names the state, and the persona panel says it in words (`availabilityRow`).
 * @returns {{state: 'away'|'quiet'|'available'|'offline', token: 'blue'|'amber'|'green'|'inkSoft'}}
 */
export function availabilityRing(record, { now = Date.now(), connected = false } = {}) {
  const { state } = presenceReading(record, { now, connected });
  return { state, token: RING_TOKEN[state] };
}

/** The presence in words: away/quiet as the availability words; available as "beschikbaar, (niet) verbonden". */
export function presenceWords(reading, { t } = {}) {
  if (!reading || typeof t !== 'function') return '';
  if (reading.state === 'available') return t('circle.profile.reading_available_connected');
  if (reading.state === 'offline') return t('circle.profile.reading_available_offline');
  return availabilityWords(reading, { t });
}

/**
 * The persona panel's one availability row: the presence now in words, and that a tap changes it ("beschikbaar, niet
 * verbonden · tik om te wijzigen"). A tap opens the availability screen.
 */
export function availabilityRow(record, { now = Date.now(), connected = false, t } = {}) {
  if (typeof t !== 'function') return '';
  return t('circle.persona_panel.availability_row', { state: presenceWords(presenceReading(record, { now, connected }), { t }) });
}

/** The persona button's spoken name with the state its ring shows ("Persona, beschikbaar, verbonden"). */
export function personaButtonLabel(record, { now = Date.now(), connected = false, t } = {}) {
  if (typeof t !== 'function') return '';
  return t('circle.persona_button.label_with_state', { state: presenceWords(presenceReading(record, { now, connected }), { t }) });
}

/**
 * The availability words: available · quiet until … · away (until …) — what the panel row and the button's label say.
 * @param {{state: string, until?: string}|null} reading   the availability reading (`availabilityReading`)
 * @param {{ t: (k: string, v?: object) => string }} o
 * @returns {string}
 */
export function availabilityWords(reading, { t } = {}) {
  if (!reading || typeof t !== 'function') return '';
  if (reading.state === 'away') return reading.until ? t('circle.profile.reading_away', { until: reading.until }) : t('circle.profile.reading_away_open');
  if (reading.state === 'quiet') return t('circle.profile.reading_quiet', { until: reading.until });
  return t('circle.profile.reading_available');
}

/**
 * One agents-block row in words: "this device", "device: laptop", "companion: tablet", "bot: Huishoudbot, linked to you".
 * @param {{kind: string, label: string|null, here?: boolean}} row
 * @param {(k: string, v?: object) => string} t
 */
export function agentRowWords(row, t) {
  if (row?.kind === 'device') {
    if (row.here) return row.label ? `${t('circle.profile.agent_here')} (${row.label})` : t('circle.profile.agent_here');
    return row.label ? t('circle.profile.agent_device', { label: row.label }) : t('circle.profile.agent_device_unnamed');
  }
  if (row?.kind === 'companion') return t('circle.profile.agent_companion', { label: row.label ?? '' });
  if (row?.kind === 'bot') return t('circle.profile.agent_bot', { label: row.label ?? '' });
  return '';
}

/**
 * One row of "my devices" (My data) in words — never the `d-…` device id. A device the person named is called that;
 * THIS device is "this device (its model)", the name the shell reads from the phone or the browser, as Me says it;
 * any other unnamed device is "another device". The same words as Me's agents block (`agentRowWords`).
 *
 * @param {{deviceId: string, label?: string|null}} d   a registry delegation row
 * @param {{ thisDeviceId?: string|null, deviceName?: string|null, t: (k: string, v?: object) => string }} opts
 * @returns {string}
 */
export function deviceListWords(d, { thisDeviceId = null, deviceName = null, t } = {}) {
  const here = Boolean(thisDeviceId) && d?.deviceId === thisDeviceId;
  const own = typeof d?.label === 'string' && d.label.trim() ? d.label.trim() : null;
  const label = own ?? (here && typeof deviceName === 'string' && deviceName.trim() ? deviceName.trim() : null);
  return agentRowWords({ kind: 'device', label, here }, t);
}
