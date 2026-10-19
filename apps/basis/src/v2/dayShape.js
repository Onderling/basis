/**
 * THE DAY'S SHAPE on Vandaag — one model both shells paint.
 *   • appointments in groups by their moment: now (started within the last two hours) · soon (the next two hours) ·
 *     later today · tomorrow · after; only the groups that have any, in that order, the first one open and the rest
 *     folded;
 *   • chores: the open ones first, the done ones folded under "gedaan (n)".
 */

import { whenWords, timeWords } from './whenWords.js';

const HOUR = 3_600_000;
const GROUPS = Object.freeze(['now', 'soon', 'later', 'tomorrow', 'after']);

function groupOf(when, now) {
  if (!Number.isFinite(when) || when <= 0) return 'after';
  if (when <= now) return when > now - 2 * HOUR ? 'now' : 'after';
  if (when <= now + 2 * HOUR) return 'soon';
  const endOfToday = new Date(now); endOfToday.setHours(24, 0, 0, 0);
  if (when < endOfToday.getTime()) return 'later';
  const endOfTomorrow = new Date(endOfToday); endOfTomorrow.setDate(endOfTomorrow.getDate() + 1);
  if (when < endOfTomorrow.getTime()) return 'tomorrow';
  return 'after';
}

/**
 * @param {Array<{when?: number}>} items   rows with their moment (ms)
 * @param {{now?: number}} [o]
 * @returns {Array<{key: string, labelKey: string, open: boolean, items: object[]}>}
 */
export function agendaGroups(items, { now = Date.now(), t = null, locale } = {}) {
  const by = new Map(GROUPS.map((k) => [k, []]));
  for (const it of items ?? []) {
    const key = groupOf(it?.when, now);
    by.get(key).push(typeof t === 'function' ? { ...it, moment: momentWords(it?.when, key, { t, locale }) } : it);
  }
  const out = GROUPS.filter((k) => by.get(k).length).map((k) => ({ key: k, labelKey: `circle.vandaag.group_${k}`, open: false, items: by.get(k) }));
  if (out.length) out[0].open = true;
  return out;
}

/**
 * @param {Array<{done?: boolean}>} items   rows with their done flag (the noun's declared `done`)
 * @returns {{open: object[], done: object[]}}
 */
export function taskGroups(items) {
  const open = []; const done = [];
  for (const it of items ?? []) (it?.done ? done : open).push(it);
  return { open, done };
}

/**
 * The moment in words inside its group: "om 14:00" today (now · soon · later), the time under "tomorrow", the day and
 * the time after that; '' for a row without one.
 * @param {number} when @param {string} key @param {{t: Function, locale?: string}} o
 */
export function momentWords(when, key, { t, locale } = {}) {
  if (!Number.isFinite(when) || when <= 0) return '';
  if (key === 'now' || key === 'soon' || key === 'later') return t('circle.vandaag.at_time', { time: timeWords(when) });
  if (key === 'tomorrow') return timeWords(when);
  return whenWords(when, { locale, dayOnly: 'auto' });
}

