/**
 * InMemoryStore sync hook — OBJ-2 S1d publish-on-write. Every LOCAL mutation
 * (the path household skills use) fans the RAW item out via the registered hook;
 * a null hook is a no-op; already-claimed does not fan out.
 */
import { describe, it, expect, vi } from 'vitest';
import { InMemoryStore } from '../src/storage/InMemoryStore.js';

function withHook() {
  const store = new InMemoryStore();
  const publishItem = vi.fn();
  const publishItemRemoved = vi.fn();
  store.setSyncHook({ publishItem, publishItemRemoved });
  return { store, publishItem, publishItemRemoved };
}

describe('InMemoryStore sync hook (OBJ-2 S1d)', () => {
  it('addItem fans out the RAW item (not legacy-shaped)', async () => {
    const { store, publishItem } = withHook();
    const item = await store.addItem({ type: 'task', text: 'Milk', addedBy: 'A' });
    expect(publishItem).toHaveBeenCalledTimes(1);
    const raw = publishItem.mock.calls[0][0];
    expect(raw.id).toBe(item.id);
    expect(raw.text).toBe('Milk');
    // The fan-out carries the RAW substrate item, which is the rich task shape:
    // the owner is `assignee` (never a `claimedBy` alias) and `completedAt` is
    // absent while open. Their shape here matches what the store's own methods
    // return — there is one task shape, so nothing is translated on the way out.
    expect('claimedBy' in raw).toBe(false);   // no legacy `claimedBy` alias — the field is `assignee`
    expect(raw.completedAt).toBeUndefined();  // open ⇒ completedAt absent
  });

  it('markComplete fans out', async () => {
    const { store, publishItem } = withHook();
    const item = await store.addItem({ type: 'task', text: 'Milk', addedBy: 'A' });
    publishItem.mockClear();
    await store.markComplete(item.id);
    expect(publishItem).toHaveBeenCalledTimes(1);
    expect(publishItem.mock.calls[0][0].id).toBe(item.id);
    expect(publishItem.mock.calls[0][0].completedAt).toBeTruthy();
  });

  it('remove fans out a hard-delete signal', async () => {
    const { store, publishItemRemoved } = withHook();
    const item = await store.addItem({ type: 'task', text: 'Milk', addedBy: 'A' });
    await store.remove(item.id);
    expect(publishItemRemoved).toHaveBeenCalledWith(item.id);
  });

  it('claim fans out; a second already-claimed attempt does NOT', async () => {
    const { store, publishItem } = withHook();
    const item = await store.addItem({ type: 'task', text: 'Milk', addedBy: 'A' });
    publishItem.mockClear();
    await store.claim(item.id, 'webid:alice');
    expect(publishItem).toHaveBeenCalledTimes(1);
    publishItem.mockClear();
    const second = await store.claim(item.id, 'webid:bob');
    expect(second.error).toBe('already-claimed');
    expect(publishItem).not.toHaveBeenCalled();
  });

  it('reassign fans out', async () => {
    const { store, publishItem } = withHook();
    const item = await store.addItem({ type: 'task', text: 'Milk', addedBy: 'A' });
    await store.claim(item.id, 'webid:alice');
    publishItem.mockClear();
    await store.reassign(item.id, 'webid:bob');
    expect(publishItem).toHaveBeenCalledTimes(1);
  });

  it('no hook (default) → mutations still work, no throw', async () => {
    const store = new InMemoryStore();
    const item = await store.addItem({ type: 'task', text: 'Milk', addedBy: 'A' });
    await store.markComplete(item.id);
    await store.remove(item.id);
    expect(item.text).toBe('Milk');
  });
});
