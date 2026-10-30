/**
 * What a circle store holds must survive two of its own changes overlapping. A write checks "is what I hold current"
 * before it awaits the source and updates what it holds after; a second change in that window that leaves the source's
 * revision where it was (a delete of a row that is not there, a write of the same bytes) dropped what was held — and the
 * first write then updated a memory that was gone: `Cannot read properties of null (reading 'set')`, the bot's reply in
 * a CI run of botJoinsCircle (2026-10-30), with its add never fanned.
 */
import { describe, it, expect } from 'vitest';
import { CircleItemStore } from '../src/CircleItemStore.js';

/** A source whose revision moves when a change starts, whose write resolves when let go, and that skips no-op changes. */
function gatedSource() {
  const m = new Map();
  let release = null;
  const s = {
    rev: 0, gate: false,
    async read(p) { return m.has(p) ? m.get(p) : null; },
    async write(p, d) {
      if (m.get(p) === d) return;                 // the same bytes: nothing changed, no new revision
      m.set(p, d); s.rev += 1;
      if (s.gate) { s.gate = false; await new Promise((r) => { release = r; }); }
    },
    async delete(p) { if (!m.has(p)) return; m.delete(p); s.rev += 1; },
    async list(prefix) { return [...m.keys()].filter((k) => k.startsWith(prefix)).sort(); },
    letGo() { release?.(); },
  };
  Object.defineProperty(s, 'revision', { get: () => s.rev });
  return s;
}

describe('two overlapping changes of one circle store', () => {
  it('a write that finishes after a no-op change dropped the memory does not throw, and the next read is right', async () => {
    const src = gatedSource();
    const store = new CircleItemStore({ dataSource: src, rootContainer: 'mem://circles/c1/' });
    await store.put({ id: 'a', type: 'list-item', text: 'brood' });
    await store.list();                                             // held, current
    src.gate = true;
    const first = store.put({ id: 'b', type: 'list-item', text: 'melk' });   // its write is under way
    await new Promise((r) => { setTimeout(r, 0); });
    await store.delete('not-there').catch(() => null);              // a no-op change while the first is in the window
    src.letGo();
    await expect(first).resolves.toMatchObject({ id: 'b' });
    expect((await store.list()).map((i) => i.text).sort()).toEqual(['brood', 'melk']);
  });
});
