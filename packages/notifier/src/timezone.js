/**
 * IANA-timezone-aware "next fire at HH:MM" math.
 *
 * Ported from apps/household/src/scheduler/DailyDigest.js (the
 * battle-tested H2 V0 implementation).  Uses only Intl.DateTimeFormat
 * — no `date-fns-tz` or other deps.
 *
 * Precision: ±1 minute on normal days; up to ~1 hour drift on DST
 * transition days.  Acceptable for daily-digest cadence (Q-H2.7).
 */

const MS_PER_DAY = 24 * 60 * 60 * 1000;

/**
 * Compute the next instant in the given timezone where local time
 * equals `atLocal` (HH:MM).
 *
 * @param {number} nowMs    ms epoch — reference "now"
 * @param {string} tz       IANA timezone (e.g. 'Europe/Amsterdam')
 * @param {string} atLocal  'HH:MM'
 * @returns {number}        ms epoch of the next fire
 */
export function nextDailyFireInTz(nowMs, tz, atLocal) {
  const [hh, mm] = parseHHMM(atLocal);
  const nowParts = wallClockInTz(nowMs, tz);

  let target = utcInstantForWallClock({
    year:   nowParts.year,
    month:  nowParts.month,
    day:    nowParts.day,
    hour:   hh,
    minute: mm,
    tz,
  });

  if (target <= nowMs) {
    const tomorrow = addDaysUtc(nowParts, 1);
    target = utcInstantForWallClock({
      year:   tomorrow.year,
      month:  tomorrow.month,
      day:    tomorrow.day,
      hour:   hh,
      minute: mm,
      tz,
    });
  }
  return target;
}

function parseHHMM(s) {
  const m = /^(\d{1,2}):(\d{2})$/.exec(String(s).trim());
  if (!m) throw new Error(`nextDailyFireInTz: bad timeLocal: ${s}`);
  const hh = Number(m[1]);
  const mm = Number(m[2]);
  if (hh < 0 || hh > 23 || mm < 0 || mm > 59) {
    throw new Error(`nextDailyFireInTz: out-of-range timeLocal: ${s}`);
  }
  return [hh, mm];
}

export function wallClockInTz(instantMs, tz) {
  const fmt = new Intl.DateTimeFormat('en-US', {
    timeZone: tz,
    year:    'numeric',
    month:   '2-digit',
    day:     '2-digit',
    hour:    '2-digit',
    minute:  '2-digit',
    second:  '2-digit',
    hour12:  false,
  });
  const parts = fmt.formatToParts(new Date(instantMs));
  const out = {};
  for (const p of parts) {
    if (p.type === 'year')   out.year   = Number(p.value);
    if (p.type === 'month')  out.month  = Number(p.value);
    if (p.type === 'day')    out.day    = Number(p.value);
    if (p.type === 'hour')   out.hour   = Number(p.value);
    if (p.type === 'minute') out.minute = Number(p.value);
    if (p.type === 'second') out.second = Number(p.value);
  }
  if (out.hour === 24) out.hour = 0;
  return out;
}

export function utcInstantForWallClock({ year, month, day, hour, minute, tz }) {
  const naiveUtcMs = Date.UTC(year, month - 1, day, hour, minute, 0, 0);
  const wall       = wallClockInTz(naiveUtcMs, tz);
  const wallAsUtcMs = Date.UTC(
    wall.year, wall.month - 1, wall.day,
    wall.hour, wall.minute, wall.second || 0, 0,
  );
  const offsetMs = wallAsUtcMs - naiveUtcMs;
  return naiveUtcMs - offsetMs;
}

function addDaysUtc({ year, month, day }, n) {
  const ms = Date.UTC(year, month - 1, day) + n * MS_PER_DAY;
  const d  = new Date(ms);
  return {
    year:  d.getUTCFullYear(),
    month: d.getUTCMonth() + 1,
    day:   d.getUTCDate(),
  };
}
