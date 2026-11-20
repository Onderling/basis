/**
 * Me's and Vandaag's blocks in words — the availability words and the agents rows — said once, for both shells' painters.
 * Kept apart from `mijScreen.js` so a painter does not pull in the materializer.
 */

/**
 * Vandaag's availability words: available · quiet until … · away (until …) — what both shells paint in the block.
 * @param {{state: string, until?: string}|null} reading   the availability block's reading
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
