/**
 * Vandaag, the home: the first page is seeded once (the coming week, my tasks, the circles with news) and never again;
 * the circles-with-news block lists the page's circles where another person wrote since this device last looked.
 */
import { describe, it, expect } from 'vitest';
import { createUserScreenStore } from '../../src/v2/userScreens.js';
import { ensureVandaagBook, VANDAAG_DEFAULT_BLOCKS } from '../../src/v2/vandaag.js';
import { materializeScreen } from '../../src/v2/userScreenBlocks.js';
import { EventLog } from '../../src/eventLog.js';

const t = (k) => k;
const memStore = () => { let book = null; return createUserScreenStore({ io: { load: async () => book, save: async (b) => { book = b; } } }); };

describe('Vandaag', () => {
  it('seeds one page with the default blocks, active, once', async () => {
    const store = memStore();
    const book = await ensureVandaagBook({ store, t });
    expect(book.screens).toHaveLength(1);
    expect(book.activeId).toBe(book.screens[0].id);
    expect(book.screens[0].blocks.map((b) => b.type)).toEqual(VANDAAG_DEFAULT_BLOCKS.map((b) => b.type));
    expect(book.screens[0].blocks[0].config.horizonDays).toBe(7);
    // a person's own changes are never seeded over
    await store.update((cur) => ({ ...cur, screens: [{ ...cur.screens[0], name: 'Mijn dag' }] }));
    expect((await ensureVandaagBook({ store, t })).screens.map((s) => s.name)).toEqual(['Mijn dag']);
  });

  it('circles with news: another person\'s lines since this device looked, newest first; my own never count', async () => {
    const log = new EventLog({ initial: [], muted: [] });
    const at = (circleId, actor, ts, id) => log.append({ id, ts, app: 'chat', type: 'chat-message', circleId, actor, payload: { text: 'hoi' } });
    at('a', 'bea', 1000, 'm1');
    at('b', 'cor', 2000, 'm2');
    at('b', 'me', 3000, 'm3');
    at('c', 'me', 4000, 'm4');
    const circles = [{ id: 'a', name: 'Thuis' }, { id: 'b', name: 'Werk' }, { id: 'c', name: 'Club' }];
    const [block] = await materializeScreen({
      screen: { id: 's', name: 'Vandaag', circleFilter: null, blocks: [{ id: 'x', type: 'circlesUnread', config: { limit: 5 } }] },
      hostOps: { eventLog: log, circles, seenAt: {}, myRefs: ['me'] },
    });
    expect(block.status).toBe('ok');
    expect(block.content.items.map((r) => [r.circleId, r.unread])).toEqual([['b', 1], ['a', 1]]);
    // seen since: nothing new there
    const [seen] = await materializeScreen({
      screen: { id: 's', name: 'Vandaag', circleFilter: null, blocks: [{ id: 'x', type: 'circlesUnread', config: {} }] },
      hostOps: { eventLog: log, circles, seenAt: { a: 5000, b: 5000 }, myRefs: ['me'] },
    });
    expect(seen.status).toBe('empty');
  });
});

describe('the block filters, materialized', () => {
  const page = (block) => ({ id: 's', name: 'Vandaag', circleFilter: null, blocks: [block] });
  it('a block\'s own circles narrow the page\'s; labels filter a type that carries them; a relative date drops the old', async () => {
    const now = Date.now();
    const notes = {
      a: [{ id: 'n1', type: 'note', text: 'boodschappen', tags: ['Thuis'], updatedAt: new Date(now - 3600_000).toISOString() }],
      b: [
        { id: 'n2', type: 'note', text: 'planning', tags: ['werk'], updatedAt: new Date(now - 3600_000).toISOString() },
        { id: 'n3', type: 'note', text: 'oud', tags: ['werk'], updatedAt: new Date(now - 40 * 86_400_000).toISOString() },
      ],
    };
    const callSkill = async (app, op, args) => ({ result: notes[args?.circleId] ?? [] });
    const hostOps = { callSkill, circles: [{ id: 'a', name: 'Thuis' }, { id: 'b', name: 'Werk' }] };
    const ids = async (config) => {
      const [b] = await materializeScreen({ screen: page({ id: 'x', type: 'notes', config }), hostOps });
      return (b.content?.items ?? []).map((r) => r.id).sort();
    };
    expect(await ids({ limit: 10 })).toEqual(['n1', 'n2', 'n3']);
    expect(await ids({ limit: 10, circleIds: ['b'] }), 'only the block\'s circle').toEqual(['n2', 'n3']);
    expect(await ids({ limit: 10, labels: ['WERK'] }), 'only the label').toEqual(['n2', 'n3']);
    expect(await ids({ limit: 10, labels: ['werk'], withinDays: 7 }), 'and only this week').toEqual(['n2']);
  });
});
