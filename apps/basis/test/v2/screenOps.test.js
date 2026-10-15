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

  it('undo walks back one change at a time, and is logged', async () => {
    const { store, log, ops } = world();
    await ops['screen-add-page']({ name: 'Vandaag' });
    const pageId = (await store.get()).screens[0].id;
    await ops['screen-add-block']({ pageId, type: 'calendar' });
    await ops['screen-rename-page']({ pageId, name: 'Thuis' });
    expect((await store.get()).screens[0]).toMatchObject({ name: 'Thuis' });

    expect((await ops['screen-undo']()).undid).toBe('screen-rename-page');
    expect((await store.get()).screens[0]).toMatchObject({ name: 'Vandaag' });
    expect((await store.get()).screens[0].blocks.map((b) => b.type)).toEqual(['calendar']);

    expect((await ops['screen-undo']()).undid).toBe('screen-add-block');
    expect((await store.get()).screens[0].blocks).toEqual([]);

    expect((await ops['screen-undo']()).undid).toBe('screen-add-page');
    expect((await store.get()).screens).toEqual([]);
    expect((await ops['screen-undo']()).error).toBe('nothing-to-undo');
    expect(pageChanges(log).filter((e) => e.payload.op === 'screen-undo')).toHaveLength(3);
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
