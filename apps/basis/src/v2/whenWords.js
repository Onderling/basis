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
 * The time of day of a moment, on the household's clock: "10:00" ('' for a moment that is not one).
 * @param {string|number|Date} at
 * @param {{tz?: string}} [o]
 */
export function timeWords(at, { tz } = {}) {
  const d = at instanceof Date ? at : new Date(at);
  if (at == null || at === '' || Number.isNaN(d.getTime())) return '';
  return new Intl.DateTimeFormat('en-GB', { ...(tz ? { timeZone: tz } : {}), hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(d);
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

/**
 * A moment that is COMING, in a person's words: "vandaag om 14:00" or "morgen om 09:30" (the local day), the date
 * after that (`whenWords`), and "gesloten" once it has passed — what a vote's deadline says on both shells.
 * @param {string|number|Date} at
 * @param {{t: Function, now?: Date, locale?: string, tz?: string}} o
 * @returns {string}  '' for a moment that is not one
 */
export function momentWords(at, { t, now = new Date(), locale, tz } = {}) {
  const d = at instanceof Date ? at : new Date(at);
  if (at == null || at === '' || Number.isNaN(d.getTime())) return '';
  if (d.getTime() <= now.getTime()) return t('circle.when.closed');
  const dayOf = (x) => new Intl.DateTimeFormat('en-CA', { ...(tz ? { timeZone: tz } : {}), year: 'numeric', month: '2-digit', day: '2-digit' }).format(x);
  const tomorrow = new Date(now.getTime() + 86_400_000);
  const time = timeWords(d, { tz });
  if (dayOf(d) === dayOf(now)) return t('circle.when.today_at', { time });
  if (dayOf(d) === dayOf(tomorrow)) return t('circle.when.tomorrow_at', { time });
  return whenWords(d, { locale, tz });
}

/**
 * The day a home screen is about, as its header: "dinsdag 20 oktober" — the weekday, the day and the month, on the
 * device's clock, in the screen's date language (`dateLocaleOf`).
 * @param {number|Date} [now]
 * @param {{locale?: string, tz?: string}} [o]
 */
export function dayHeader(now = Date.now(), { locale, tz } = {}) {
  const d = now instanceof Date ? now : new Date(now);
  return new Intl.DateTimeFormat(locale, { ...(tz ? { timeZone: tz } : {}), weekday: 'long', day: 'numeric', month: 'long' }).format(d).replace(',', '');
}
