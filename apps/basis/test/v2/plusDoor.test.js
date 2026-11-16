/**
 * The person's own "+" as a conversation: ONE shared door (`createPlusDoor`) both shells call with the line. Per line:
 * help, then the plain reading (own acts, own lists, a circle's phrases), and only then the person's OWN model through
 * the assistant engine, which may answer in words or propose an own act. Nothing the model proposes happens without
 * the person's yes: an own act opens its form filled and Save is the yes. The model here is a stand-in.
 *
 * The door's catalogue is composed as every door that is not a circle composes it (`composeAssistantCatalogue`),
 * asked for the OWN place, then cut by `opAvailability`; the door's own ops (memory mode, forget, language) are the
 * box door's ops, answered by the same handler.
 */
import { describe, it, expect, vi } from 'vitest';
import { createPlusDoor, availableOnly, ownPlaceApps } from '../../src/assistant/plusDoor.js';
import { encodeGenericOpId } from '@onderling/app-manifest';
import { listsManifest as LISTS } from '../../../lists/manifest.js';
import { EventLog } from '../../src/eventLog.js';
import { createBotThreads, memoryThreadStore } from '../../src/v2/botThreads.js';
import { catalogueManifests } from '../../src/v2/manifestSources.js';
import { mergeManifests } from '../../src/manifestMerge.js';
import { interpretToCommand } from '../../src/v2/interpretCommand.js';

const t = (k, v) => (v ? `${k} ${JSON.stringify(v)}` : k);
const threadsOf = () => createBotThreads({ eventLog: new EventLog({ initial: [], muted: [] }), store: memoryThreadStore() });
const door = (over = {}) => {
  const callSkill = vi.fn(async () => ({ ok: true }));
  const d = createPlusDoor({
    llm: { invoke: async () => null }, interpret: async () => null, threads: threadsOf(), threadId: 'own:me', t, lang: 'nl',
    circles: async () => [], ownListsOf: async () => [], callSkill, ...over,
  });
  return { d, callSkill };
};
const idsOf = (catalogue) => [...catalogue.opsById.values()].map((e) => e.op.id);

describe('the "+" door: the line goes to the person\'s own model after the plain reading', () => {
  it('a question gets an answer in words, and the model saw the own catalogue only', async () => {
    let seen = null;
    const interpret = async (text, o) => { seen = o.catalogue; return { reply: 'Ik kan notities, afspraken en lijsten voor je bijhouden.' }; };
    const { d, callSkill } = door({ interpret });
    const r = await d.read('wat kan je allemaal?');
    expect(r.done).toBe('Ik kan notities, afspraken en lijsten voor je bijhouden.');
    const ids = [...seen.opsById.values()].map((e) => `${e.appOrigin}.${e.op.id}`);
    expect(ids).toContain('calendar.addEvent');
    expect(ids).not.toContain('lists.makeChore');
    expect(callSkill).not.toHaveBeenCalled();
  });

  it('a proposed own appointment opens its form filled; nothing is stored', async () => {
    const interpret = vi.fn(async () => ({ opId: 'addEvent', args: { title: 'tandarts', when: '2026-11-17T10:00' } }));
    const { d, callSkill } = door({ interpret });
    const r = await d.read('kun je de tandarts voor me regelen?');
    expect(interpret).toHaveBeenCalledTimes(1);
    expect(r.actId).toBe('calendar.calendar-event');
    expect(r.values).toMatchObject({ title: 'tandarts' });
    expect(callSkill).not.toHaveBeenCalled();
  });

  it('the plain reading still comes first: an own act it reads never reaches the model', async () => {
    const interpret = vi.fn(async () => ({ reply: 'x' }));
    const { d } = door({ interpret });
    const r = await d.read('notitie: de sleutel ligt bij de buren');
    expect(interpret).not.toHaveBeenCalled();
    expect(r.actId).toBe('household.note');
  });

  it('no own model: the line is not sent anywhere, and the "+" says no model is set (and where to set one)', async () => {
    const interpret = vi.fn(async () => ({ reply: 'x' }));
    const { d } = door({ llm: null, interpret });
    const r = await d.read('wat kan je allemaal?');
    expect(interpret).not.toHaveBeenCalled();
    expect(r.done).toContain('circle.vandaag.plus_no_model');
  });

  it('the conversation is kept: the next turn reaches the model with the previous one', async () => {
    const histories = [];
    const interpret = async (text, o) => { histories.push(o.history ?? []); return { reply: 'ok' }; };
    const { d } = door({ interpret });
    await d.read('wat kan je allemaal?');
    await d.read('en verder?');
    expect(histories[1].map((m) => m.content).join(' ')).toContain('wat kan je allemaal?');
  });
});

it('a circle act the plain reading runs at once answers with what the run said, and is kept', async () => {
  const threads = threadsOf();
  const runInCircle = vi.fn(async () => ({ done: 'melk staat op Boodschappen' }));
  const circles = async () => [{ id: 'c1', name: 'Thuis', manifestsByOrigin: { lists: LISTS }, lists: [{ name: 'Boodschappen' }] }];
  const { d } = door({ threads, runInCircle, circles });
  const r = await d.read('zet melk op Boodschappen');
  expect(runInCircle).toHaveBeenCalledTimes(1);
  expect(r).toEqual({ done: 'melk staat op Boodschappen' });
  expect(threads.memory.recent('own:me').at(-1)).toContain('melk staat op Boodschappen');
});

describe('a model\'s proposal never widens the "+"', () => {
  it('a field the act does not declare (a circle named) is dropped; a circle named for a list write is dropped too', async () => {
    const { d, callSkill } = door({ interpret: async () => ({ opId: 'addEvent', args: { title: 'kapper', when: '2026-11-17T10:00', circleId: 'kring' } }) });
    expect((await d.read('kun je de kapper voor me regelen?')).values).toEqual({ title: 'kapper', when: '2026-11-17T10:00' });
    const c = door({ interpret: async () => ({ opId: 'addToList', args: { list: 'Boodschappen', text: 'melk', circleId: 'c1' } }) });
    // a circle the model names is dropped: the write becomes a card for the person's OWN list only, run on their pick
    const card = (await c.d.read('melk halen voor thuis, regel jij dat?')).card;
    expect(card.to.every((x) => x.own === true)).toBe(true);
    expect(card.command.args.circleId).toBeUndefined();
    expect(callSkill).not.toHaveBeenCalled();
    expect(c.callSkill).not.toHaveBeenCalled();
  });
  it('an act that opens a thread (feedback) is never read from a line', async () => {
    const { d } = door({ interpret: async () => ({ opId: 'feedback', args: {} }) });
    expect((await d.read('ik wil iets over de app kwijt, kun je helpen?')).actId).toBeUndefined();
  });
});

describe('what the door offers', () => {
  it('an op whose feature is off is not offered (opAvailability, as every surface asks)', () => {
    // the door's own apps only, as the door merges them (a full merge renames colliding ops)
    const ms = catalogueManifests().filter((m) => ['calendar', 'household'].includes(m.app)).map((m) => (m.app !== 'calendar' ? m
      : { ...m, operations: m.operations.map((o) => (o.id === 'addEvent' ? { ...o, requires: ['a-feature-nobody-has'] } : o)) }));
    const byOrigin = Object.fromEntries(ms.filter((m) => m?.app).map((m) => [m.app, m]));
    const ids = idsOf(availableOnly(mergeManifests(ms.map((manifest) => ({ manifest }))), byOrigin));
    expect(ids).not.toContain('addEvent');
    expect(ids).toContain('listEvents');
  });
  it('the apps of the "+" are those that declare an own act (derived, no Basis list)', () => {
    expect(ownPlaceApps()).toEqual(expect.arrayContaining(['calendar', 'household', 'lists']));
    expect(ownPlaceApps()).not.toContain('basis');
  });
  it('the door\'s own ops: memory mode is a tool, forgetting is not; "Forget" empties the thread through the door op', async () => {
    const threads = threadsOf();
    const { d } = door({ threads, interpret: async () => ({ reply: 'goed' }) });
    await d.read('wat kan je allemaal?');
    const { buildToolDescriptors } = await import('../../src/v2/interpretCommand.js');
    const tools = buildToolDescriptors(d.catalogue).map((x) => x.name ?? x.function?.name ?? x.id);
    expect(idsOf(d.catalogue)).toContain('assistant-memory');
    expect(tools.join(' '), 'memory mode is a tool the model may pick').toMatch(/assistant-memory/);
    expect(tools.join(' '), 'the model is never handed a tool that deletes').not.toMatch(/assistant-forget/);
    expect(idsOf(d.catalogue), 'a household admin op is not the person\'s own').not.toContain('assistant-invite');
    expect(threads.memory.recent('own:me').length).toBeGreaterThan(0);
    const r = await d.forget();
    expect(r.error ?? null).toBe(null);
    expect(threads.memory.recent('own:me')).toEqual([]);
  });
});

describe('the own place\'s policy (the feature rung of opAvailability, never skipped)', () => {
  it('a feature is on when the door composes the app named for it; a circle\'s own features stay off', async () => {
    const { ownPlacePolicy, isFeatureEnabled } = await import('../../src/v2/circlePolicy.js');
    const p = ownPlacePolicy(['household', 'calendar', 'lists', 'assistant']);
    expect(isFeatureEnabled(p, 'lists')).toBe(true);
    expect(isFeatureEnabled(p, 'calendar')).toBe(true);
    expect(isFeatureEnabled(p, 'houseRules')).toBe(false);
    expect(isFeatureEnabled(p, 'memberDirectory')).toBe(false);
    expect(isFeatureEnabled(ownPlacePolicy(['household']), 'lists')).toBe(false);
  });
  it('the own lists\' acts are offered in the "+" (lists requires its feature)', () => {
    const { d } = door();
    expect(idsOf(d.catalogue)).toEqual(expect.arrayContaining(['createList', 'addToList', 'listEntries']));
  });
});

describe('a noun people write is PROPOSED in the own place, never written by the model', () => {
  it('the own note\'s add is a tool in the "+" (from the noun\'s declaration), and no tool for a bot or a circle', async () => {
    const { buildToolDescriptors } = await import('../../src/v2/interpretCommand.js');
    const { composeAssistantCatalogue } = await import('../../src/assistant/assistantCatalogue.js');
    const { encodeGenericOpId } = await import('@onderling/app-manifest');
    const NOTE_ADD = encodeGenericOpId('household', 'add', 'note');
    const toolIds = (c) => buildToolDescriptors(c).map((x) => JSON.stringify(x));
    const { d } = door();
    expect(toolIds(d.catalogue).join(' ')).toContain(NOTE_ADD);
    const bot = composeAssistantCatalogue({ apps: ['household'], slim: true }).catalogue;
    const circleDoor = composeAssistantCatalogue({ apps: ['household', 'lists'] }).catalogue;
    expect(toolIds(bot).join(' ')).not.toContain(NOTE_ADD);
    expect(toolIds(circleDoor).join(' ')).not.toContain(NOTE_ADD);
  });
  it('the model proposing a note opens the note form filled; nothing reaches a store', async () => {
    const { encodeGenericOpId } = await import('@onderling/app-manifest');
    const { d, callSkill } = door({ interpret: async () => ({ opId: encodeGenericOpId('household', 'add', 'note'), args: { body: 'de sleutel ligt bij de buren' } }) });
    const r = await d.read('kun je onthouden waar de sleutel is? bij de buren');
    expect(r).toEqual({ actId: 'household.note', values: { body: 'de sleutel ligt bij de buren' }, asSelf: 'default' });
    expect(callSkill).not.toHaveBeenCalled();
  });
});

describe('the assistant reads the person\'s own things, as the ticked self (journey 3)', () => {
  // the own routes, as the agent answers them (one note of the general self, one of a persona)
  const ownRoutes = (asSelf) => async (app, opId) => {
    if (app === 'household') return { items: [
      { id: 'n1', type: 'note', body: 'de sleutel ligt bij de buren', createdBy: 'me-key' },
      { id: 'n2', type: 'note', body: 'het wachtwoord van de printer', createdBy: 'werk-key' },
    ] };
    if (app === 'calendar' && opId === 'listEvents') return { items: asSelf === 'werk' ? [] : [{ id: 'e1', title: 'tandarts', when: '2026-11-17T10:00' }] };
    return { items: [] };
  };
  const selfOf = (asSelf) => (asSelf === 'werk' ? { key: 'werk-key', isDefault: false } : { key: 'me-key', isDefault: true });

  it('"waar ligt de sleutel?" reaches the model with the note\'s words; nothing changes', async () => {
    let context = null;
    const interpret = async (_text, o) => { context = JSON.stringify(o.context ?? []); return { reply: 'Bij de buren.' }; };
    const { d, callSkill } = door({ interpret, readAs: ownRoutes, selfOf });
    const r = await d.read('waar ligt de sleutel?');
    expect(r.done).toBe('Bij de buren.');
    expect(context).toContain('sleutel ligt bij de buren');
    expect(callSkill).not.toHaveBeenCalled();
  });
  it('another self ticked: the general self\'s note never reaches the model (the conversation follows the self)', async () => {
    let context = null;
    const interpret = async (_text, o) => { context = JSON.stringify(o.context ?? []); return { reply: 'Weet ik niet.' }; };
    const { d } = door({ interpret, readAs: ownRoutes, selfOf });
    await d.read('waar ligt de sleutel?', { asSelf: 'werk' });
    expect(context).not.toContain('sleutel');
  });

  // a read the model picks before an act: run as the self, handed back to it once, and the act it then picks opens filled
  it('a read the model picks first is looked at as the self and handed back once; the act it then picks opens filled', async () => {
    const asked = [];
    // only the peek's read answers 'controle': retrieval never asks searchEvents, so the second ask can only have it from the peek
    const readAs = vi.fn((asSelf) => async (app, opId, args) => (opId === 'searchEvents'
      ? { items: [{ id: 'e9', title: 'controle bij de tandarts', when: '2026-11-20T10:00' }] }
      : ownRoutes(asSelf)(app, opId, args)));
    const interpret = vi.fn(async (_text, o) => {
      asked.push(JSON.stringify(o.context ?? []));
      return interpret.mock.calls.length === 1
        ? { opId: 'searchEvents', args: { query: 'tandarts' } }
        : { opId: 'addEvent', args: { title: 'tandarts nabellen', when: '2026-11-18T09:00' } };
    });
    const { d, callSkill } = door({ interpret, readAs, selfOf });
    const r = await d.read('bel de tandarts terug na mijn afspraak');
    expect(interpret).toHaveBeenCalledTimes(2);
    expect(asked[0]).not.toContain('controle');
    expect(asked[1], 'the second ask carries what the peek saw').toContain('controle');
    expect(readAs.mock.calls.every(([s]) => s === null || s === 'default'), 'read as the ticked self').toBe(true);
    expect(r.actId).toBe('calendar.calendar-event');
    expect(r.values).toMatchObject({ title: 'tandarts nabellen' });
    expect(callSkill).not.toHaveBeenCalled();
  });
  it('the peek as another self sees only that self\'s rows', async () => {
    const asked = [];
    const interpret = vi.fn(async (_text, o) => {
      asked.push(JSON.stringify(o.context ?? []));
      return interpret.mock.calls.length === 1 ? { opId: 'listEvents', args: {} } : { reply: 'Je hebt niets gepland.' };
    });
    const { d } = door({ interpret, readAs: ownRoutes, selfOf });
    await d.read('wat heb ik gepland?', { asSelf: 'werk' });
    expect(interpret, 'the read was handed back').toHaveBeenCalledTimes(2);
    expect(asked.join(' ')).not.toContain('tandarts');
  });
});

describe('a follow-up uses the previous turn, and a refusal stores nothing and is said (journey 4)', () => {
  const ownRoutes = () => async (app) => (app === 'household'
    ? { items: [{ id: 'n1', type: 'note', body: 'de sleutel ligt bij de buren', createdBy: 'me-key' }] }
    : { items: [] });
  const selfOf = () => ({ key: 'me-key', isDefault: true });
  // the stand-in model: answers the question from the note; the follow-up "dat" is read from the previous turns
  const standIn = async (text, o) => {
    if (/waar ligt/.test(text)) return { reply: 'Bij de buren.' };
    const before = (o.history ?? []).map((m) => m.content).join(' ');
    if (/agenda/.test(text) && /sleutel/.test(before)) return { opId: 'addEvent', args: { title: 'sleutel ophalen bij de buren', when: '2026-11-17T10:00' } };
    return { reply: 'Wat bedoel je?' };
  };

  it('"zet dat morgen om 10 in mijn agenda" proposes an appointment naming the key; closing it stores nothing and the thread says so', async () => {
    const threads = threadsOf();
    const { d, callSkill } = door({ interpret: standIn, threads, readAs: ownRoutes, selfOf });
    expect((await d.read('waar ligt de sleutel?')).done).toBe('Bij de buren.');
    const r = await d.read('zet dat morgen om 10 in mijn agenda');
    expect(r.actId).toBe('calendar.calendar-event');
    expect(r.values.title).toContain('sleutel');
    const said = await d.settled({}, { saved: false });
    expect(said).toContain('circle.vandaag.plus_act_not_saved');
    expect(d.turns({}).at(-1)).toMatchObject({ who: 'assistant', text: said });
    expect(callSkill).not.toHaveBeenCalled();
  });
  it('saved: the thread says it was saved; settling twice, or with no form the "+" opened, says nothing', async () => {
    const { d } = door({ interpret: standIn, readAs: ownRoutes, selfOf });
    expect(await d.settled({}, { saved: false }), 'no form opened yet').toBeNull();
    await d.read('waar ligt de sleutel?');
    expect(await d.settled({}, { saved: false }), 'the last turn is an answer, not a form').toBeNull();
    await d.read('zet dat morgen om 10 in mijn agenda');
    expect(await d.settled({}, { saved: true, actId: 'calendar.calendar-event' })).toContain('circle.vandaag.plus_act_saved');
    expect(await d.settled({}, { saved: false }), 'already settled').toBeNull();
  });
  it('another act saved by its button while the proposed form was open: the proposal is said as not saved, then, not at a later close', async () => {
    const { d } = door({ interpret: standIn, readAs: ownRoutes, selfOf });
    await d.read('waar ligt de sleutel?');
    await d.read('zet dat morgen om 10 in mijn agenda');
    const said = await d.settled({}, { saved: true, actId: 'household.note' });
    expect(said).toContain('circle.vandaag.plus_act_not_saved');
    expect(await d.settled({}, { saved: false }), 'a later close says nothing').toBeNull();
  });
});

describe('the conversation follows the ticked self, or a set of selves with a primary', () => {
  const selfKeyOf = (id) => ({ default: 'me-key', werk: 'werk-key', thuis: 'thuis-key' })[id] ?? null;
  const notesOf = { 'me-key': 'de sleutel ligt bij de buren', 'werk-key': 'het wachtwoord van de printer' };
  const readAs = (asSelf) => async (app) => (app === 'household'
    ? { items: Object.entries(notesOf).map(([by, body], i) => ({ id: `n${i}`, body, createdBy: by })) }
    : { items: [] });
  const make = (interpret, threads = threadsOf()) => ({ threads, ...door({ interpret, threads, readAs, selfKeyOf, threadId: undefined }) });

  it('each self has its own thread: what was said as Werk is not the general self\'s memory', async () => {
    const histories = [];
    const { d } = make(async (_t, o) => { histories.push((o.history ?? []).map((m) => m.content).join(' ')); return { reply: 'ok' }; });
    await d.read('iets over werk', { asSelf: 'werk' });
    await d.read('en nu?', { asSelf: 'default' });
    expect(histories[1]).not.toContain('iets over werk');
    await d.read('en verder?', { asSelf: 'werk' });
    expect(histories[2]).toContain('iets over werk');
  });
  it('several selves ticked and none picked: the "+" asks which one; nothing reaches a model', async () => {
    const interpret = vi.fn(async () => ({ reply: 'x' }));
    const { d } = make(interpret);
    const r = await d.read('wat kan je?', { selves: ['default', 'werk'] });
    expect(r.askSelf).toBe(true);
    expect(interpret).not.toHaveBeenCalled();
  });
  it('combined: the set\'s rows are read (union), the thread is the SET\'s, and a proposal is made as the primary', async () => {
    let context = null;
    const { d, threads } = make(async (_t, o) => { context = JSON.stringify(o.context ?? []); return { opId: encodeGenericOpId('household', 'add', 'note'), args: { body: 'iets' } }; });
    const r = await d.read('onthoud iets, de sleutel en de printer', { selves: ['werk', 'default'], asSelf: 'default' });
    expect(context).toContain('sleutel');
    expect(context).toContain('printer');
    expect(r).toMatchObject({ actId: 'household.note', asSelf: 'default' });
    const combined = d.threadIdFor(['default', 'werk']);
    expect(combined).toBe(d.threadIdFor(['werk', 'default']));
    expect(combined).not.toBe(d.threadIdFor(['default']));
    expect(combined).toMatch(/combined/);
    expect(threads.memory.recent(combined).length).toBeGreaterThan(0);
    expect(threads.memory.recent(d.threadIdFor(['default']))).toEqual([]);
  });
  it('Forget empties only the conversation it is asked for', async () => {
    const { d, threads } = make(async () => ({ reply: 'ok' }));
    await d.read('een', { asSelf: 'werk' });
    await d.read('twee', { asSelf: 'default' });
    await d.forget({ selves: ['werk'] });
    expect(threads.memory.recent(d.threadIdFor(['werk']))).toEqual([]);
    expect(threads.memory.recent(d.threadIdFor(['default'])).length).toBeGreaterThan(0);
  });
});

it('the pick on the which-circle card is kept in the conversation of the self it was made as', async () => {
  const threads = threadsOf();
  const selfKeyOf = (id) => ({ default: 'me-key', werk: 'werk-key' })[id];
  const { d } = door({ threads, selfKeyOf, threadId: undefined });
  await d.exchange({ asSelf: 'werk' }, async () => ({ done: 'melk staat op Projecten' }));
  expect(threads.memory.recent(d.threadIdFor(['werk'])).join(' ')).toContain('melk staat op Projecten');
  expect(threads.memory.recent(d.threadIdFor(['default']))).toEqual([]);
});

it('whose conversation the sheet shows: the self written as; the general self with one or none ticked; nobody before the question', async () => {
  const { conversationSelf } = await import('../../src/assistant/plusDoor.js');
  expect(conversationSelf('werk', 2)).toBe('werk');
  expect(conversationSelf(null, 0)).toBe('default');
  expect(conversationSelf(null, 1)).toBe('default');
  expect(conversationSelf(null, 2)).toBe(null);
});

describe('every op the door offers the model has an outcome (or is not offered)', () => {
  it('each tool, picked by the model, ends in a form, a card, an answer or the run\'s own word: never "could not read"', async () => {
    const { buildToolDescriptors } = await import('../../src/v2/interpretCommand.js');
    const probe = door();
    const tools = [...probe.d.catalogue.opsById.values()].filter((e) => e.op.surfaces?.chat).map((e) => e.op.id);
    expect(tools.length).toBe(buildToolDescriptors(probe.d.catalogue).length);
    const unread = t('circle.vandaag.plus_line_unread');
    const misses = [];
    for (const opId of tools) {
      const readAs = () => async () => ({ ok: true, items: [{ id: 'x1', label: 'melk' }] });
      const { d, callSkill } = door({ readAs, interpret: async () => ({ opId, args: { list: 'Boodschappen', text: 'melk', title: 't', when: '2026-11-17T10:00' } }) });
      const r = await d.read('regel dit voor me alsjeblieft');
      if (r?.error === unread) misses.push(opId);
      expect(callSkill, `${opId}: nothing reaches a store from the model`).not.toHaveBeenCalled();
    }
    expect(misses).toEqual([]);
  });
  it('an own-list write the model proposes is a card naming the act and the list; it runs only on the pick, as the self', async () => {
    const { d } = door({ interpret: async () => ({ opId: 'addToList', args: { list: 'Boodschappen', text: 'melk' } }) });
    const r = await d.read('kun je melk op mijn boodschappen zetten, graag');
    expect(r.card?.command).toMatchObject({ appOrigin: 'lists', opId: 'addToList', args: { list: 'Boodschappen', text: 'melk' } });
    expect(r.card.to).toEqual([expect.objectContaining({ own: true })]);
  });
  it('a read the model picks is run as the self and answered in words', async () => {
    const seen = [];
    const readAs = (asSelf) => async (app, opId, args) => { seen.push({ asSelf, app, opId, args }); return { ok: true, items: [{ id: 'e1', label: 'melk' }] }; };
    const { d } = door({ readAs, interpret: async () => ({ opId: 'listEntries', args: { list: 'Boodschappen' } }) });
    const r = await d.read('wat staat er op mijn boodschappen, weet je dat?');
    expect(r.done).toMatch(/melk/);
    expect(seen.some((s) => s.opId === 'listEntries' && s.args.circleId)).toBe(true);
  });
});

it('only a noun PEOPLE write is proposed: a generic add without a chat surface for any other reason gets no tool', async () => {
  const { proposable } = await import('../../src/assistant/plusDoor.js');
  const op = (noun) => ({ id: `__generic__:x:add:${noun}`, __generic: { app: 'x', atom: 'add', noun }, surfaces: { slash: { command: `/add-${noun}` } } });
  const catalogue = { opsById: new Map([['a', { op: op('note'), appOrigin: 'x' }], ['b', { op: op('thing'), appOrigin: 'x' }]]) };
  const manifests = { x: { app: 'x', nouns: { note: { atoms: ['add'], writtenBy: 'people' }, thing: { atoms: ['add'] } } } };
  const out = proposable(catalogue, manifests);
  expect(out.opsById.get('a').op.surfaces.chat).toBeTruthy();
  expect(out.opsById.get('b').op.surfaces.chat).toBeUndefined();
});

describe('a combined conversation reads across its set', () => {
  it('a read the model picks runs as EACH self of the set, and the answer holds the rows of both', async () => {
    const asked = [];
    const readAs = (asSelf) => async (app, opId) => { asked.push(asSelf); return { ok: true, items: [{ id: `${asSelf}-1`, label: asSelf === 'werk' ? 'offerte' : 'melk' }] }; };
    const selfKeyOf = (id) => ({ default: 'me-key', werk: 'werk-key' })[id];
    const { d } = door({ readAs, selfKeyOf, threadId: undefined, interpret: async () => ({ opId: 'listEntries', args: { list: 'Boodschappen' } }) });
    const r = await d.read('wat staat er op mijn lijsten, kun je dat zeggen?', { selves: ['default', 'werk'], asSelf: 'default' });
    expect(new Set(asked)).toEqual(new Set(['default', 'werk']));
    expect(r.done).toMatch(/melk/);
    expect(r.done).toMatch(/offerte/);
  });
  it('idle can be asked for one conversation (not red-first: the door had one thread before)', async () => {
    const selfKeyOf = (id) => ({ default: 'me-key', werk: 'werk-key' })[id];
    const { d } = door({ selfKeyOf, threadId: undefined, interpret: async () => ({ reply: 'ok' }) });
    await d.read('een', { asSelf: 'werk' });
    await expect(d.idle({ asSelf: 'werk' })).resolves.not.toThrow?.();
  });
});

it('the door\'s catalogue is composed once per household manifest and app list, not per door', async () => {
  const { ownPlaceCatalogue } = await import('../../src/assistant/plusDoor.js');
  const a = ownPlaceCatalogue({});
  const b = ownPlaceCatalogue({});
  expect(b.catalogue).toBe(a.catalogue);
  const other = ownPlaceCatalogue({ apps: ['household'] });
  expect(other.catalogue).not.toBe(a.catalogue);
});

describe('the model is told it is the person\'s OWN place, never a household (journey 1)', () => {
  // the real interpreter, a model that records what it was told: the prompt is the place's, not an app's household bot
  it('"wat kan ik hier doen?" reaches the model with the own place\'s background and none of the household bot\'s', async () => {
    let system = ''; let said = '';
    const llm = { invoke: async (req) => { system = req.system; said = JSON.stringify(req.messages); return { replyText: 'Je eigen notities, afspraken en lijsten.' }; } };
    // one own note, so the turn carries retrieved items and their header
    const readAs = () => async (app) => (app === 'household' ? { items: [{ id: 'n1', type: 'note', body: 'wat ik hier wil doen: de tuin', createdBy: 'me-key' }] } : { items: [] });
    const { d } = door({ llm, interpret: interpretToCommand, readAs, selfOf: () => ({ key: 'me-key', isDefault: true }) });
    const r = await d.read('wat kan ik hier doen?');
    expect(r.done).toBe('Je eigen notities, afspraken en lijsten.');
    expect(system, 'the own place says what it is').toMatch(/OWN place/);
    expect(system, 'no household bot background').not.toMatch(/Household background|share a household/);
    expect(said, 'the items were handed over').toMatch(/Relevant items already here/);
    expect(said + system, 'no circle named in the own place').not.toMatch(/in this circle/);
  });
});

describe('a read the model picks is answered in words, also when it is empty (no "could not read")', () => {
  // the own agenda's read as the calendar answers it: its name, and each appointment's label
  const agenda = (items) => () => async (app, op) => (op === 'listEvents' ? { ok: true, title: 'Agenda', items } : { items: [] });
  const readTwice = vi.fn(async () => ({ opId: 'listEvents', args: { days: 2 } }));

  it('"wat heb ik morgen gepland?" with an appointment: its label, under the agenda\'s name', async () => {
    const { d } = door({ interpret: readTwice, readAs: agenda([{ id: 'e1', label: 'tandarts — wo 18 nov 10:00' }]), selfOf: () => ({ key: 'me', isDefault: true }) });
    const r = await d.read('wat heb ik morgen gepland?');
    expect(r.done).toContain('circle.vandaag.plus_list_items');
    expect(r.done).toContain('tandarts');
  });
  it('an empty agenda: "nothing on it", never "could not read that"', async () => {
    const { d } = door({ interpret: readTwice, readAs: agenda([]), selfOf: () => ({ key: 'me', isDefault: true }) });
    const r = await d.read('wat heb ik morgen gepland?');
    expect(r.done).toContain('circle.vandaag.plus_list_empty');
  });
});
