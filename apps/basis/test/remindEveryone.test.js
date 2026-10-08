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
  // the box's clock: noon today on the household's clock
  const today = wallClockInTz(Date.now(), TZ);
  const at = (hour, minute) => utcInstantForWallClock({ year: today.year, month: today.month, day: today.day, hour, minute, tz: TZ });
  let clock = at(12, 0);
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
    expect(run('herinner me om 19:45 aan de tandarts')?.args?.who).toBeUndefined();
  });

  it('a member asks; one household row is written, acting as the household, in its circle', async () => {
    const r = await box.door('assistant', 'remindMe', { who: 'everyone', item: 'eten', rules: 'om 19:45' }, { caller: 'telegram:1', threadId: 'telegram:1' });
    expect(r.ok, JSON.stringify(r)).toBe(true);
    expect(r.message).toBe(t('circle.bot.remind_everyone_set', { when: t('circle.bot.remind_everyone_today', { time: '19:45' }), text: 'eten' }));
    const [row] = rows();
    expect(row).toMatchObject({ actsAs: HOUSEHOLD_ACTS_AS, state: 'open', args: { say: 'eten' } });
    expect(new Date(row.trigger.at).getTime()).toBe(at(19, 45));
    expect(box.book.scopeOf(row.id)).toBe(box.agent.householdCircleId);
  }, 60_000);

  it('before its moment nobody hears it; at it, everyone does — the asker too — once', async () => {
    clock = at(19, 0);
    await box.runner.pass();
    expect(box.sent).toEqual([]);
    clock = at(19, 46);
    await box.runner.pass();
    expect(box.sent.map((m) => m.id).sort()).toEqual(PEOPLE.map((p) => p.id).sort());
    for (const m of box.sent) expect(m.text).toBe(t('circle.bot.announce_say', { title: 'eten' }));
    box.sent.length = 0;
    await box.runner.pass();
    expect(box.sent, 'said once').toEqual([]);
  }, 60_000);

  it('a time already past today is tomorrow\'s; words that are no time are asked again, nothing written', async () => {
    clock = at(20, 0);
    const before = rows().length;
    const r = await box.door('assistant', 'remindMe', { who: 'iedereen', item: 'vuilnis buiten', rules: '19:30' }, { caller: 'telegram:2', threadId: 'telegram:2' });
    expect(r.message).toBe(t('circle.bot.remind_everyone_set', { when: t('circle.bot.remind_everyone_tomorrow', { time: '19:30' }), text: 'vuilnis buiten' }));
    expect(new Date(rows().at(-1).trigger.at).getTime()).toBe(at(19, 30) + 86_400_000);
    const bad = await box.door('assistant', 'remindMe', { who: 'everyone', item: 'eten', rules: 'straks' }, { caller: 'telegram:2', threadId: 'telegram:2' });
    expect(bad).toMatchObject({ ok: false, error: { code: 'invalid-argument', message: t('circle.bot.remind_everyone_usage') } });
    expect(rows().length).toBe(before + 1);
  }, 60_000);

  it('the announcer is still the host\'s alone: a person cannot make the household say something now', async () => {
    const r = await box.door('assistant', ANNOUNCE_OP, { say: 'hallo allemaal' }, { caller: 'telegram:1', threadId: 'telegram:1' });
    expect(r).toMatchObject({ ok: false, error: { code: 'host-only' } });
  });
});
