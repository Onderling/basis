/**
 * intentions — pending work, READ. Two pure projections over the intention rows a host holds:
 *
 *   upcoming({ rows, done, now, tz, horizon }) → every occurrence in time order: `planned` (still ahead), `due`
 *     (its moment has come, inside its window) or `skipped` (its window passed and it never ran);
 *   due({ rows, done, now, tz })              → the `due` ones: what a host's tick runs.
 *
 * Windows: an `at` row and an `every` row with a clock time may run the rest of that local day; an interval row
 * (`everyMs`) the whole interval; a row's own `window` ('day' or milliseconds) wins.
 *
 * Nothing is stored but the rows and the done-marks. An occurrence's id is its row (`at`) or its row and slot
 * (`<row>:<slot>`), and a done-mark under that id — or a `lastRunAt` on the row at or after it — takes it off. Of the
 * occurrences already past, only the LATEST of each row counts: a host that was off for a month runs a missed job once,
 * not thirty times; and nothing before the row was made exists. The trigger grammar is the type's (closed); a trigger
 * outside it has no occurrences.
 *
 *   eventOccurrences({ rows, change, done }) → the rows an item CHANGE fires: an event trigger
 *     `{ event: { kind: 'added'|'changed', type?, circleId?, field? } }` matches a new item (`added`) or a changed one
 *     (`changed`; with `field`, only when that field — or one of those fields — differs), of its type, in its circle.
 *     Its occurrence is `<row>:<item>:<version>`: one change acts once per row, a later change of the same item is new.
 *     Event rows have no moments in time; time rows never fire on a change.
 */
import { wallClockInTz, utcInstantForWallClock } from '@onderling/notifier';

const DAY = 24 * 3_600_000;
const WEEKDAYS = Object.freeze(['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat']);
const HHMM = /^([01]\d|2[0-3]):([0-5]\d)$/;
const pad = (n) => String(n).padStart(2, '0');
const ms = (v) => (v == null || v === '' ? NaN : (typeof v === 'number' ? v : new Date(v).getTime()));

/** The id a done-mark is written under. */
export const occurrenceId = (row, slot) => (row?.trigger?.at != null && row?.trigger?.every == null ? String(row.id) : `${row.id}:${slot}`);

/** The local calendar day after `w` (a wall clock), as {year, month, day}. */
const nextDay = (w, n = 1) => { const d = new Date(Date.UTC(w.year, w.month - 1, w.day) + n * DAY); return { year: d.getUTCFullYear(), month: d.getUTCMonth() + 1, day: d.getUTCDate() }; };
const ymd = (w) => `${w.year}-${pad(w.month)}-${pad(w.day)}`;
/** The instant the local day of `instant` ends (the next local midnight). */
const endOfLocalDay = (instant, tz) => { const n = nextDay(wallClockInTz(instant, tz)); return utcInstantForWallClock({ ...n, hour: 0, minute: 0, tz }); };

/**
 * A row's occurrences between `from` and `to` (instants), plus each one's natural window end. Calendar rows walk the
 * local days; interval rows step from their start.
 * @returns {Array<{slot: string, at: number, windowEnd: number}>}
 */
function occurrencesOf(row, from, to, tz) {
  const t = row.trigger ?? {};
  if (t.every === 'day' || t.every === 'week') {
    const m = HHMM.exec(String(t.at ?? ''));
    if (!m) return [];
    if (t.every === 'week' && !WEEKDAYS.includes(t.on)) return [];
    const out = [];
    let w = wallClockInTz(from - DAY, tz);
    const last = ymd(wallClockInTz(to + DAY, tz));
    for (let guard = 0; guard < 800; guard += 1) {
      const day = { year: w.year, month: w.month, day: w.day };
      const weekday = WEEKDAYS[new Date(Date.UTC(day.year, day.month - 1, day.day)).getUTCDay()];
      if (t.every === 'day' || weekday === t.on) {
        const at = utcInstantForWallClock({ ...day, hour: Number(m[1]), minute: Number(m[2]), tz });
        if (at >= from && at <= to) out.push({ slot: ymd(day), at });
      }
      if (ymd(day) === last) break;
      w = nextDay(day);
    }
    // a row with a clock time may still run the rest of THAT day: the Sunday overview is not sent on a Wednesday
    return out.map((o) => ({ ...o, windowEnd: endOfLocalDay(o.at, tz) }));
  }
  if (Number.isFinite(t.everyMs) && t.everyMs > 0 && Number.isFinite(ms(t.from))) {
    const start = ms(t.from);
    const out = [];
    let k = Math.max(0, Math.ceil((from - start) / t.everyMs));
    for (let at = start + k * t.everyMs; at <= to && out.length < 400; k += 1, at = start + k * t.everyMs) {
      out.push({ slot: new Date(at).toISOString(), at, windowEnd: at + t.everyMs });
    }
    return out;
  }
  if (t.at != null && t.every == null && Number.isFinite(ms(t.at))) {
    const at = ms(t.at);
    return at >= from && at <= to ? [{ slot: '', at, windowEnd: endOfLocalDay(at, tz) }] : [];
  }
  return [];
}

/** How far back an occurrence can still be due: the longest natural window (a week, or the interval). */
const lookbackOf = (row) => {
  const t = row.trigger ?? {};
  if (Number.isFinite(t.everyMs) && t.everyMs > 0) return t.everyMs;
  return 8 * DAY;
};

/**
 * @param {object} a
 * @param {object[]} a.rows      intention rows (other types and closed rows are passed over)
 * @param {Set<string>} [a.done] occurrence ids with a done-mark
 * @param {number} a.now
 * @param {string} a.tz          the zone wall-clock triggers are read in
 * @param {number} [a.horizon]   how far ahead to list (ms)
 */
export function upcoming({ rows, done = new Set(), now, tz, horizon = 7 * DAY }) {
  const out = [];
  for (const row of rows ?? []) {
    if (!row || row.type !== 'intention' || (row.state && row.state !== 'open')) continue;
    const born = ms(row.createdAt);
    const ran = ms(row.lastRunAt);
    const from = Math.max(now - lookbackOf(row), Number.isFinite(born) ? born : -Infinity);
    const all = occurrencesOf(row, from, now + horizon, tz);
    // of what is already past, the latest only
    const past = all.filter((o) => o.at <= now);
    const kept = [...past.slice(-1), ...all.filter((o) => o.at > now)];
    for (const o of kept) {
      const id = occurrenceId(row, o.slot);
      if (done.has(id) || (Number.isFinite(ran) && ran >= o.at)) continue;
      const windowEnd = row.window === 'day' ? endOfLocalDay(o.at, tz) : (Number.isFinite(row.window) && row.window > 0 ? o.at + row.window : o.windowEnd);
      const state = o.at > now ? 'planned' : (now < windowEnd ? 'due' : 'skipped');
      out.push({
        id, rowId: row.id, slot: o.slot, at: o.at, windowEnd, state,
        op: row.op, appOrigin: row.appOrigin ?? null, args: row.args ?? {}, actsAs: row.actsAs, label: row.label ?? null,
      });
    }
  }
  return out.sort((a, b) => a.at - b.at || String(a.id).localeCompare(String(b.id)));
}

/** What a host's tick runs now: `upcoming`, cut at now. */
export function due({ rows, done, now, tz }) {
  return upcoming({ rows, done, now, tz, horizon: 0 }).filter((o) => o.state === 'due');
}

const same = (a, b) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);

/**
 * @param {object} a
 * @param {object[]} a.rows
 * @param {{circleId: string, before: object|null, after: object}} a.change
 * @param {Set<string>} [a.done]
 */
export function eventOccurrences({ rows, change, done = new Set() }) {
  const after = change?.after;
  if (!after?.id) return [];
  const before = change.before ?? null;
  const version = after.clock ?? after.updatedAt ?? '';
  const out = [];
  for (const row of rows ?? []) {
    if (!row || row.type !== 'intention' || (row.state && row.state !== 'open')) continue;
    const ev = row.trigger?.event;
    if (!ev || typeof ev !== 'object') continue;
    if (ev.type && ev.type !== after.type) continue;
    if (ev.circleId && ev.circleId !== change.circleId) continue;
    if (ev.kind === 'added') { if (before) continue; }
    else if (ev.kind === 'changed') {
      if (!before) continue;
      const fields = ev.field == null ? null : (Array.isArray(ev.field) ? ev.field : [ev.field]);
      if (fields ? fields.every((f) => same(before[f], after[f])) : same(before, after)) continue;
    } else continue;
    const id = `${row.id}:${after.id}:${version}`;
    if (done.has(id)) continue;
    out.push({
      id, rowId: row.id, op: row.op, appOrigin: row.appOrigin ?? null, actsAs: row.actsAs, label: row.label ?? null,
      args: { ...(row.args ?? {}), change: { circleId: change.circleId, itemId: after.id, before, after } },
    });
  }
  return out;
}
