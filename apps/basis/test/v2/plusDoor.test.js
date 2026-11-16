/**
 * The person's own "+" as a conversation: ONE shared door (`createPlusDoor`) both shells call with the line. Per line:
 * help, then the plain reading (own acts, own lists, a circle's phrases), and only then the person's OWN model through
 * the assistant engine, which may answer in words or propose an own act. Nothing the model proposes happens without
 * the person's yes: an own act opens its form filled and Save is the yes. The model here is a stand-in.
 */
import { describe, it, expect, vi } from 'vitest';
import { createPlusDoor } from '../../src/v2/plusDoor.js';
import { listsManifest as LISTS } from '../../../lists/manifest.js';

const t = (k, v) => (v ? `${k} ${JSON.stringify(v)}` : k);
const memoryOf = () => {
  const rows = new Map();
  return {
    remember(id, who, text) { const r = rows.get(id) ?? []; r.push(`${who}: ${text}`); rows.set(id, r); },
    recent: (id) => rows.get(id) ?? [],
  };
};
const door = (over = {}) => {
  const callSkill = vi.fn(async () => ({ ok: true }));
  const d = createPlusDoor({
    llm: { invoke: async () => null }, interpret: async () => null, memory: memoryOf(), threadId: 'own:me', t, lang: 'nl',
    circles: async () => [], ownListsOf: async () => [], callSkill, ...over,
  });
  return { d, callSkill };
};

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
    expect(r.values, JSON.stringify(r.values)).toMatchObject({ title: 'tandarts' });
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
    const memory = memoryOf();
    const { d } = door({ interpret, memory });
    await d.read('wat kan je allemaal?');
    await d.read('en verder?');
    expect(histories[1].map((m) => m.content).join(' ')).toContain('wat kan je allemaal?');
  });
});

it('a circle act the plain reading runs at once answers with what the run said, and is kept', async () => {
  const memory = memoryOf();
  const runInCircle = vi.fn(async () => ({ done: 'melk staat op Boodschappen' }));
  const circles = async () => [{ id: 'c1', name: 'Thuis', manifestsByOrigin: { lists: LISTS }, lists: [{ name: 'Boodschappen' }] }];
  const { d } = door({ memory, runInCircle, circles });
  const r = await d.read('zet melk op Boodschappen');
  expect(runInCircle).toHaveBeenCalledTimes(1);
  expect(r).toEqual({ done: 'melk staat op Boodschappen' });
  expect(memory.recent('own:me').at(-1)).toContain('melk staat op Boodschappen');
});
