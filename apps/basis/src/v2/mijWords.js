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

// the ring's colour per state: existing theme tokens only (src/v2/theme.js), no palette of its own
const RING_TOKEN = Object.freeze({ available: 'green', quiet: 'amber', away: 'inkSoft' });

/**
 * The person's availability as a RING around the persona button (Frits 2026-11-20: availability left Vandaag): the
 * state now and the theme colour token that rings the button. Colour is never the only signal: the button's label
 * (`personaButtonLabel`) names the state, and the persona panel says it in words (`availabilityRow`).
 * @returns {{state: 'available'|'quiet'|'away', token: 'green'|'amber'|'inkSoft'}}
 */
export function availabilityRing(record, { now = Date.now() } = {}) {
  const { state } = availabilityReading(record, now);
  return { state, token: RING_TOKEN[state] };
}

/**
 * The persona panel's one availability row: the state now in words, and that a tap changes it ("beschikbaar · tik om
 * te wijzigen"). A tap opens the availability screen.
 */
export function availabilityRow(record, { now = Date.now(), t } = {}) {
  if (typeof t !== 'function') return '';
  return t('circle.persona_panel.availability_row', { state: availabilityWords(availabilityReading(record, now), { t }) });
}

/** The persona button's spoken name with the state it is ringed by ("Persona, beschikbaar"). */
export function personaButtonLabel(record, { now = Date.now(), t } = {}) {
  if (typeof t !== 'function') return '';
  return t('circle.persona_button.label_with_state', { state: availabilityWords(availabilityReading(record, now), { t }) });
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
