/**
 * How far the "+" goes for the persona it speaks as (ledger L977, the ceiling per persona): 0 off, 1 only looks things
 * up, 2 also the person's own things, 3 also a circle's after their yes (the default). The strictest of the selves in a
 * turn holds. It cuts what the model is handed AND what any door of the "+" runs (a slash line, a phrase, the model's
 * pick, a circle's line), so nothing above it happens by another way in.
 */
import { describe, it, expect, vi } from 'vitest';
import { createPlusDoor } from '../../src/assistant/plusDoor.js';
import { catalogueManifests } from '../../src/v2/manifestSources.js';
import { EventLog } from '../../src/eventLog.js';
import { createBotThreads, memoryThreadStore } from '../../src/v2/botThreads.js';

const t = (k, v) => (v ? `${k} ${JSON.stringify(v)}` : k);
const manifestsByOrigin = Object.fromEntries(catalogueManifests().filter((m) => m?.app).map((m) => [m.app, m]));
const thuis = { id: 'k1', name: 'Thuis', manifestsByOrigin, lists: [] };
const shopping = { name: 'boodschappen', kind: 'list', defaultChild: null, aliases: [] };
const door = ({ ceilings = {}, interpret = async () => null, runInCircle = vi.fn(async () => ({ done: 'ok' })) } = {}) => {
  const callSkill = vi.fn(async () => ({ ok: true }));
  const d = createPlusDoor({
    llm: { invoke: async () => null }, interpret, threads: createBotThreads({ eventLog: new EventLog({ initial: [], muted: [] }), store: memoryThreadStore() }),
    threadId: 'own:me', t, lang: 'nl', circles: async () => [thuis], ownListsOf: async () => [shopping], callSkill, runInCircle,
    ceilingOf: async (self) => ceilings[self ?? 'default'] ?? 3,
  });
  return { d, callSkill, runInCircle };
};
const OFF = 'circle.vandaag.plus_ceiling_off';
const NOT_HERE = 'circle.vandaag.plus_ceiling_refused';

describe('the ceiling of the "+" per persona', () => {
  it('0: the "+" is off for the persona; nothing reaches the model', async () => {
    const interpret = vi.fn(async () => ({ reply: 'x' }));
    const { d } = door({ ceilings: { werk: 0 }, interpret });
    expect((await d.read('wat staat er vandaag?', { asSelf: 'werk' })).done).toBe(OFF);
    expect(interpret).not.toHaveBeenCalled();
    // the strictest of the selves read together holds
    expect((await d.read('wat staat er vandaag?', { asSelf: 'default', selves: ['default', 'werk'] })).done).toBe(OFF);
  });

  it('1: the model is handed reads only, and a write it picks anyway is refused, not opened', async () => {
    let seen = null;
    const interpret = vi.fn(async (_text, o) => { seen = o.catalogue; return { opId: 'addEvent', args: { title: 'tandarts', when: '2026-11-17T10:00' } }; });
    const { d } = door({ ceilings: { default: 1 }, interpret });
    const r = await d.read('kun je de tandarts voor me regelen?');
    expect(r.actId).toBeUndefined();
    expect(r.error ?? r.done).toBe(NOT_HERE);
    const ids = [...seen.opsById.values()].map((e) => e.op.id);
    expect(ids).not.toContain('addEvent');
    expect(ids).toContain('listEvents');
  });

  it('1: a slash line for a write is refused too', async () => {
    const { d } = door({ ceilings: { default: 1 } });
    const r = await d.read('/add-note de sleutel ligt bij de buren');
    expect(r.actId).toBeUndefined();
    expect(r.error ?? r.done).toBe(NOT_HERE);
  });

  it('2: the person\'s own things, yes (their own list is theirs, even where the op declares a circle\'s widest)', async () => {
    const { d } = door({ ceilings: { default: 2 }, interpret: async () => ({ opId: 'addToList', args: { list: 'Boodschappen', text: 'melk' } }) });
    const r = await d.read('kun je melk op mijn boodschappen zetten, graag');
    expect(r.card?.to?.every((x) => x.own === true)).toBe(true);
  });

  it('2: a circle\'s line is refused; at 3 it is not', async () => {
    const two = door({ ceilings: { default: 2 } });
    const r = await two.d.read('Thuis: maak een lijst Boodschappen');
    expect(r.card).toBeUndefined();
    expect(r.error ?? r.done).toBe(NOT_HERE);
    expect(two.runInCircle).not.toHaveBeenCalled();
    const three = door();
    expect((await three.d.read('Thuis: maak een lijst Boodschappen')).error ?? null).not.toBe(NOT_HERE);
  });

  it('a ceiling that cannot be read closes the "+" for that turn: one line, nothing run, nothing to a model', async () => {
    const UNREAD = 'circle.vandaag.plus_ceiling_unread';
    const mk = (ceilingOf, readAs) => {
      const interpret = vi.fn(async () => ({ opId: 'addEvent', args: { title: 'tandarts', when: '2026-11-17T10:00' } }));
      const runInCircle = vi.fn(async () => ({ done: 'ok' }));
      const callSkill = vi.fn(async () => ({ ok: true }));
      const d = createPlusDoor({
        llm: { invoke: async () => null }, interpret, threads: createBotThreads({ eventLog: new EventLog({ initial: [], muted: [] }), store: memoryThreadStore() }),
        threadId: 'own:me', t, lang: 'nl', circles: async () => [thuis], ownListsOf: async () => [shopping], callSkill, runInCircle,
        ...(ceilingOf ? { ceilingOf } : {}), ...(readAs ? { readAs } : {}),
      });
      return { d, interpret, runInCircle, callSkill };
    };
    // the shell's own read throws
    const thrown = mk(async () => { throw new Error('vault locked'); });
    for (const line of ['kun je de tandarts voor me regelen?', 'Thuis: maak een lijst Boodschappen', '/add-note de sleutel ligt bij de buren']) {
      const r = await thrown.d.read(line);
      expect(r.error ?? r.done, line).toBe(UNREAD);
      expect(r.actId ?? r.card ?? null, line).toBeNull();
    }
    expect(thrown.interpret).not.toHaveBeenCalled();
    expect(thrown.runInCircle).not.toHaveBeenCalled();
    // one self of a set read together cannot be read: the turn is closed too
    const oneOfTwo = mk(async (self) => { if (self === 'werk') throw new Error('x'); return 3; });
    expect((await oneOfTwo.d.read('wat staat er vandaag?', { asSelf: 'default', selves: ['default', 'werk'] })).error).toBe(UNREAD);
    // the op answers ok:false through readAs (the shell's call): the same
    const refused = mk(null, () => async (app, opId) => (opId === 'getPlusCeiling' ? { ok: false, reason: 'not-found' } : { ok: true, items: [] }));
    expect((await refused.d.read('kun je de tandarts voor me regelen?')).error).toBe(UNREAD);
    expect(refused.interpret).not.toHaveBeenCalled();
    // an answer that is not a ceiling at all is not read either
    const garbled = mk(async () => 'drie');
    expect((await garbled.d.read('kun je de tandarts voor me regelen?')).error).toBe(UNREAD);
    // and a later turn that CAN read it goes on as usual
    let fail = true;
    const flaky = mk(async () => { if (fail) throw new Error('once'); return 3; });
    expect((await flaky.d.read('kun je de tandarts voor me regelen?')).error).toBe(UNREAD);
    fail = false;
    expect((await flaky.d.read('kun je de tandarts voor me regelen?')).actId).toBe('calendar.calendar-event');
  });

  it('a shell with no way to read it at all: 3, the "+" as before', async () => {
    const d = createPlusDoor({
      llm: { invoke: async () => null }, interpret: async () => ({ opId: 'addEvent', args: { title: 'tandarts', when: '2026-11-17T10:00' } }),
      threads: createBotThreads({ eventLog: new EventLog({ initial: [], muted: [] }), store: memoryThreadStore() }),
      threadId: 'own:me', t, lang: 'nl', circles: async () => [thuis], ownListsOf: async () => [shopping], callSkill: vi.fn(async () => ({ ok: true })),
    });
    expect((await d.read('kun je de tandarts voor me regelen?')).actId).toBe('calendar.calendar-event');
  });

  it('nothing said: 3, the "+" as before', async () => {
    const { d } = door({ interpret: async () => ({ opId: 'addEvent', args: { title: 'tandarts', when: '2026-11-17T10:00' } }) });
    expect((await d.read('kun je de tandarts voor me regelen?')).actId).toBe('calendar.calendar-event');
  });
});
