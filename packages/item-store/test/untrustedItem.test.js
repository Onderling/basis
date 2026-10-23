/**
 * An item read from the store's source is someone else's JSON once a circle syncs it in: one carrying a prototype key
 * reads as absent (the store parses with `parseUntrustedJson`), so no merge downstream can take its prototype.
 */
import { describe, it, expect } from 'vitest';
import { MemorySource } from '@onderling/core';
import { ItemStore } from '../src/ItemStore.js';

describe('an item carrying a prototype key', () => {
  it('reads as absent; an honest item beside it reads', async () => {
    const source = new MemorySource();
    const store = new ItemStore({ dataSource: source, rootContainer: 'mem://untrusted/' });
    const [ok] = await store.addItems([{ type: 'note', text: 'gewoon' }], { actor: 'webid:alice' });
    await source.write('mem://untrusted/items/evil.json', '{"id":"evil","type":"note","text":"x","__proto__":{"isAdmin":true}}');
    expect(await store.getById(ok.id)).toMatchObject({ text: 'gewoon' });
    expect(await store.getById('evil')).toBeNull();
  });
});
