/**
 * WHAT THE HISTORY MIRROR KEEPS IS DECLARED PER KIND (docs/decisions.md 2026-11-13). The person's conversation with the
 * assistant (`assistant-turn`) and what was heard nearby (`nearby-line`, `nearby-card`) stay out of the mirror and the
 * export: Forget has to be final, and a room's lines are other people's with the room's retention. Everything else is
 * mirrored as before. A restore brings nothing of a kind the mirror does not keep, also from a mirror written before.
 */
import { describe, it, expect } from 'vitest';
import { memoryDataSource, entryKind, ENTRY_KINDS } from '@onderling/item-store';
import { createHistoryMirror, hydrateHistory, exportHistoryArchive } from '../../src/v2/historyMirror.js';
import { EventLog } from '../../src/eventLog.js';
import { createBotThreads, memoryThreadStore } from '../../src/v2/botThreads.js';

const line = (id, text) => ({ id, app: 'circle', type: 'chat-message', actor: 'me', ts: Date.now(), payload: { circleId: 'k1', text } });
const heard = (id) => ({ id, app: 'basis', type: 'nearby-line', actor: 'someone', ts: Date.now(), payload: { text: 'gehoord in de kamer' } });

async function mirrorOf(log) {
  const src = memoryDataSource();
  const mirror = createHistoryMirror({ eventLog: log, source: src, batchMax: 1, flushMs: 5 });
  await mirror.start();
  return { src, mirror };
}
async function bodies(src) {
  const out = [];
  for (const k of await src.list('basis/history/')) out.push(String(await src.read(k) ?? ''));
  return out.join('\n');
}

describe('the history mirror keeps what each kind declares', () => {
  it('every kind declares it (true or false); the three left out are the assistant conversation and what was heard nearby', () => {
    for (const [kind, v] of Object.entries(ENTRY_KINDS)) expect(typeof v.mirrored, kind).toBe('boolean');
    const out = Object.entries(ENTRY_KINDS).filter(([, v]) => v.mirrored === false).map(([k]) => k).sort();
    expect(out).toEqual(['assistant-turn', 'item-changed', 'nearby-card', 'nearby-line', 'notification']);
  });

  it('an assistant turn (the "+" thread) written with the mirror on is not in the mirror; a circle line beside it is', async () => {
    const log = new EventLog({ initial: [], muted: [] });
    const threads = createBotThreads({ eventLog: log, store: memoryThreadStore() });
    const { src, mirror } = await mirrorOf(log);
    threads.memory.remember('own:me', 'you', 'geheime plusregel');
    log.append(line('c1', 'een kringregel'));
    await mirror.flush();
    const all = await bodies(src);
    expect(all).not.toContain('geheime plusregel');
    expect(all).toContain('een kringregel');
  });

  it('what was heard nearby is not in the mirror', async () => {
    const log = new EventLog({ initial: [], muted: [] });
    const { src, mirror } = await mirrorOf(log);
    log.append(heard('n1'));
    await mirror.flush();
    expect(await bodies(src)).not.toContain('gehoord in de kamer');
  });

  it('an export does not hold a "+" turn', async () => {
    const log = new EventLog({ initial: [], muted: [] });
    const threads = createBotThreads({ eventLog: log, store: memoryThreadStore() });
    threads.memory.remember('own:me', 'you', 'geheime plusregel');
    log.append(line('c1', 'een kringregel'));
    const ident = (x) => x;
    const archive = await exportHistoryArchive({ eventLog: log, strategy: { seal: ident, open: ident } });
    expect(archive).not.toContain('geheime plusregel');
    expect(archive).toContain('een kringregel');
  });

  it('Forget, then a restore from a mirror written BEFORE this change: the forgotten conversation does not come back', async () => {
    // a mirror that already holds a turn (written by an older version): a restore must not bring it back
    const src = memoryDataSource();
    const old = new EventLog({ initial: [], muted: [] });
    const legacy = createHistoryMirror({ eventLog: old, source: src, batchMax: 1, flushMs: 5, keeps: () => true });   // an older mirror: it kept every kind
    await legacy.start();
    old.append({ id: 't1', app: 'basis', type: 'assistant-turn', actor: 'me', ts: Date.now(), payload: { kind: 'assistant-turn', threadId: 'own:me', who: 'you', text: 'vergeten regel' } });
    old.append(line('c1', 'een kringregel'));
    await legacy.flush();
    const fresh = new EventLog({ initial: [], muted: [] });
    await hydrateHistory({ source: src, eventLog: fresh, logger: { info() {}, warn() {} } });
    const restored = fresh.query({});
    expect(restored.some((e) => e.type === 'assistant-turn'), 'a forgotten turn came back').toBe(false);
    expect(restored.some((e) => e.id === 'c1')).toBe(true);
  });

  it('a kind the table does not know stays OUT of the mirror (unknown is plumbing, not the record)', async () => {
    expect(entryKind('some-new-kind').mirrored).toBe(false);
    const log = new EventLog({ initial: [], muted: [] });
    const { src, mirror } = await mirrorOf(log);
    log.append({ id: 'u1', app: 'x', type: 'some-new-kind', actor: 'me', ts: Date.now(), payload: { text: 'onbekende soort' } });
    await mirror.flush();
    expect(await bodies(src)).not.toContain('onbekende soort');
  });

  it('the two kinds production appended unregistered are declared: a panel ping and an alert, both plumbing', () => {
    for (const k of ['item-changed', 'notification']) {
      expect(k in ENTRY_KINDS, k).toBe(true);
      expect(ENTRY_KINDS[k].mirrored, k).toBe(false);
      // as they behaved unregistered: the system lane, never waking, the short retention
      expect(ENTRY_KINDS[k].lane, k).toBe('system');
      expect(ENTRY_KINDS[k].wakes, k).toBe(false);
    }
  });

  it('appending a type the table does not know says so once, through the logger', async () => {
    const { dumpLogs, clearLogs } = await import('@onderling/logger');
    clearLogs();
    const log = new EventLog({ initial: [], muted: [] });
    log.append({ id: 'a', app: 'x', type: 'never-declared-kind', actor: 'me', ts: Date.now(), payload: {} });
    log.append({ id: 'b', app: 'x', type: 'never-declared-kind', actor: 'me', ts: Date.now(), payload: {} });
    const said = dumpLogs().filter((r) => r.code === 'kind.unregistered' && r.f?.type === 'never-declared-kind');
    expect(said).toHaveLength(1);
  });
});
