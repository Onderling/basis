import { describe, it, expect, beforeEach } from 'vitest';
import { InMemoryStore, ulid } from '../../src/storage/InMemoryStore.js';

const SAMPLE_SOURCE = { tg: { chatId: 'chat-1', messageId: 'msg-1' } };

describe('InMemoryStore', () => {
  /** @type {InMemoryStore} */
  let store;

  beforeEach(() => {
    store = new InMemoryStore();
  });

  describe('addItem', () => {
    it('returns a populated Item with id and addedAt', async () => {
      const before = Date.now();
      const item = await store.addItem({
        type: 'shopping',
        text: 'bread',
        addedBy: 'webid:alice',
        source: SAMPLE_SOURCE,
      });
      const after = Date.now();

      expect(item.id).toBeTruthy();
      expect(typeof item.id).toBe('string');
      expect(item.addedAt).toBeGreaterThanOrEqual(before);
      expect(item.addedAt).toBeLessThanOrEqual(after);
      expect(item.type).toBe('shopping');
      expect(item.text).toBe('bread');
      expect(item.addedBy).toBe('webid:alice');
      // Rich task shape: open = `completedAt` absent, unclaimed = `assignee` absent.
      expect(item.completedAt).toBeUndefined();
      expect(item.assignee).toBeUndefined();
      expect(item.source).toEqual(SAMPLE_SOURCE);
    });

    it('generates unique ids for two items added in quick succession', async () => {
      const a = await store.addItem({
        type: 'shopping', text: 'a',
        addedBy: 'webid:x', source: SAMPLE_SOURCE,
      });
      const b = await store.addItem({
        type: 'shopping', text: 'b',
        addedBy: 'webid:x', source: SAMPLE_SOURCE,
      });
      expect(a.id).not.toBe(b.id);
    });

    it('preserves dueAt when supplied', async () => {
      const item = await store.addItem({
        type: 'schedule', text: 'dentist',
        addedBy: 'webid:x', source: SAMPLE_SOURCE,
        dueAt: 1234567890,
      });
      expect(item.dueAt).toBe(1234567890);
    });

    it('omits dueAt when not supplied', async () => {
      const item = await store.addItem({
        type: 'shopping', text: 'milk',
        addedBy: 'webid:x', source: SAMPLE_SOURCE,
      });
      expect('dueAt' in item).toBe(false);
    });
  });

  describe('listOpen', () => {
    it('returns an empty array when no items are present', async () => {
      const out = await store.listOpen();
      expect(out).toEqual([]);
    });

    it('filters by type', async () => {
      await store.addItem({ type: 'shopping', text: 'bread',  addedBy: 'x', source: SAMPLE_SOURCE });
      await store.addItem({ type: 'errand',   text: 'post',   addedBy: 'x', source: SAMPLE_SOURCE });
      await store.addItem({ type: 'shopping', text: 'milk',   addedBy: 'x', source: SAMPLE_SOURCE });

      const shopping = await store.listOpen({ type: 'shopping' });
      expect(shopping).toHaveLength(2);
      expect(shopping.every((i) => i.type === 'shopping')).toBe(true);

      const errands = await store.listOpen({ type: 'errand' });
      expect(errands).toHaveLength(1);
    });

    it('filters by since (added-at-or-after)', async () => {
      const a = await store.addItem({ type: 'shopping', text: 'a', addedBy: 'x', source: SAMPLE_SOURCE });
      // small delay-free way to bump addedAt: addItem twice and use the second's timestamp
      await new Promise((r) => setTimeout(r, 2));
      const b = await store.addItem({ type: 'shopping', text: 'b', addedBy: 'x', source: SAMPLE_SOURCE });

      const recent = await store.listOpen({ since: b.addedAt });
      expect(recent.map((i) => i.text)).toContain('b');
      // a may or may not be included depending on timer resolution, but b must be.
      expect(recent.length).toBeGreaterThanOrEqual(1);
      expect(a.addedAt).toBeLessThanOrEqual(b.addedAt);
    });

    it('excludes completed items', async () => {
      const a = await store.addItem({ type: 'shopping', text: 'a', addedBy: 'x', source: SAMPLE_SOURCE });
      await store.addItem({ type: 'shopping', text: 'b', addedBy: 'x', source: SAMPLE_SOURCE });
      await store.markComplete(a.id);

      const open = await store.listOpen();
      expect(open).toHaveLength(1);
      expect(open[0].text).toBe('b');
    });

    it('returns defensive copies — mutating result does not change the store', async () => {
      await store.addItem({ type: 'shopping', text: 'bread', addedBy: 'x', source: SAMPLE_SOURCE });
      const open1 = await store.listOpen();
      open1[0].text = 'MUTATED';
      const open2 = await store.listOpen();
      expect(open2[0].text).toBe('bread');
    });
  });

  describe('markComplete', () => {
    it('sets completedAt and returns the updated item', async () => {
      const before = Date.now();
      const item = await store.addItem({
        type: 'shopping', text: 'bread',
        addedBy: 'x', source: SAMPLE_SOURCE,
      });
      const updated = await store.markComplete(item.id);
      const after = Date.now();

      expect(updated.id).toBe(item.id);
      expect(updated.completedAt).not.toBeNull();
      expect(updated.completedAt).toBeGreaterThanOrEqual(before);
      expect(updated.completedAt).toBeLessThanOrEqual(after);
    });

    it('throws when the id is unknown', async () => {
      await expect(store.markComplete('does-not-exist')).rejects.toThrow();
    });
  });

  describe('remove', () => {
    it('hard-deletes — subsequent getById returns null', async () => {
      const item = await store.addItem({
        type: 'shopping', text: 'bread',
        addedBy: 'x', source: SAMPLE_SOURCE,
      });
      await store.remove(item.id);
      const got = await store.getById(item.id);
      expect(got).toBeNull();
    });

    it('does not throw when removing an unknown id (idempotent)', async () => {
      await expect(store.remove('does-not-exist')).resolves.toBeUndefined();
    });
  });

  describe('getById', () => {
    it('returns null for an unknown id', async () => {
      expect(await store.getById('nope')).toBeNull();
    });

    it('returns a copy — caller mutations do not bleed into the store', async () => {
      const added = await store.addItem({
        type: 'shopping', text: 'bread',
        addedBy: 'x', source: SAMPLE_SOURCE,
      });
      const a = await store.getById(added.id);
      a.text = 'MUTATED';
      const b = await store.getById(added.id);
      expect(b.text).toBe('bread');
    });
  });

  describe('ulid', () => {
    it('produces a 26-char string', () => {
      expect(ulid()).toHaveLength(26);
    });

    it('produces ascending ids over time (lexicographic)', async () => {
      const a = ulid();
      await new Promise((r) => setTimeout(r, 2));
      const b = ulid();
      expect(a < b || a === b).toBe(true);
      // strict inequality is the typical case when timestamps differ:
      // we don't assert it because two ulids in the same ms can flip
      // due to randomness.
    });

    it('produces distinct ids in tight loops', () => {
      const seen = new Set();
      for (let i = 0; i < 100; i++) seen.add(ulid());
      expect(seen.size).toBe(100);
    });
  });
});
