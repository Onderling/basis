/**
 * "Herinner iedereen om 19:45: eten" — a shared household moment (a household's log, 2026-10: "remind everyone we eat
 * at 19:45"). `remindMe` with `who: everyone` is a HOUSEHOLD row: one timed intention in the household's circle, acting
 * as the household (the host signs it), whose op is the announcer — at its moment everyone in the household hears the
 * words, once. The gate takes the one phrasing in Dutch and English; the model reaches the same op with the same args.
 * It names nobody, so the names ceiling does not come into it. Composed as the box composes it.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { rm } from 'node:fs/promises';
import { utcInstantForWallClock, wallClockInTz } from '@onderling/notifier';
import { bootAnnouncingBox } from './support/announcingBox.js';
import { initLocalisation, t } from '../src/localisation.js';
import { listsGateRules } from '../src/v2/circleGate.js';
import { templateLists } from '../src/v2/householdTemplate.js';
import { ANNOUNCE_OP, HOUSEHOLD_ACTS_AS } from '../src/v2/announceRows.js';

const TZ = 'Europe/Amsterdam';
const PEOPLE = [{ id: 'telegram:1', name: 'Ann', role: 'member' }, { id: 'telegram:2', name: 'Bert', role: 'member' }, { id: 'telegram:9', name: 'Frits', role: 'admin' }];

describe('remind everyone at a time', () => {
  let box;
  // the box's clock runs from the real now: the store stamps a row with the real time, and nothing before a row was made
  // is ever due (a fixed noon clock made this test pass or fail by the hour it ran)
  const START = Math.ceil(Date.now() / 60_000) * 60_000;
  const MIN = 60_000;
  const hhmm = (ms) => { const w = wallClockInTz(ms, TZ); return `${String(w.hour).padStart(2, '0')}:${String(w.minute).padStart(2, '0')}`; };
  /** The next instant at this wall-clock time after `from` (today's, or tomorrow's when it has passed). */
  const next = (time, from) => {
    const w = wallClockInTz(from, TZ);
    const [hour, minute] = time.split(':').map(Number);
    const today = utcInstantForWallClock({ year: w.year, month: w.month, day: w.day, hour, minute, tz: TZ });
    return today > from ? today : today + 86_400_000;
  };
  const dayWord = (ms, from) => (wallClockInTz(ms, TZ).day === wallClockInTz(from, TZ).day ? 'circle.bot.remind_everyone_today' : 'circle.bot.remind_everyone_tomorrow');
  let clock = START;
  const SUPPER = hhmm(START + 90 * MIN);
  const supperAt = next(SUPPER, START);
  const rows = () => box.book.rows().filter((r) => r.op === ANNOUNCE_OP && r.args?.say);

  beforeAll(async () => {
    await initLocalisation({ lng: 'nl' });
    box = await bootAnnouncingBox({ t, tz: TZ, people: PEOPLE, now: () => clock });
  }, 120_000);
  afterAll(async () => { await box?.agent?.stop?.().catch(() => {}); if (box?.dir) await rm(box.dir, { recursive: true, force: true }).catch(() => {}); });

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
    clock = supperAt - 45 * MIN;
    await box.runner.pass();
    expect(box.sent).toEqual([]);
    clock = supperAt + MIN;
    await box.runner.pass();
    expect(box.sent.map((m) => m.id).sort()).toEqual(PEOPLE.map((p) => p.id).sort());
    for (const m of box.sent) expect(m.text).toBe(t('circle.bot.announce_say', { title: 'eten' }));
    box.sent.length = 0;
    await box.runner.pass();
    expect(box.sent, 'said once').toEqual([]);
  }, 60_000);

  it('a time already past is the next one\'s (tomorrow\'s); words that are no time are asked again, nothing written', async () => {
    clock = supperAt + 2 * MIN;
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
