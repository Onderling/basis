/**
 * The household's people reads — reads over what the household holds, each on the read its TYPE already has, asked as
 * the person (the gate, the role and the names ceiling apply as to anything they type):
 *   - "wie doet de lamp"   → the chores' open read with the words (`listOpen {text}`): the chores, who holds each, when;
 *   - "wat moet Bob doen"  → `listMine {who}`: Bob's open chores, Bob found among the people the asker may name;
 *   - "wie is er zaterdag" → `weekOverview {day}`: that day's appointments with who comes, its chores with who does them.
 * The ceiling, on all three: a person the asker may not name is `{someone}` — never an id — and under the household's
 * `names: none` nobody is named but the asker themself.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createRealHouseholdAgent } from '../src/core/agent/realAgent.js';
import { botOpLevel, botRoleAllows, BOT_OP_MAP } from '../src/v2/botOpMap.js';
import { ensureHouseholdLists } from '../src/v2/householdTemplate.js';
import { withAssistantOps } from '../src/v2/assistantOps.js';
import { EventLog } from '../src/eventLog.js';
import { createBotThreads, memoryThreadStore } from '../src/v2/botThreads.js';
import { HOUSEHOLD_BOT_STORE_OPTS } from '../src/v2/householdBotStore.js';

const NAMES = { 'circle.lists.template.shopping': 'Boodschappen', 'circle.lists.template.chores': 'Klusjes', 'circle.lists.template.repairs': 'Reparaties', 'circle.lists.template.schedule': 'Agenda' };
const t = (k, p) => NAMES[k] ?? (p ? `${k} ${JSON.stringify(p)}` : k);
const local = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const ANN = 'telegram:1'; const BERT = 'telegram:2'; const FRITS = 'telegram:9';

describe('the people reads', () => {
  let agent; let door;
  const X = local(new Date(Date.now() + 3 * 86_400_000));          // the day asked about
  const as = (caller) => (a, o, x) => agent.callSkill(a, o, x, { caller });
  const names = (value) => agent.callSkill('params', 'set-param', { key: 'assistant.names', value });

  beforeAll(async () => {
    agent = await createRealHouseholdAgent({ seedDemoData: false, seedHousehold: false, t, ...HOUSEHOLD_BOT_STORE_OPTS, doorOpLevel: botOpLevel, doorRoleAllows: botRoleAllows });
    const own = (a, o, x) => agent.callSkill(a, o, x);
    await ensureHouseholdLists({ callSkill: own, t });
    for (const [w, n, r] of [[ANN, 'Ann', 'member'], [BERT, 'Bert', 'member'], [FRITS, 'Frits', 'admin']]) {
      await own('stoop', 'addContact', { webid: w, channel: 'telegram', role: r, displayName: n });
      await agent.setDoorCaller(w, r);
    }
    await as(ANN)('lists', 'addToList', { list: 'Klusjes', text: 'lamp vervangen', assignee: 'mij', due: X });
    await as(BERT)('lists', 'addToList', { list: 'Klusjes', text: 'lamp kopen' });
    await as(BERT)('lists', 'addToList', { list: 'Klusjes', text: 'ramen lappen', assignee: 'mij', due: X });
    await as(BERT)('calendar', 'addEvent', { title: 'tandarts', when: `${X}T10:00`, attendees: 'Ann' });
    await as(BERT)('calendar', 'addEvent', { title: 'feest', when: `${X}T20:00` });
    const threads = createBotThreads({ eventLog: new EventLog({ initial: [], muted: [] }), store: memoryThreadStore() });
    await threads.load();
    door = withAssistantOps({ callSkill: (a, o, x, c) => agent.callSkill(a, o, x, c), threads, t, refusal: agent.doorRefusal, admin: {} });
  }, 120_000);
  afterAll(async () => { await names('members'); await agent?.stop?.().catch(() => {}); });

  it('every reader reaches the three: listOpen is on the member\'s and the observer\'s map', () => {
    for (const op of ['tasks.listOpen', 'tasks.listMine', 'assistant.weekOverview']) {
      expect(BOT_OP_MAP.member, op).toContain(op);
      expect(BOT_OP_MAP.observer, op).toContain(op);
    }
  });

  describe('wie doet de lamp: the chores\' open read, with words', () => {
    const who = async (caller, text) => as(caller)('tasks', 'listOpen', { text });
    it('the chores holding the words, each with who holds it and its day — never an id', async () => {
      const r = await who(BERT, 'vervangen');
      expect(r.text).toBe('vervangen');
      expect(r.items.map((i) => i.text)).toEqual(['lamp vervangen']);
      expect(r.items[0]).toMatchObject({ heldBy: [{ name: 'Ann' }], state: 'claimed' });
      expect(r.items[0].dueAt).toBeTruthy();
      expect(JSON.stringify(r)).not.toContain('telegram:');
      expect((await who(BERT, 'lamp')).items.map((i) => i.text).sort()).toEqual(['lamp kopen', 'lamp vervangen']);
      expect((await who(BERT, 'lamp kopen')).items[0].heldBy).toEqual([]);
      expect((await who(ANN, 'vervangen')).items[0]).toMatchObject({ heldBy: [{ you: true }], yours: true });
      expect((await who(BERT, 'fiets')).items).toEqual([]);
    });
    it('the ceiling: a holder the reader may not name is someone; under names:none nobody is named', async () => {
      await names('admin');
      expect((await who(BERT, 'vervangen')).items[0].heldBy).toEqual([{ someone: true }]);
      expect((await who(FRITS, 'vervangen')).items[0].heldBy).toEqual([{ name: 'Ann' }]);
      await names('none');
      expect((await who(FRITS, 'vervangen')).items[0].heldBy).toEqual([{ someone: true }]);
      expect((await who(ANN, 'vervangen')).items[0].heldBy).toEqual([{ you: true }]);
      expect(JSON.stringify(await who(FRITS, 'lamp'))).not.toContain('telegram:');
      await names('members');
    });
  });

  describe('wat moet Bob doen: someone\'s own read, by their name', () => {
    const mine = (caller, args) => as(caller)('tasks', 'listMine', args);
    it('the named person\'s open chores, and whose they are; "mij" and no name are one\'s own', async () => {
      const r = await mine(BERT, { who: 'Ann' });
      expect(r.whose).toBe('Ann');
      expect(r.items.map((i) => i.text)).toEqual(['lamp vervangen']);
      expect(JSON.stringify(r)).not.toContain('telegram:');
      expect((await mine(BERT, { who: 'mij' })).items.map((i) => i.text)).toEqual(['ramen lappen']);
      expect((await mine(BERT, { who: 'mij' })).whose).toBeUndefined();
      expect((await mine(BERT, {})).items.map((i) => i.text)).toEqual(['ramen lappen']);
      expect(await mine(BERT, { who: 'Henk' })).toMatchObject({ ok: false, error: 'circle.tasks.no_such_person {"name":"Henk"}' });
    });
    it('the ceiling: naming someone is seeing them — refused where names are hidden, one\'s own still answered', async () => {
      await names('admin');
      expect(await mine(BERT, { who: 'Ann' })).toMatchObject({ ok: false, error: 'circle.tasks.names_hidden_read' });
      expect((await mine(FRITS, { who: 'Ann' })).items.map((i) => i.text)).toEqual(['lamp vervangen']);
      await names('none');
      expect(await mine(FRITS, { who: 'Ann' })).toMatchObject({ ok: false, error: 'circle.tasks.names_hidden_read' });
      expect((await mine(BERT, { who: 'mij' })).items.map((i) => i.text)).toEqual(['ramen lappen']);
      await names('members');
    });
  });

  describe('wie is er zaterdag: one day of the week overview', () => {
    const day = (caller, d) => door('assistant', 'weekOverview', { day: d }, { caller, threadId: caller });
    it('that day\'s appointments with who comes, its chores with who does them', async () => {
      const r = await day(BERT, X);
      expect(r.ok, JSON.stringify(r)).toBe(true);
      expect(r.day).toBe(X);
      expect(r.events.map((e) => [e.title, e.comes ?? null, e.everyone ?? false])).toEqual([['tandarts', [{ name: 'Ann' }], false], ['feest', null, true]]);
      expect(r.chores.map((c) => [c.text, c.heldBy])).toEqual([['lamp vervangen', [{ name: 'Ann' }]], ['ramen lappen', [{ you: true }]]]);
      expect(r.message).toContain('circle.reply.day_head');
      expect(r.message).toContain('tandarts');
      expect(JSON.stringify(r)).not.toContain('telegram:');
      // a day in words is read on the household's clock
      expect((await day(BERT, 'morgen')).day).toBe(local(new Date(Date.now() + 86_400_000)));
      // the week, without a day, is as it was
      expect((await door('assistant', 'weekOverview', {}, { caller: BERT, threadId: BERT })).message).toContain('circle.bot.overview_head');
    });
    it('the ceiling: an attendee or a holder the reader may not name is someone', async () => {
      await names('none');
      const r = await day(BERT, X);
      expect(r.events.find((e) => e.title === 'tandarts').comes).toEqual([{ someone: true }]);
      expect(r.chores.map((c) => c.heldBy)).toEqual([[{ someone: true }], [{ you: true }]]);
      expect(JSON.stringify(r)).not.toContain('telegram:');
      await names('members');
    });
  });
});
