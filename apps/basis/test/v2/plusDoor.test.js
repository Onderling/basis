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
import { listsManifest as LISTS } from '../../../lists/manifest.js';
import { EventLog } from '../../src/eventLog.js';
import { createBotThreads, memoryThreadStore } from '../../src/v2/botThreads.js';
import { catalogueManifests } from '../../src/v2/manifestSources.js';
import { mergeManifests } from '../../src/manifestMerge.js';

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

  it('no own model: the line is not sent anywhere, and the "+" says it could not read it', async () => {
    const interpret = vi.fn(async () => ({ reply: 'x' }));
    const { d } = door({ llm: null, interpret });
    const r = await d.read('wat kan je allemaal?');
    expect(interpret).not.toHaveBeenCalled();
    expect(r.error).toBeTruthy();
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
  it('a field the act does not declare (a circle named) is dropped; a circle\'s op is no reading', async () => {
    const { d, callSkill } = door({ interpret: async () => ({ opId: 'addEvent', args: { title: 'kapper', when: '2026-11-17T10:00', circleId: 'kring' } }) });
    expect((await d.read('kun je de kapper voor me regelen?')).values).toEqual({ title: 'kapper', when: '2026-11-17T10:00' });
    const c = door({ interpret: async () => ({ opId: 'addToList', args: { list: 'Boodschappen', text: 'melk', circleId: 'c1' } }) });
    expect((await c.d.read('melk halen voor thuis, regel jij dat?')).error).toBeTruthy();
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
    expect(r).toEqual({ actId: 'household.note', values: { body: 'de sleutel ligt bij de buren' } });
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
  it('another self ticked: the general self\'s note never reaches the model (D8)', async () => {
    let context = null;
    const interpret = async (_text, o) => { context = JSON.stringify(o.context ?? []); return { reply: 'Weet ik niet.' }; };
    const { d } = door({ interpret, readAs: ownRoutes, selfOf });
    await d.read('waar ligt de sleutel?', { asSelf: 'werk' });
    expect(context).not.toContain('sleutel');
  });
});
