/**
 * The phone's ids-and-metadata stores are sealed at rest (ledger L1083 c): the connection points (sealed on the phone
 * only — the web reads them before its key), the calendar id map, and the ask-match skips through the shared io.
 */
import { describe, it, expect, afterEach } from 'vitest';
import { groupKeyStrategy } from '@onderling/pod-client';
import { setShellContentSeal } from '../../basis/src/v2/localStoreSeal.js';
import { createConnectionPoints } from '../../basis/src/v2/connectionPoints.js';
import { createAskMatchSkips, asyncStorageAskMatchSkipsIo } from '../../basis/src/v2/askMatches.js';
import { phoneConnectionPointsIo } from '../src/core/connectionPointsRN.js';
import { applyDiff, loadEventIdMap } from '../src/core/nativeCalendar.js';

const RELAY = 'wss://relay.of-the-circle.example';
afterEach(() => setShellContentSeal(null));

function asyncStorage() {
  const m = new Map();
  return { getItem: async (k) => (m.has(k) ? m.get(k) : null), setItem: async (k, v) => { m.set(k, String(v)); }, removeItem: async (k) => { m.delete(k); }, getAllKeys: async () => [...m.keys()], _m: m };
}
const raw = (s) => [...s._m.values()].join('\n');
const seal = () => setShellContentSeal(groupKeyStrategy({ groupKey: Buffer.from(new Uint8Array(32).fill(5)).toString('base64url') }));

describe('the phone seals its ids-and-metadata stores', () => {
  it('cc.connectionPoints: not readable as stored, read back through the shared logic', async () => {
    seal();
    const s = asyncStorage();
    const io = phoneConnectionPointsIo(s);
    const store = createConnectionPoints({ initial: await io.load(), save: io.save });
    store.addFromJoin(RELAY, 'c1');
    await new Promise((r) => { setTimeout(r, 10); });
    expect(raw(s)).not.toContain('relay.of-the-circle');
    expect(JSON.stringify(await phoneConnectionPointsIo(s).load())).toContain('relay.of-the-circle');
  });

  it('cc.nativeCalendar.eventIdMap: not readable as stored, read back with the key', async () => {
    seal();
    const s = asyncStorage();
    const Calendar = { createEventAsync: async () => 'evt-tandarts', updateEventAsync: async () => true, deleteEventAsync: async () => true };
    await applyDiff({ CalendarModule: Calendar, calendarId: 'cal', diff: { create: [{ itemId: 'appt-1', ev: { title: 'x' } }] }, storage: s });
    expect(raw(s)).not.toContain('evt-tandarts');
    expect((await loadEventIdMap({ storage: s }))['appt-1']).toBe('evt-tandarts');
  });

  it('cc.askMatchSkips: not readable as stored on the phone', async () => {
    seal();
    const s = asyncStorage();
    await createAskMatchSkips(asyncStorageAskMatchSkipsIo(s)).add('post-1', 'webid-henk');
    expect(raw(s)).not.toContain('webid-henk');
    expect((await createAskMatchSkips(asyncStorageAskMatchSkipsIo(s)).list()).join()).toContain('webid-henk');
  });
});
