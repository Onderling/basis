/**
 * basis — relaxed date parser (Slack-style).
 *
 * Per OQ-3.A user resolution (2026-05-23): mimic Slack's flexibility.
 *
 * Backed by `chrono-node` — battle-tested natural-language date
 * parser handling: 'next tuesday 3pm', 'in 2 hours', 'tomorrow
 * morning', '5/30 4:30pm', 'feb 15', etc.
 *
 * basis keeps a small fast-path for ISO + the handful of
 * keywords that already had test coverage (today / tomorrow /
 * morgen / weekday names in EN + NL) so behaviour stays predictable
 * when chrono's heuristics drift across versions.
 *
 * Returns an ISO-8601 date string ('YYYY-MM-DD') OR null on parse
 * failure.  Caller (validateAndCoerce) treats null as a validation
 * error.
 *
 * Phase v0.3 (original) → v0.6 OQ-3.A catch-up 2026-05-23.
 */

import * as chrono from 'chrono-node';

const WEEKDAYS_EN = [
  'sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday',
];
const WEEKDAYS_NL = [
  'zondag', 'maandag', 'dinsdag', 'woensdag', 'donderdag', 'vrijdag', 'zaterdag',
];

/**
 * Parse a date-ish string into an ISO date.  Slack-style: accepts
 * a wide range of inputs via chrono-node, with a fast-path for the
 * canonical cases the basis tests already pin.
 *
 * @param {string}        input
 * @param {object}        [opts]
 * @param {() => Date}    [opts.now=() => new Date()]   injectable clock
 * @returns {string | null}                              'YYYY-MM-DD' or null
 */
export function parseRelativeDate(input, opts = {}) {
  if (typeof input !== 'string') return null;
  const trimmed = input.trim();
  if (trimmed === '') return null;
  const raw = trimmed.toLowerCase();
  const now = (typeof opts.now === 'function' ? opts.now() : new Date());

  // Fast path 1: ISO date / datetime — pass through deterministically.
  if (/^\d{4}-\d{2}-\d{2}([Tt].*)?$/.test(trimmed)) {
    const d = new Date(trimmed);
    if (!Number.isNaN(d.getTime())) return toIsoDate(d);
  }

  // Fast path 2: pinned keywords.  chrono handles 'today' / 'tomorrow'
  // but we keep the explicit paths so EN+NL parity is locked in
  // tests and doesn't depend on chrono locale support.
  if (raw === 'today') return toIsoDate(now);
  if (raw === 'tomorrow' || raw === 'morgen') {
    const d = new Date(now);
    d.setUTCDate(d.getUTCDate() + 1);
    return toIsoDate(d);
  }

  const enIdx = WEEKDAYS_EN.indexOf(raw);
  const nlIdx = WEEKDAYS_NL.indexOf(raw);
  const wkIdx = enIdx !== -1 ? enIdx : nlIdx;
  if (wkIdx !== -1) {
    const todayIdx = now.getUTCDay();
    const delta = (wkIdx - todayIdx + 7) % 7;
    const d = new Date(now);
    d.setUTCDate(d.getUTCDate() + delta);
    return toIsoDate(d);
  }

  // Slack-style fallback: feed it to chrono.  forwardDate biases
  // ambiguous dates ('feb 15') toward the future.
  try {
    const parsed = chrono.parseDate(trimmed, now, { forwardDate: true });
    if (parsed instanceof Date && !Number.isNaN(parsed.getTime())) {
      return toIsoDate(parsed);
    }
  } catch {
    // chrono throws on some pathological inputs; treat as null.
  }

  return null;
}

function toIsoDate(d) {
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, '0');
  const da = String(d.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${da}`;
}

/**
 * v0.7.-followup 2026-05-23 — same parser, but PRESERVES time-of
 * day when the input includes a clock component.  Calendar event
 * startsAt + endsAt need full datetime; the date-only
 * parseRelativeDate above was dropping '3pm' / '15:00' info.
 *
 * Returns:
 *   - full ISO datetime (YYYY-MM-DDTHH:mm:ssZ) when time was specified
 *   - YYYY-MM-DD when only a date was given (back-compat with the
 *     calendar's parseDateInput which appends midnight UTC)
 *   - null when unparseable
 *
 * @param {string} input
 * @param {object} [opts]
 * @param {() => Date} [opts.now]
 * @returns {string|null}
 */
export function parseDateAndTime(input, opts = {}) {
  if (typeof input !== 'string') return null;
  const trimmed = input.trim();
  if (trimmed === '') return null;
  const raw = trimmed.toLowerCase();
  const now = (typeof opts.now === 'function' ? opts.now() : new Date());

  // ISO datetime — passthrough.
  if (/^\d{4}-\d{2}-\d{2}T/i.test(trimmed)) {
    const d = new Date(trimmed);
    if (!Number.isNaN(d.getTime())) return d.toISOString();
  }
  // ISO date — passthrough (no time component).
  if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) {
    return trimmed;
  }
  // Today / tomorrow / weekday — keyword-only (no time) → date-only.
  if (raw === 'today' || raw === 'tomorrow' || raw === 'morgen'
      || WEEKDAYS_EN.includes(raw) || WEEKDAYS_NL.includes(raw)) {
    return parseRelativeDate(trimmed, { now: () => now });
  }
  // chrono — preserves time component when present.
  try {
    const parsed = chrono.parseDate(trimmed, now, { forwardDate: true });
    if (parsed instanceof Date && !Number.isNaN(parsed.getTime())) {
      // Detect whether the input mentioned a time.  Heuristic: chrono
      // returns a date with hours/minutes/seconds set to 0 when no
      // time was parsed; non-zero implies time was given.
      const hasTime = parsed.getHours()   !== 0
                   || parsed.getMinutes() !== 0
                   || parsed.getSeconds() !== 0
                   || /\d{1,2}\s*(:\d{2}|am|pm)/i.test(trimmed);
      if (hasTime) return parsed.toISOString();
      return toIsoDate(parsed);
    }
  } catch {
    // chrono throws on pathological inputs; null below.
  }
  return null;
}

/**
 * The BOUNDED reader (Fable, 2026-10-01): a day word plus an optional time, on the household's own clock — the box
 * runs in its zone, so a local date is the household's day, never a UTC one. Deterministic on purpose: a door's rule
 * must read "tandarts morgen om 10 uur" the same way every time, with no model; anything outside these words is not
 * read (the model's, or "say the day and the time").
 *
 *   day:  vandaag · morgen · overmorgen · maandag…zondag (its next occurrence; today counts) · volgende week <dag>
 *         today · tomorrow · the day after tomorrow · monday…sunday · next week <day>
 *   time: om 10 (uur) · om half 3 · 14:30 / 14.30 · at 10 · at 3pm / 10am
 *         An hour 1–6 without am/pm or minutes is the afternoon ("om 3 uur" → 15:00, "om half 3" → 14:30).
 *
 * @param {string} text
 * @param {{now?: () => Date}} [opts]
 * @returns {{day: string, time: string|null, rest: string} | null}  `rest`: the text without the day and time words
 */
export function readDayAndTime(text, opts = {}) {
  if (typeof text !== 'string' || !text.trim()) return null;
  const now = typeof opts.now === 'function' ? opts.now() : new Date();
  let s = ` ${text.trim().toLowerCase().replace(/\s+/g, ' ')} `;
  const pad = (n) => String(n).padStart(2, '0');
  const local = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  const plus = (n) => { const d = new Date(now.getFullYear(), now.getMonth(), now.getDate()); d.setDate(d.getDate() + n); return d; };
  const DAYS = ['zondag|sunday', 'maandag|monday', 'dinsdag|tuesday', 'woensdag|wednesday', 'donderdag|thursday', 'vrijdag|friday', 'zaterdag|saturday'];
  const dayIdx = (w) => DAYS.findIndex((alts) => alts.split('|').includes(w));
  const WD = DAYS.join('|');

  let day = null;
  const take = (re, fn) => { if (day) return; const m = re.exec(s); if (m) { day = fn(m); s = s.replace(m[0], ' '); } };
  take(new RegExp(` (?:volgende week|next week) (${WD}) `), (m) => {
    const today = now.getDay(); const monOffset = (today + 6) % 7;            // days since this week's Monday
    const nextMon = 7 - monOffset;
    return local(plus(nextMon + ((dayIdx(m[1]) + 6) % 7)));
  });
  take(/ (?:overmorgen|the day after tomorrow) /, () => local(plus(2)));
  take(/ (?:morgen|tomorrow) /, () => local(plus(1)));
  take(/ (?:vandaag|today) /, () => local(plus(0)));
  take(new RegExp(` (${WD}) `), (m) => local(plus((dayIdx(m[1]) - now.getDay() + 7) % 7)));
  if (!day) return null;

  let time = null;
  let bad = false;
  const setTime = (h, min, explicit) => {
    let hour = Number(h); const minute = Number(min ?? 0);
    if (!explicit && hour >= 1 && hour <= 6) hour += 12;
    if (!(hour >= 0 && hour <= 23 && minute >= 0 && minute <= 59)) { bad = true; return; }
    time = `${pad(hour)}:${pad(minute)}`;
  };
  const tt = (re, fn) => { if (time || bad) return; const m = re.exec(s); if (m) { fn(m); s = s.replace(m[0], ' '); } };
  tt(/ om half (\d{1,2})(?: uur)? /, (m) => setTime(Number(m[1]) - 1, 30, false));
  tt(/ at (\d{1,2})(?::(\d{2}))? ?(am|pm) /, (m) => { let h = Number(m[1]) % 12; if (m[3] === 'pm') h += 12; setTime(h, m[2], true); });
  tt(/ (?:om |at )?(\d{1,2})[:.](\d{2})(?: uur)? /, (m) => setTime(m[1], m[2], true));
  tt(/ (?:om|at) (\d{1,2})(?: uur)? /, (m) => setTime(m[1], 0, false));
  if (bad) return null;

  const rest = s.replace(/\s+/g, ' ').trim().replace(/[,.;:!?]+$/, '').trim();
  return { day, time, rest };
}
