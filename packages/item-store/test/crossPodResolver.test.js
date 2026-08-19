/**
 * createCrossPodRefResolver — Phase 3.3c. The decentralised-circle
 * cross-pod read path: dispatch the 3 canonical embeds ref shapes,
 * permission-safe, and compose with the real `treeOf` walker.
 */

import { describe, it, expect, vi } from 'vitest';
import { treeOf, createCrossPodRefResolver } from '../src/embeds.js';

const res = (ok, status, body) => ({ ok, status, text: async () => body });

describe('createCrossPodRefResolver — per-scheme dispatch', () => {
  it('urn:dec:item → local getItem', async () => {
    const getItem = vi.fn(async (id) => (id === 'L1' ? { id: 'L1', type: 'item' } : null));
    const r = createCrossPodRefResolver({ getItem });
    expect(await r('urn:dec:item:L1')).toEqual({ item: { id: 'L1', type: 'item' } });
    expect(await r('urn:dec:item:NOPE')).toBeNull();
  });

  it('pseudo-pod:// → pseudoPodRead (string + bytes)', async () => {
    const r1 = createCrossPodRefResolver({
      pseudoPodRead: async () => ({ bytes: '{"id":"P1","type":"task"}' }),
    });
    expect(await r1('pseudo-pod://devA/x')).toEqual({ item: { id: 'P1', type: 'task' } });

    const r2 = createCrossPodRefResolver({
      pseudoPodRead: async () => ({ bytes: new TextEncoder().encode('{"id":"P2"}') }),
    });
    expect(await r2('pseudo-pod://devA/y')).toEqual({ item: { id: 'P2' } });

    const r3 = createCrossPodRefResolver({ pseudoPodRead: async () => null });
    expect(await r3('pseudo-pod://devA/z')).toBeNull();
  });

  it('https:// ok → parsed item', async () => {
    const podFetch = vi.fn(async () => res(true, 200, '{"id":"H1","type":"item"}'));
    const r = createCrossPodRefResolver({ podFetch });
    expect(await r('https://b.pod/items/H1.json')).toEqual({ item: { id: 'H1', type: 'item' } });
  });

  it('https:// 401/403 → throws PERMISSION_DENIED', async () => {
    const r = createCrossPodRefResolver({ podFetch: async () => res(false, 403) });
    await expect(r('https://b.pod/x')).rejects.toMatchObject({ code: 'PERMISSION_DENIED', status: 403 });
  });

  it('https:// 404 → null; non-JSON → PARSE_ERROR; 500 → RESOLVE_FAILED', async () => {
    expect(await createCrossPodRefResolver({ podFetch: async () => res(false, 404) })('https://b.pod/x'))
      .toBeNull();
    await expect(createCrossPodRefResolver({ podFetch: async () => res(true, 200, '<html>') })('https://b.pod/x'))
      .rejects.toMatchObject({ code: 'PARSE_ERROR' });
    await expect(createCrossPodRefResolver({ podFetch: async () => res(false, 500) })('https://b.pod/x'))
      .rejects.toMatchObject({ code: 'RESOLVE_FAILED', status: 500 });
  });

  it('unknown scheme / empty / missing injected fn → null', async () => {
    const r = createCrossPodRefResolver({});
    expect(await r('ftp://x')).toBeNull();
    expect(await r('')).toBeNull();
    expect(await r('urn:dec:item:L1')).toBeNull();        // no getItem
    expect(await r('https://b.pod/x')).toBeNull();         // no podFetch
  });
});

describe('treeOf + createCrossPodRefResolver — decentralised cross-pod read', () => {
  // Local root item embeds a ref into ANOTHER member's pod.
  const local = {
    R: { id: 'R', type: 'item', embeds: [{ type: 'item', ref: 'https://bob.pod/circle/items/X.json' }] },
  };
  const getItem = async (id) => local[id] ?? null;

  it('materialises the cross-pod ref as an external node', async () => {
    const resolveExternalRef = createCrossPodRefResolver({
      podFetch: async () => res(true, 200, '{"id":"X","type":"item","text":"bob’s offer"}'),
    });
    const tree = await treeOf({ rootId: 'R', getItem, resolveExternalRef });
    expect(tree.embeds).toHaveLength(1);
    expect(tree.embeds[0].source).toBe('external');
    expect(tree.embeds[0].item).toEqual({ id: 'X', type: 'item', text: 'bob’s offer' });
  });

  it('permission failure → placeholder reason PERMISSION_DENIED (3-tier render)', async () => {
    const resolveExternalRef = createCrossPodRefResolver({
      podFetch: async () => res(false, 403),
    });
    const tree = await treeOf({ rootId: 'R', getItem, resolveExternalRef });
    expect(tree.embeds[0].source).toBe('placeholder');
    expect(tree.embeds[0].reason).toBe('PERMISSION_DENIED');
    expect(tree.embeds[0].ref).toBe('https://bob.pod/circle/items/X.json');
  });
});
