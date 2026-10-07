/**
 * The household switches what a change tells others: `/huishouden announce appointments|chores on|off` cancels or
 * reopens that announce row (its signature covers what it does, not whether it is on), `/huishouden` shows how they
 * stand, and `/gepland` follows.
 */
import { describe, it, expect } from 'vitest';
import { memoryDataSource, createCircleStores } from '@onderling/item-store';
import { validate } from '@onderling/item-types';
import { EventLog } from '../src/eventLog.js';
import { createBotThreads, memoryThreadStore } from '../src/v2/botThreads.js';
import { withAssistantOps } from '../src/v2/assistantOps.js';
import { createOwnDevicesStore } from '../src/v2/ownDevicesStore.js';
import { createIntentionBook } from '../src/v2/intentionBook.js';
import { seedAnnounceRows } from '../src/v2/announceRows.js';

const t = (k, v) => (v ? `${k} ${JSON.stringify(v)}` : k);

async function door() {
  const threads = createBotThreads({ eventLog: new EventLog({ initial: [], muted: [] }), store: memoryThreadStore() });
  await threads.load();
  const home = createCircleStores({ dataSource: memoryDataSource(), registry: { validate } }).getStore('c-home');
  const book = createIntentionBook({ store: createOwnDevicesStore({ dataSource: memoryDataSource() }), circles: async () => [{ scope: 'c-home', store: home }], actor: 'host' });
  await book.load();
  await seedAnnounceRows(book, 'c-home');
  const callSkill = async (app, op) => (app === 'params' && op === 'list-user-params' ? { ok: true, params: [] } : { ok: true });
  const d = withAssistantOps({ callSkill, threads, t, intentions: { book, tz: 'Europe/Amsterdam', sources: async () => ({ events: [], chores: [] }), users: async () => [{ id: 'telegram:9', role: 'admin' }] } });
  const say = (change) => d('assistant', 'assistant-settings', { change }, { caller: 'telegram:9', threadId: 'telegram:9' });
  const stateOf = async (label) => (await home.listByType('intention')).find((r) => r.label === label)?.state;
  return { say, stateOf, d };
}

describe('/huishouden announce', () => {
  it('switches a kind off and on again; the list says how they stand; /gepland follows', async () => {
    const w = await door();
    expect((await w.say('')).message).toContain('"announce":"circle.bot.planned_announce_appointments, circle.bot.planned_announce_chores"');
    const off = await w.say('announce chores off');
    expect(off.ok, JSON.stringify(off)).toBe(true);
    expect(await w.stateOf('announce-chores')).toBe('cancelled');
    expect(await w.stateOf('announce-appointments')).toBe('open');
    const planned = await w.d('assistant', 'assistant-planned', {}, { caller: 'telegram:9', threadId: 'telegram:9' });
    expect(planned.message).toContain('circle.bot.planned_announce {"which":"circle.bot.planned_announce_appointments"}');
    expect((await w.say('announce chores on')).ok).toBe(true);
    expect(await w.stateOf('announce-chores')).toBe('open');
  });

  it('a word it does not know is the usage line, and nothing changes', async () => {
    const w = await door();
    expect((await w.say('announce everything off')).ok).toBe(false);
    expect((await w.say('announce chores maybe')).ok).toBe(false);
    expect(await w.stateOf('announce-chores')).toBe('open');
  });
});
