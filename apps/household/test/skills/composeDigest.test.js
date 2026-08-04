import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { composeDigest } from '../../src/skills/composeDigest.js';
import { InMemoryStore } from '../../src/storage/InMemoryStore.js';

const SAMPLE_SOURCE = { tg: { chatId: 'c', messageId: 'm' } };

// Fixed "now" used by every test — 2026-04-30 20:00 UTC.
const NOW_MS = Date.parse('2026-04-30T20:00:00.000Z');
const DAY_MS = 24 * 60 * 60 * 1000;

function makeCtx(store) {
  return {
    store,
    chatId: 'chat-test',
    senderWebid: 'webid:bot',
    bridgeId: 'mock',
  };
}

describe('skills/composeDigest', () => {
  /** @type {InMemoryStore} */
  let store;

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(NOW_MS));
    store = new InMemoryStore();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('all sections empty → returns empty reply (caller can skip posting)', async () => {
    const reply = await composeDigest({ chatId: 'c1' }, makeCtx(store));
    expect(reply.replies).toEqual([]);
    expect(reply.stateUpdates).toEqual([]);
  });

  it('open items only → "Open right now" rendered; other sections elided', async () => {
    await store.addItem({
      type: 'shopping', text: 'bread',
      addedBy: 'x', source: SAMPLE_SOURCE,
    });
    await store.addItem({
      type: 'errand', text: 'post office',
      addedBy: 'x', source: SAMPLE_SOURCE,
    });

    const reply = await composeDigest({ chatId: 'c1' }, makeCtx(store));

    expect(reply.replies).toHaveLength(1);
    const text = reply.replies[0].text;

    expect(text).toContain('Open right now:');
    expect(text).toContain('bread');
    expect(text).toContain('post office');
    expect(text).not.toContain('Done in the last');
    expect(text).not.toContain('Open >7 days');

    expect(reply.replies[0].buttons).toBeUndefined(); // informational
    expect(reply.stateUpdates).toEqual([]);
  });

  it('items grouped by type in the rendered text (shopping before errand)', async () => {
    await store.addItem({
      type: 'errand', text: 'post office',
      addedBy: 'x', source: SAMPLE_SOURCE,
    });
    await store.addItem({
      type: 'shopping', text: 'bread',
      addedBy: 'x', source: SAMPLE_SOURCE,
    });
    await store.addItem({
      type: 'shopping', text: 'cocoa',
      addedBy: 'x', source: SAMPLE_SOURCE,
    });
    await store.addItem({
      type: 'repair', text: 'fix tap',
      addedBy: 'x', source: SAMPLE_SOURCE,
    });

    const reply = await composeDigest({ chatId: 'c1' }, makeCtx(store));
    const text = reply.replies[0].text;

    // Type headers appear in canonical order: shopping → errand → repair.
    const shoppingIdx = text.indexOf('shopping');
    const errandIdx   = text.indexOf('errand');
    const repairIdx   = text.indexOf('repair');
    expect(shoppingIdx).toBeGreaterThan(-1);
    expect(errandIdx).toBeGreaterThan(shoppingIdx);
    expect(repairIdx).toBeGreaterThan(errandIdx);

    // Both shopping items appear consecutively under the shopping label.
    const breadIdx = text.indexOf('bread');
    const cocoaIdx = text.indexOf('cocoa');
    expect(breadIdx).toBeGreaterThan(shoppingIdx);
    expect(cocoaIdx).toBeGreaterThan(breadIdx);
    expect(cocoaIdx).toBeLessThan(errandIdx);
  });

  it('stale items (>7 days old) appear in "Open >7 days" too', async () => {
    // Backdate one item to 8 days ago.
    vi.setSystemTime(new Date(NOW_MS - 8 * DAY_MS));
    await store.addItem({
      type: 'repair', text: 'fix bike',
      addedBy: 'x', source: SAMPLE_SOURCE,
    });
    // Restore "now" and add a fresh item.
    vi.setSystemTime(new Date(NOW_MS));
    await store.addItem({
      type: 'shopping', text: 'bread',
      addedBy: 'x', source: SAMPLE_SOURCE,
    });

    const reply = await composeDigest({ chatId: 'c1' }, makeCtx(store));
    const text = reply.replies[0].text;

    expect(text).toContain('Open right now:');
    expect(text).toContain('Open >7 days:');

    const staleHdr = text.indexOf('Open >7 days:');
    expect(staleHdr).toBeGreaterThan(-1);
    // "fix bike" appears in both the open-now and the stale section.
    const stalePart = text.slice(staleHdr);
    expect(stalePart).toContain('fix bike');
    // Date-stamp marker should be present in the stale section.
    expect(stalePart).toMatch(/added \d{4}-\d{2}-\d{2}/);
    // Fresh item does NOT appear in the stale section.
    expect(stalePart).not.toContain('bread');
  });

  it('windowMs defaults to 24h (header text reflects "24h")', async () => {
    // Build a store that exposes listAll, with one completed-12h-ago item.
    const fakeStore = makeStoreWithListAll([
      makeOpenItem('shopping', 'milk'),
      makeCompletedItem('shopping', 'garbage', NOW_MS - 12 * 60 * 60 * 1000),
    ]);

    const reply = await composeDigest({ chatId: 'c1' }, makeCtx(fakeStore));
    const text = reply.replies[0].text;

    expect(text).toContain('Done in the last 24h:');
    expect(text).toContain('garbage');
  });

  it('explicit windowMs (48h) is honoured in the section header', async () => {
    const fakeStore = makeStoreWithListAll([
      makeOpenItem('shopping', 'milk'),
      makeCompletedItem('shopping', 'vacuum', NOW_MS - 36 * 60 * 60 * 1000),
    ]);

    const reply = await composeDigest(
      { chatId: 'c1', windowMs: 2 * DAY_MS },
      makeCtx(fakeStore),
    );
    const text = reply.replies[0].text;

    expect(text).toContain('Done in the last 2d:');
    expect(text).toContain('vacuum');
  });

  it('header line uses today\'s date in YYYY-MM-DD HH:MM form', async () => {
    await store.addItem({
      type: 'shopping', text: 'bread',
      addedBy: 'x', source: SAMPLE_SOURCE,
    });

    const reply = await composeDigest({ chatId: 'c1' }, makeCtx(store));
    const firstLine = reply.replies[0].text.split('\n')[0];

    // Frozen "now" is 2026-04-30T20:00:00Z → header reads
    // "Daily digest — 2026-04-30 20:00".
    expect(firstLine).toBe('Daily digest — 2026-04-30 20:00');
  });

  it('Store interface gap: no listAll → "Done in last window" is silently elided', async () => {
    // Store with only open items, but no listAll method on the prototype.
    expect(typeof store.listAll).toBe('undefined');
    await store.addItem({
      type: 'shopping', text: 'bread',
      addedBy: 'x', source: SAMPLE_SOURCE,
    });

    const reply = await composeDigest({ chatId: 'c1' }, makeCtx(store));
    const text = reply.replies[0].text;

    expect(text).toContain('Open right now:');
    expect(text).not.toContain('Done in the last');
  });
});

// ───────── helpers ─────────

/**
 * Build a Store stub that exposes a `listAll` method on top of an
 * in-memory array of pre-built items.  Only `listOpen` and `listAll`
 * are needed for these tests.
 */
function makeStoreWithListAll(items) {
  return {
    async listOpen() {
      return items.filter((it) => it.completedAt == null).map((i) => ({ ...i }));
    },
    async listAll() {
      return items.map((i) => ({ ...i }));
    },
  };
}

// Rich task shape: an open item simply omits `completedAt` (and has no
// `assignee` until claimed); a done item carries a numeric `completedAt`.
function makeOpenItem(type, text) {
  return {
    id: `open-${text}`,
    type,
    text,
    addedBy: 'x',
    addedAt: NOW_MS - 60 * 60 * 1000,
    source: SAMPLE_SOURCE,
  };
}

function makeCompletedItem(type, text, completedAt) {
  return {
    id: `done-${text}`,
    type,
    text,
    addedBy: 'x',
    addedAt: completedAt - 60 * 60 * 1000,
    completedAt,
    source: SAMPLE_SOURCE,
  };
}
