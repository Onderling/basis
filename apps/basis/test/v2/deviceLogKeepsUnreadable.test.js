/**
 * A DEVICE LOG THIS BUILD CANNOT READ IS NEVER SAVED OVER.
 *
 * The device log is a manifest naming its segments. A manifest this build could not read (a newer build's `v`, bytes
 * that do not parse, a read that failed) made the log start EMPTY — and the first append then wrote new segments over
 * the old ones, a manifest naming only those, and, knowing no earlier manifest, swept every segment row it did not
 * name: the whole record, gone. Now a log that could not be read is not given a save at all: the run keeps its log in
 * memory, nothing is written over the stored one, and it is said (`onNotReadable`, the device's one notice).
 */
import { describe, it, expect } from 'vitest';
import { wireEventLogPersistence, backendSnapshotIo } from '../../src/v2/eventLogPersistence.js';

function memoryBackend(initial = {}) {
  const m = new Map(Object.entries(initial));
  return {
    m,
    async get(k) { return m.has(k) ? { bytes: m.get(k) } : null; },
    async put(k, v) { m.set(k, v); },
    async delete(k) { m.delete(k); },
    async list(prefix) { return [...m.keys()].filter((k) => k.startsWith(prefix)); },
  };
}
function fakeLog() {
  const log = { events: [], persist: null };
  log.hydrate = (evs) => { log.events = evs; return evs.length; };
  log.setPersist = (fn) => { log.persist = fn; };
  return log;
}
const REF = 'device-log/events.json';

describe('the device log keeps a stored log it could not read', () => {
  for (const [what, manifest, reason] of [
    ['a newer build\'s manifest', JSON.stringify({ v: 2, segments: [{ key: `${REF}/seg/0000` }] }), 'version'],
    ['a torn manifest', '{"v":1,"segm', 'unparseable'],
  ]) {
    it(`${what}: no save is attached, the segments stay, and it is said`, async () => {
      const backend = memoryBackend({ [REF]: manifest, [`${REF}/seg/0000`]: '[{"id":"e1"}]' });
      const said = [];
      const log = fakeLog();
      await wireEventLogPersistence({ eventLog: log, io: backendSnapshotIo(backend), onNotReadable: (r) => said.push(r) });
      if (typeof log.persist === 'function') await log.persist([{ id: 'new' }]);
      await new Promise((r) => setTimeout(r, 450));   // past the debounce
      expect(backend.m.get(REF), 'the manifest was written over').toBe(manifest);
      expect(backend.m.get(`${REF}/seg/0000`), 'a segment was written over or swept').toBe('[{"id":"e1"}]');
      expect(said).toEqual([{ name: 'device-log', kind: 'messages', reason }]);
    });
  }

  it('a readable log saves as before', async () => {
    const backend = memoryBackend();
    const log = fakeLog();
    await wireEventLogPersistence({ eventLog: log, io: backendSnapshotIo(backend), debounceMs: 1 });
    log.persist([{ id: 'e1' }]);
    await new Promise((r) => setTimeout(r, 30));
    expect(JSON.parse(backend.m.get(REF)).v).toBe(1);
  });
});
