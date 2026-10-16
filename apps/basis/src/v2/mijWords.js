/**
 * Me's blocks in words — the identity line's readings and the agents rows — said once, for both shells' painters.
 * Kept apart from `mijScreen.js` so a painter does not pull in the materializer.
 */
import { whenWords } from './whenWords.js';

const READING_WORDS = {
  availability: (r, tr) => (r.state === 'away'
    ? (r.until ? tr('circle.profile.reading_away', { until: r.until }) : tr('circle.profile.reading_away_open'))
    : r.state === 'quiet' ? tr('circle.profile.reading_quiet', { until: r.until }) : tr('circle.profile.reading_available')),
  online: (r, tr) => tr(r.on ? 'circle.profile.reading_online' : 'circle.profile.reading_offline'),
  unread: (r, tr) => tr('circle.profile.reading_unread', { count: r.count }),
  open: (r, tr) => tr('circle.profile.reading_open', { count: r.count }),
  next: (r, tr, o) => tr('circle.profile.reading_next', { title: r.title, when: whenWords(r.when, o) }),
};

/**
 * The identity line's readings in words, in their order — what both shells paint after the name.
 * @param {{readings?: Array<object>}} content   the materialized identity line
 * @param {object} o
 * @param {(k: string, v?: object) => string} o.t
 * @param {string} [o.locale]
 * @param {string} [o.tz]
 * @returns {string[]}
 */
export function identityLineWords(content, { t, locale, tz } = {}) {
  return (Array.isArray(content?.readings) ? content.readings : [])
    .map((r) => READING_WORDS[r.key]?.(r, t, { locale, tz }))
    .filter((s) => typeof s === 'string' && s);
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
