/**
 * A reminder of one's own at a time — "herinner me over 10 minuten dat ik de gootsteen ontstop", "remind me at 8 to call
 * mum" — needs no appointment or chore. `remindMe` with `who: me` (or no `who`, when no appointment or chore is named)
 * and a bare time is ONE timed intention row acting as the PERSON, on the host's own store (where a Telegram-only
 * person's rows live, like their week overview), fired by the host tick at its moment into their PRIVATE chat only, once;
 * held through their quiet hours like an announcement. `/gepland` lists it (and a reminder for everyone, which reaches
 * them too); `/schrap` takes it away, by its number or its words. A person sets their own, never one acting as another.
 * Composed as the box composes it (the announcing box), and the model's route with the stand-in model.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { rm } from 'node:fs/promises';
import { InMemoryBridge } from '@onderling/chat-agent';
import { utcInstantForWallClock, wallClockInTz } from '@onderling/notifier';
import { bootAnnouncingBox } from './support/announcingBox.js';
import { initLocalisation, t } from '../src/localisation.js';
import { listsGateRules } from '../src/v2/circleGate.js';
import { templateLists, HOUSEHOLD_TEMPLATE } from '../src/v2/householdTemplate.js';
import { composeAssistantCatalogue } from '../src/telegram/assistantCatalogue.js';
import { createTelegramRunner } from '../src/telegram/runner.js';
import { interpretToCommand } from '../src/v2/interpretCommand.js';
import { testModelProviders } from '../src/v2/testModel.js';

const TZ = 'Europe/Amsterdam';
const PEOPLE = [{ id: 'telegram:1', name: 'Ann', role: 'member' }, { id: 'telegram:2', name: 'Bert', role: 'member' }];
const ANN = { caller: 'telegram:1', threadId: 'telegram:1' };

describe('a reminder of your own, at a time', () => {
  let box;
  // the box's clock runs from the real now: the store stamps a row with the real time, and nothing before a row was made
  // is ever due
  const START = Date.now();
  const today = wallClockInTz(START, TZ);
  const at = (hour, minute, plusDays = 0) => utcInstantForWallClock({ year: today.year, month: today.month, day: today.day, hour, minute, tz: TZ }) + plusDays * 86_400_000;
  const MIN = 60_000;
  const hhmm = (ms) => { const w = wallClockInTz(ms, TZ); return `${String(w.hour).padStart(2, '0')}:${String(w.minute).padStart(2, '0')}`; };
  let clock = START;
  const mine = (who = 'telegram:1') => box.book.rows().filter((r) => r.actsAs === who && r.args?.say);
  const call = (op, args, ctx = ANN) => box.door('assistant', op, args, ctx);

  beforeAll(async () => {
    await initLocalisation({ lng: 'nl' });
    box = await bootAnnouncingBox({ t, tz: TZ, people: PEOPLE, now: () => clock });
  }, 120_000);
  afterAll(async () => { await box?.agent?.stop?.().catch(() => {}); if (box?.dir) await rm(box.dir, { recursive: true, force: true }).catch(() => {}); });

  it('the gate takes "herinner me <time>: …" / "remind me <time> to …" — a span, a clock time, a day and a time', () => {
    const rules = listsGateRules('nl', templateLists(t));
    const run = (text) => { for (const r of rules) { const c = r.command(text, {}); if (c) return c; } return null; };
    expect(run('herinner me over 10 minuten dat ik de gootsteen ontstop')).toMatchObject({ opId: 'remindMe', args: { who: 'me', item: 'ik de gootsteen ontstop', rules: 'over 10 minuten' } });
    expect(run('remind me at 8 to call mum')).toMatchObject({ opId: 'remindMe', args: { who: 'me', item: 'call mum', rules: 'at 8' } });
    expect(run('herinner me morgen om 8:00: vuilnis')).toMatchObject({ opId: 'remindMe', args: { who: 'me', item: 'vuilnis', rules: 'morgen om 8:00' } });
    // a minute time with am/pm is a time to the gate too
    expect(run('Remind everyone at 7:45 pm: dinner')).toMatchObject({ opId: 'remindMe', args: { who: 'everyone', rules: 'at 7:45 pm' } });
  });

  it('"over 10 minuten": one row acting as the person, on the host\'s own store; it fires once, into their chat only, then is done', async () => {
    const r = await call('remindMe', { who: 'me', item: 'gootsteen ontstoppen', rules: 'over 10 minuten' });
    expect(r.ok, JSON.stringify(r)).toBe(true);
    const due = START + 10 * MIN;
    const sameDay = wallClockInTz(due, TZ).day === today.day;
    expect(r.message).toBe(t('circle.bot.remind_me_at_set', { when: t(sameDay ? 'circle.bot.remind_everyone_today' : 'circle.bot.remind_everyone_tomorrow', { time: hhmm(due) }), text: 'gootsteen ontstoppen' }));
    const [row] = mine();
    expect(row).toMatchObject({ actsAs: 'telegram:1', state: 'open', args: { say: 'gootsteen ontstoppen' } });
    expect(new Date(row.trigger.at).getTime()).toBe(due);
    expect(box.book.scopeOf(row.id)).toBeNull();
    clock = START + 5 * MIN;
    await box.runner.pass();
    expect(box.sent).toEqual([]);
    clock = START + 11 * MIN;
    await box.runner.pass();
    expect(box.sent, JSON.stringify(box.fired)).toEqual([{ id: 'telegram:1', text: t('circle.bot.announce_mine', { title: 'gootsteen ontstoppen' }) }]);
    box.sent.length = 0;
    await box.runner.pass();
    expect(box.sent, 'once').toEqual([]);
    expect(mine()[0].state).toBe('done');
  }, 60_000);

  it('"morgen 8:00" the same; with no `who` and no appointment named it is still your own; a time that is no time asks again', async () => {
    clock = START;
    const r = await call('remindMe', { item: 'bel mama', rules: 'morgen om 8:00' });
    expect(r.ok, JSON.stringify(r)).toBe(true);
    expect(new Date(mine().at(-1).trigger.at).getTime()).toBe(at(8, 0, 1));
    const before = mine().length;
    const bad = await call('remindMe', { who: 'me', item: 'bel mama', rules: 'straks een keer' });
    expect(bad).toMatchObject({ ok: false, error: { code: 'invalid-argument' } });
    expect(mine().length).toBe(before);
  }, 60_000);

  it('never one acting as another: a who that is someone else is refused, nothing written; Bert hears nothing of Ann\'s', async () => {
    const before = box.book.rows().length;
    const r = await call('remindMe', { who: 'Bert', item: 'afwas', rules: 'over 5 minuten' });
    expect(r).toMatchObject({ ok: false, error: { code: 'not-yours' } });
    expect(box.book.rows().length).toBe(before);
    expect(mine('telegram:2')).toEqual([]);
  }, 60_000);

  it('/gepland lists it (and a reminder for everyone); /schrap takes it away by its number or its words', async () => {
    clock = START;
    await call('remindMe', { who: 'me', item: 'planten water geven', rules: 'over 30 minuten' });
    await call('remindMe', { who: 'everyone', item: 'eten', rules: 'over 40 minuten' }, { caller: 'telegram:2', threadId: 'telegram:2' });
    const planned = (await call('assistant-planned', {})).message;
    expect(planned).toContain('planten water geven');
    expect(planned).toContain('eten');
    const cut = await call('cancelReminder', { which: 'planten' });
    expect(cut.ok, JSON.stringify(cut)).toBe(true);
    expect(mine().find((r) => r.args.say === 'planten water geven').state).toBe('cancelled');
    expect((await call('assistant-planned', {})).message).not.toContain('planten water geven');
    // by its number: the first of their own still coming
    const open = mine().filter((r) => r.state === 'open').sort((a, b) => Date.parse(a.trigger.at) - Date.parse(b.trigger.at));
    const byNumber = await call('cancelReminder', { which: '1' });
    expect(byNumber.ok, JSON.stringify(byNumber)).toBe(true);
    expect(box.book.rows().find((r) => r.id === open[0].id).state).toBe('cancelled');
    // Bert cannot take Ann's away
    const not = await call('cancelReminder', { which: 'bel mama' }, { caller: 'telegram:2', threadId: 'telegram:2' });
    expect(not.ok).toBe(false);
  }, 60_000);

  it('held through quiet hours, like an announcement', async () => {
    clock = START;
    box.threads.setQuiet('telegram:1', `${hhmm(START - MIN)}-${hhmm(START + 30 * MIN)}`);
    await call('remindMe', { who: 'me', item: 'thee', rules: 'over 2 minuten' });
    clock = START + 3 * MIN;
    box.sent.length = 0;
    await box.runner.pass();
    expect(box.sent).toEqual([]);
    expect(box.threads.heldAnnouncementsOf('telegram:1').map((a) => a.text)).toContain('thee');
    box.threads.setQuiet('telegram:1', null);
  }, 60_000);

  it('the model reaches it (the stand-in model), in the person\'s private chat', async () => {
    clock = START;
    const model = { script: [{ when: 'kwartier', toolCall: { id: 'remindMe', args: { who: 'me', item: 'oven uit', rules: 'over 15 minuten' } } }] };
    const { catalogue, manifestsByOrigin } = composeAssistantCatalogue({ apps: [...HOUSEHOLD_TEMPLATE.apps], slim: true });
    const bridge = new InMemoryBridge({ id: 'telegram' });
    const runner = createTelegramRunner({
      bridge, catalogue, manifestsByOrigin, t, lang: 'nl', callSkill: box.door, collectMs: 0,
      llm: testModelProviders(model).local, interpret: interpretToCommand, gateRules: listsGateRules('nl', templateLists(t)),
      admit: async ({ uid }) => `telegram:${uid}`,
    });
    await runner.start();
    await bridge.simulateIncoming({ chatId: '1', text: 'zeg het me over een kwartier, de oven moet uit', sender: { bridgeUid: '1', displayName: null } });
    await runner.idle('1');
    expect(model.requests.length).toBe(1);
    expect(mine().some((r) => r.args.say === 'oven uit' && r.state === 'open')).toBe(true);
    // …and typed away again: `/schrap oven`
    bridge.clearOutbox();
    await bridge.simulateIncoming({ chatId: '1', text: '/schrap oven', sender: { bridgeUid: '1', displayName: null } });
    await runner.idle('1');
    expect(bridge.outbox.map((m) => m.text)).toEqual([t('circle.bot.cancel_reminder_done', { text: 'oven uit' })]);
    expect(mine().find((r) => r.args.say === 'oven uit').state).toBe('cancelled');
  }, 60_000);

  it('never from a circle the bot is in: the person\'s own rows are set in their own chat', async () => {
    const r = await call('remindMe', { who: 'me', item: 'x', rules: 'over 5 minuten' }, { ...ANN, doorCircleId: 'some-circle' });
    expect(r.ok).toBe(false);
  });
});
