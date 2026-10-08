/**
 * whenWords — a moment in a person's words, on the household's clock: "vr 9 okt 10:00", or the day alone ("za 10 okt")
 * for a moment that has no time of day. One formatting for every line that says when (the bot's replies, a person's
 * "gepland"), so a day reads the same wherever it is said.
 */

/**
 * @param {string|number|Date} at
 * @param {object} [o]
 * @param {string} [o.locale]   the date language ("nl-NL"); absent → the runtime's
 * @param {string} [o.tz]       the zone it is read in; absent → the process's (the box's TZ, the device's)
 * @param {boolean|'auto'} [o.dayOnly]  true: the day alone; 'auto': the day alone when the time is midnight
 * @returns {string}  '' for a moment that is not one
 */
export function whenWords(at, { locale, tz, dayOnly = false } = {}) {
  const d = at instanceof Date ? at : new Date(at);
  if (at == null || at === '' || Number.isNaN(d.getTime())) return '';
  const tzOpt = tz ? { timeZone: tz } : {};
  const hhmm = new Intl.DateTimeFormat('en-GB', { ...tzOpt, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(d);
  const day = new Intl.DateTimeFormat(locale, { ...tzOpt, weekday: 'short', day: 'numeric', month: 'short' }).format(d);
  return dayOnly === true || (dayOnly === 'auto' && hhmm === '00:00') ? day : `${day} ${hhmm}`;
}

/**
 * The date language a translator speaks: its bundle names it (`circle.reply.date_locale`), so a day is written in the
 * language the rest of the line is — on every shell, whatever language the person picked. Undefined when it names none.
 * @param {(key: string) => string} t
 */
export function dateLocaleOf(t) {
  const key = 'circle.reply.date_locale';
  const named = typeof t === 'function' ? t(key) : null;
  if (typeof named !== 'string' || !named || named === key) return undefined;
  try { return Intl.getCanonicalLocales(named)[0]; } catch { return undefined; }
}
