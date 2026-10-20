/**
 * The person's pages, edited through ops: each change lands in the book, is kept as a version, and is written to the
 * device log as a settings change naming the op and the versions it went between; undo walks back one change at a
 * time and is itself logged. A block the person's pages may not hold is refused.
 */
import { describe, it, expect } from 'vitest';
import { createObjectVersionsAdapter } from '@onderling/kring-host/objectVersionsStorage';
import { createMemoryBackend } from '@onderling/pseudo-pod';
import { createUserScreenStore } from '../../src/v2/userScreens.js';
import { createScreenOps } from '../../src/v2/screenOps.js';
import { EventLog } from '../../src/eventLog.js';

let clock = 1_000;
const world = () => {
  const mem = new Map();
  const store = createUserScreenStore({
    io: { load: async () => mem.get('book') ?? null, save: async (b) => { mem.set('book', b); } },
    versions: createObjectVersionsAdapter({ storeName: 'screens', backend: createMemoryBackend(), now: () => (clock += 10) }),
  });
  const log = new EventLog({ initial: [], muted: [] });
  return { store, log, ops: createScreenOps({ store, log, actor: 'me' }) };
};
const pageChanges = (log) => log.query({ filter: { type: 'settings-change' } }).filter((e) => String(e.payload?.op).startsWith('screen-'));

describe('the screen book through ops', () => {
  it('a page added through the op is in the book, and the log names the op with the versions it went between', async () => {
    const { store, log, ops } = world();
    const r = await ops['screen-add-page']({ name: 'Vandaag' });
    expect(r.ok).toBe(true);
    const book = await store.get();
    expect(book.screens.map((s) => s.name)).toEqual(['Vandaag']);
    const [entry] = pageChanges(log);
    expect(entry.payload.op).toBe('screen-add-page');
    expect(entry.payload.version.previous, 'what it replaced is kept').toEqual(expect.any(Number));
    expect(entry.payload.version.current).toEqual(expect.any(Number));
    expect(entry.payload.version.current).not.toBe(entry.payload.version.previous);
  });

  it('undo walks back one change at a time (the versions decide), and is logged', async () => {
    const { store, log, ops } = world();
    await ops['screen-add-page']({ name: 'Vandaag' });
    const pageId = (await store.get()).screens[0].id;
    await ops['screen-add-block']({ pageId, type: 'calendar' });
    await ops['screen-rename-page']({ pageId, name: 'Thuis' });
    expect((await store.get()).screens[0]).toMatchObject({ name: 'Thuis' });

    expect((await ops['screen-undo']()).ok).toBe(true);
    expect((await store.get()).screens[0]).toMatchObject({ name: 'Vandaag' });
    expect((await store.get()).screens[0].blocks.map((b) => b.type)).toEqual(['calendar']);
    expect((await ops['screen-undo']()).ok).toBe(true);
    expect((await store.get()).screens[0].blocks).toEqual([]);
    expect((await ops['screen-undo']()).ok).toBe(true);
    expect((await store.get()).screens).toEqual([]);
    expect((await ops['screen-undo']()).error).toBe('nothing-to-undo');
    expect(pageChanges(log).filter((e) => e.payload.op === 'screen-undo')).toHaveLength(3);
  });

  it('undo never reads the log: it works with no log at all, and after an edit it steps back through that edit\'s parent', async () => {
    const { store, ops: logged } = world();
    const ops = createScreenOps({ store, log: null });
    await logged['screen-add-page']({ name: 'A' });
    const pageId = (await store.get()).screens[0].id;
    await ops['screen-rename-page']({ pageId, name: 'B' });
    await ops['screen-rename-page']({ pageId, name: 'C' });
    await ops['screen-undo']();
    expect((await store.get()).screens[0].name).toBe('B');
    await ops['screen-rename-page']({ pageId, name: 'D' });   // an edit after an undo
    await ops['screen-undo']();
    expect((await store.get()).screens[0].name, 'back to where the edit was made, never to the undone C').toBe('B');
    await ops['screen-undo']();
    expect((await store.get()).screens[0].name).toBe('A');
  });

  it('refuses a block the person\'s pages may not hold, and a page that does not exist', async () => {
    const { store, ops } = world();
    await ops['screen-add-page']({ name: 'Vandaag' });
    const pageId = (await store.get()).screens[0].id;
    expect((await ops['screen-add-block']({ pageId, type: 'rules' })).error).toBe('block-not-for-pages');
    expect((await ops['screen-add-block']({ pageId, type: 'identityLine' })).ok).toBe(true);
    expect((await ops['screen-rename-page']({ pageId: 'nope', name: 'x' })).error).toBe('no-such-page');
  });

  it('without a book (a box has none), every op says so', async () => {
    const ops = createScreenOps({ store: null });
    expect((await ops['screen-add-page']({ name: 'x' })).error).toBe('no-screen-book');
  });
});

describe('Vastgezet through the screen ops', () => {
  it('a bookmark is kept as its address only; unpin takes it; both are versions an undo steps back', async () => {
    const { store, ops } = world();
    expect((await ops['screen-pin']({ kind: 'bookmark', circleId: 'c1', appOrigin: 'pinboard', opId: 'postRequest', args: { text: 'x' } })).ok).toBe(true);
    expect((await store.get()).pinned).toEqual([{ kind: 'bookmark', circleId: 'c1', appOrigin: 'pinboard', opId: 'postRequest' }]);
    expect((await ops['screen-pin']({ kind: 'bookmark', circleId: 'c1' })).ok).toBe(false);
    expect((await ops['screen-unpin']({ key: 'bookmark:c1:pinboard:postRequest' })).ok).toBe(true);
    expect((await store.get()).pinned ?? []).toEqual([]);
    await ops['screen-undo']({});
    expect((await store.get()).pinned).toHaveLength(1);
  });
});
