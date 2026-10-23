/**
 * "Herinner iedereen om 19:45: eten" — a shared household moment (a household's log, 2026-10: "remind everyone we eat
 * at 19:45"). `remindMe` with `who: everyone` is a HOUSEHOLD row: one timed intention in the household's circle, acting
 * as the household (the host signs it), whose op is the announcer — at its moment everyone in the household hears the
 * words, once. The gate takes the one phrasing in Dutch and English; the model reaches the same op with the same args.
 * It names nobody, so the names ceiling does not come into it. Composed as the box composes it.
 */
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { rm } from 'node:fs/promises';
import { utcInstantForWallClock, wallClockInTz } from '@onderling/notifier';
import { bootAnnouncingBox } from './support/announcingBox.js';
import { initLocalisation, t } from '../src/localisation.js';
import { listsGateRules } from '../src/v2/circleGate.js';
import { templateLists } from '../src/v2/householdTemplate.js';
import { ANNOUNCE_OP, HOUSEHOLD_ACTS_AS } from '../src/v2/announceRows.js';

const TZ = 'Europe/Amsterdam';
const PEOPLE = [{ id: 'telegram:1', name: 'Ann', role: 'member' }, { id: 'telegram:2', name: 'Bert', role: 'member' }, { id: 'telegram:9', name: 'Frits', role: 'admin' }];

const MIN = 60_000;
const hhmm = (ms) => { const w = wallClockInTz(ms, TZ); return `${String(w.hour).padStart(2, '0')}:${String(w.minute).padStart(2, '0')}`; };
/**
 * The next instant at this wall-clock time after `from`: today's, or when it has passed, tomorrow's — the next CALENDAR
 * day at that wall-clock time in the zone, the way the bot counts. Not 24 hours on: across a daylight-saving change a
 * day is 23 or 25 hours long.
 */
const next = (time, from) => {
  const w = wallClockInTz(from, TZ);
  const [hour, minute] = time.split(':').map(Number);
  const today = utcInstantForWallClock({ year: w.year, month: w.month, day: w.day, hour, minute, tz: TZ });
  if (today > from) return today;
  const d = new Date(Date.UTC(w.year, w.month - 1, w.day + 1));   // the next calendar date (month and year roll over)
  return utcInstantForWallClock({ year: d.getUTCFullYear(), month: d.getUTCMonth() + 1, day: d.getUTCDate(), hour, minute, tz: TZ });
};
const dayWord = (ms, from) => (wallClockInTz(ms, TZ).day === wallClockInTz(from, TZ).day ? 'circle.bot.remind_everyone_today' : 'circle.bot.remind_everyone_tomorrow');

/**
 * The suite runs on a fixed clock, never the real one: the box reads `clock`, and Date is faked to the same instant, so
 * a row the store stamps and the moment the runner asks about agree (a test on real time passed or failed by the hour —
 * and by the night — it ran). `setClock` moves both.
 */
const useClock = (start) => {
  let now = start;
  return { now: () => now, set: (ms) => { now = ms; vi.setSystemTime(ms); } };
};

describe('remind everyone at a time', () => {
  let box;
  // a plain June afternoon: no daylight-saving change in reach
  const START = Date.parse('2026-06-10T15:00:00Z');
  const c = useClock(START);
  let clock = START;
  const setClock = (ms) => { clock = ms; c.set(ms); };
  const SUPPER = hhmm(START + 90 * MIN);
  const supperAt = next(SUPPER, START);
  const rows = () => box.book.rows().filter((r) => r.op === ANNOUNCE_OP && r.args?.say);

  beforeAll(async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    setClock(START);
    await initLocalisation({ lng: 'nl' });
    box = await bootAnnouncingBox({ t, tz: TZ, people: PEOPLE, now: () => clock });
  }, 120_000);
  afterAll(async () => { vi.useRealTimers(); await box?.agent?.stop?.().catch(() => {}); if (box?.dir) await rm(box.dir, { recursive: true, force: true }).catch(() => {}); });

  it('the gate takes the one phrasing, in Dutch and in English, to remindMe(who: everyone)', () => {
    const rules = listsGateRules('nl', templateLists(t));
    const run = (text) => { for (const r of rules) { const c = r.command(text, {}); if (c) return c; } return null; };
    expect(run('herinner iedereen om 19:45: eten')).toMatchObject({ opId: 'remindMe', appOrigin: 'assistant', args: { who: 'everyone', item: 'eten', rules: 'om 19:45' } });
    expect(run('Remind everyone at 7 pm: dinner')).toMatchObject({ opId: 'remindMe', args: { who: 'everyone', item: 'dinner', rules: 'at 7 pm' } });
    // a reminder of one appointment for oneself is not this
    expect(run('herinner me om 19:45 aan de tandarts')?.args?.who).not.toBe('everyone');
  });

  it('a member asks; one household row is written, acting as the household, in its circle', async () => {
    const r = await box.door('assistant', 'remindMe', { who: 'everyone', item: 'eten', rules: `om ${SUPPER}` }, { caller: 'telegram:1', threadId: 'telegram:1' });
    expect(r.ok, JSON.stringify(r)).toBe(true);
    expect(r.message).toBe(t('circle.bot.remind_everyone_set', { when: t(dayWord(supperAt, START), { time: SUPPER }), text: 'eten' }));
    const [row] = rows();
    expect(row).toMatchObject({ actsAs: HOUSEHOLD_ACTS_AS, state: 'open', args: { say: 'eten' } });
    expect(new Date(row.trigger.at).getTime()).toBe(supperAt);
    expect(box.book.scopeOf(row.id)).toBe(box.agent.householdCircleId);
  }, 60_000);

  it('before its moment nobody hears it; at it, everyone does — the asker too — once', async () => {
    setClock(supperAt - 45 * MIN);
    await box.runner.pass();
    expect(box.sent).toEqual([]);
    setClock(supperAt + MIN);
    await box.runner.pass();
    expect(box.sent.map((m) => m.id).sort()).toEqual(PEOPLE.map((p) => p.id).sort());
    for (const m of box.sent) expect(m.text).toBe(t('circle.bot.announce_say', { title: 'eten' }));
    box.sent.length = 0;
    await box.runner.pass();
    expect(box.sent, 'said once').toEqual([]);
  }, 60_000);

  it('a time already past is the next one\'s (tomorrow\'s); words that are no time are asked again, nothing written', async () => {
    setClock(supperAt + 2 * MIN);
    const before = rows().length;
    // a time a little before now: passed, so tomorrow's
    const earlier = hhmm(clock - 30 * MIN);
    const then = next(earlier, clock);
    const r = await box.door('assistant', 'remindMe', { who: 'iedereen', item: 'vuilnis buiten', rules: earlier }, { caller: 'telegram:2', threadId: 'telegram:2' });
    expect(r.message).toBe(t('circle.bot.remind_everyone_set', { when: t(dayWord(then, clock), { time: earlier }), text: 'vuilnis buiten' }));
    expect(new Date(rows().at(-1).trigger.at).getTime()).toBe(then);
    expect(then).toBeGreaterThan(clock);
    const bad = await box.door('assistant', 'remindMe', { who: 'everyone', item: 'eten', rules: 'straks' }, { caller: 'telegram:2', threadId: 'telegram:2' });
    expect(bad).toMatchObject({ ok: false, error: { code: 'invalid-argument', message: t('circle.bot.remind_everyone_usage') } });
    expect(rows().length).toBe(before + 1);
  }, 60_000);

  it('the announcer is still the host\'s alone: a person cannot make the household say something now', async () => {
    const r = await box.door('assistant', ANNOUNCE_OP, { say: 'hallo allemaal' }, { caller: 'telegram:1', threadId: 'telegram:1' });
    expect(r).toMatchObject({ ok: false, error: { code: 'host-only' } });
  });
});

describe('remind everyone across the night daylight saving ends (Europe/Amsterdam, 2026-10-25 03:00 → 02:00)', () => {
  let box;
  let clock = Date.parse('2026-10-24T21:30:00Z');   // Saturday 23:30 in Amsterdam (summer time)
  const c = useClock(clock);
  const setClock = (ms) => { clock = ms; c.set(ms); };
  const rows = () => box.book.rows().filter((r) => r.op === ANNOUNCE_OP && r.args?.say);

  beforeAll(async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    setClock(clock);
    await initLocalisation({ lng: 'nl' });
    box = await bootAnnouncingBox({ t, tz: TZ, people: PEOPLE, now: () => clock });
  }, 120_000);
  afterAll(async () => { vi.useRealTimers(); await box?.agent?.stop?.().catch(() => {}); if (box?.dir) await rm(box.dir, { recursive: true, force: true }).catch(() => {}); });

  const cases = [
    // 23:00 has passed at 23:30 on Saturday: tomorrow's 23:00 is in winter time, 25 hours after today's
    { now: '2026-10-24T21:30:00Z', time: '23:00', at: '2026-10-25T22:00:00Z' },
    // 01:30 on Sunday, before the clocks go back: tomorrow's 01:03 is Monday's, 24 h 33 min on
    { now: '2026-10-24T23:30:00Z', time: '01:03', at: '2026-10-26T00:03:00Z' },
  ];
  for (const k of cases) {
    it(`at ${k.now} a passed "${k.time}" is tomorrow's ${k.time}, by the calendar`, async () => {
      setClock(Date.parse(k.now));
      expect(next(k.time, clock), 'the test counts tomorrow the way the bot does').toBe(Date.parse(k.at));
      const r = await box.door('assistant', 'remindMe', { who: 'iedereen', item: 'vuilnis buiten', rules: k.time }, { caller: 'telegram:2', threadId: 'telegram:2' });
      expect(r.message).toBe(t('circle.bot.remind_everyone_set', { when: t('circle.bot.remind_everyone_tomorrow', { time: k.time }), text: 'vuilnis buiten' }));
      expect(new Date(rows().at(-1).trigger.at).getTime()).toBe(Date.parse(k.at));
    }, 60_000);
  }
});
