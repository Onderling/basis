/**
 * basis v2 — holiday extension shortcuts + outgoing auto-reply.
 *
 * The holiday-mode card has two pieces this slice closes:
 *   1. "Verlengen: + 7 dagen · + 14 dagen · einddatum aanpassen" —
 *      shortcuts that bump the existing `holiday.until` by N days
 *      without manually picking a new date.
 *   2. "Anderen die jou aanspreken zien: 'Bob is t/m 9 jun even niet
 *      bereikbaar'" — an outgoing auto-reply preview the peer-ping
 *      consumer (reciprocity notice) shows when someone
 *      tries to reach an away user.
 *
 * Pure: hosts pass current availability + a (`+N days` or absolute)
 * extension; we return the new availability.  No storage, no locale.
 */

import { normalizeAvailability } from './memberAvailability.js';
import { translatorOr } from '../locales/translatorOr.js';

/**
 * Add `days` to the current holiday end-date (ISO yyyy-mm-dd).  Returns
 * a NEW availability with the extended `until`.  If holiday isn't
 * active, the call is still safe — it activates holiday + extends from
 * today.  Negative days clamps to today (no shrinking below "today").
 *
 * @param {object} availability
 * @param {number} days
 * @param {() => Date} [nowFn=() => new Date()]
 * @returns {object} new availability
 */
export function extendHolidayDays(availability, days, nowFn = () => new Date()) {
  const a = normalizeAvailability(availability);
  if (!Number.isFinite(days)) return a;
  const now = nowFn();
  const fromDate = a.holiday.until
    ? new Date(`${a.holiday.until}T00:00:00`)
    : new Date(now.getFullYear(), now.getMonth(), now.getDate());
  // Clamp: floor of "today".
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const tentative = new Date(fromDate.getTime() + days * 86_400_000);
  const target = tentative < today ? today : tentative;
  return {
    ...a,
    holiday: {
      active: true,
      until:  toIsoDate(target),
    },
  };
}

/**
 * Set an absolute end-date (or clear it with `null`).  Returns new
 * availability.  Empty / non-string inputs treated as "no change".
 */
export function setHolidayUntil(availability, untilIso) {
  const a = normalizeAvailability(availability);
  if (untilIso === null) {
    return { ...a, holiday: { ...a.holiday, until: null } };
  }
  if (typeof untilIso !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(untilIso)) return a;
  return { ...a, holiday: { active: true, until: untilIso } };
}

/**
 * Build the auto-reply text shown to *other* members trying to reach
 * the user during holiday mode.  Returns null when holiday isn't
 * active (the peer-side notice should fall back to the standard
 * reciprocity copy).
 *
 * @param {object} args
 * @param {object} args.availability
 * @param {string} [args.name]      sender label shown to the peer
 * @param {function} args.t         host translator (key,vars → string)
 * @returns {{ active: boolean, text: string|null }}
 */
export function buildHolidayAutoReply({ availability, name, t } = {}) {
  const a = normalizeAvailability(availability);
  if (!a.holiday.active) return { active: false, text: null };
  const tr = translatorOr(t, 'holidayShortcuts.js');
  const safeName = typeof name === 'string' && name.trim() ? name.trim() : null;
  if (a.holiday.until) {
    return {
      active: true,
      text: safeName
        ? tr('circle.holiday.autoReply', { name: safeName, until: a.holiday.until })
        : tr('circle.holiday.autoReplyAnon', { until: a.holiday.until }),
    };
  }
  return {
    active: true,
    text: safeName
      ? tr('circle.holiday.autoReplyNoEnd', { name: safeName })
      : tr('circle.holiday.autoReplyAnonNoEnd'),
  };
}

function toIsoDate(d) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}
