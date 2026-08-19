/**
 * basis v2 — γ-next.recipe receiver tests.
 *
 * Mirrors circleChatReceiver.test.js shape.  Asserts envelope validation,
 * msgId dedup, and that the per-circle pending store gets the recipe.
 */
import { describe, it, expect, vi } from 'vitest';
import { makeCircleRecipePeerHandler } from '../../src/v2/circleRecipeReceiver.js';

function fakePendingStore() {
  const calls = [];
  const cache = new Map();
  return {
    calls,
    cache,
    set: (circleId, recipe) => { calls.push({ circleId, recipe }); cache.set(circleId, recipe); },
    get: (circleId) => cache.get(circleId) ?? null,
    clear: (circleId) => { cache.delete(circleId); },
  };
}

function envelope(over = {}) {
  return {
    subtype:  'circle-recipe-broadcast',
    circleId: 'g1',
    msgId:    'mr1',
    ts:       1735_000_000_000,
    recipe:   { id: 'r1', name: 'Circle', blocks: [] },
    ...over,
  };
}

const silentLogger = { warn: () => {}, info: () => {}, debug: () => {} };

describe('makeCircleRecipePeerHandler · γ-next.recipe receiver', () => {
  it('throws when pendingStore is missing', () => {
    expect(() => makeCircleRecipePeerHandler({})).toThrow(/pendingStore/);
  });

  it('writes the incoming recipe to the per-circle pending cache', async () => {
    const pending = fakePendingStore();
    const handler = makeCircleRecipePeerHandler({ pendingStore: pending, logger: silentLogger });
    await handler('nkn-addr-of-anne', envelope());
    expect(pending.calls).toHaveLength(1);
    expect(pending.calls[0].circleId).toBe('g1');
    expect(pending.calls[0].recipe.id).toBe('r1');
    expect(pending.cache.get('g1').name).toBe('Circle');
  });

  it('dedupes by msgId — second envelope with same msgId is a no-op', async () => {
    const pending = fakePendingStore();
    const handler = makeCircleRecipePeerHandler({ pendingStore: pending, logger: silentLogger });
    await handler('a', envelope({ msgId: 'm-once', recipe: { id: 'r1', name: 'first', blocks: [] } }));
    await handler('a', envelope({ msgId: 'm-once', recipe: { id: 'r1', name: 'second', blocks: [] } }));
    expect(pending.calls).toHaveLength(1);
    expect(pending.cache.get('g1').name).toBe('first');
  });

  it('shares dedup state when caller passes a shared Set', async () => {
    const pending = fakePendingStore();
    const dedup = new Set();
    const h1 = makeCircleRecipePeerHandler({ pendingStore: pending, dedup, logger: silentLogger });
    const h2 = makeCircleRecipePeerHandler({ pendingStore: pending, dedup, logger: silentLogger });
    await h1('a', envelope({ msgId: 'shared-1' }));
    await h2('a', envelope({ msgId: 'shared-1' }));
    expect(pending.calls).toHaveLength(1);
  });

  it('drops malformed envelopes silently (no set, warns)', async () => {
    const pending = fakePendingStore();
    const warn = vi.fn();
    const handler = makeCircleRecipePeerHandler({
      pendingStore: pending, logger: { warn, info: () => {}, debug: () => {} },
    });
    await handler('a', null);
    await handler('a', { subtype: 'circle-recipe-broadcast', circleId: '', msgId: 'm', ts: 1, recipe: {} });
    await handler('a', { subtype: 'circle-recipe-broadcast', circleId: 'g', msgId: '',  ts: 1, recipe: {} });
    await handler('a', { subtype: 'circle-recipe-broadcast', circleId: 'g', msgId: 'm', ts: 'x', recipe: {} });
    await handler('a', { subtype: 'circle-recipe-broadcast', circleId: 'g', msgId: 'm', ts: 1, recipe: null });
    await handler('a', { subtype: 'circle-chat-message',     circleId: 'g', msgId: 'm', ts: 1, recipe: {} });
    expect(pending.calls).toHaveLength(0);
    expect(warn).toHaveBeenCalledTimes(6);
  });

  it('LRU dedup evicts oldest msgId once cap is exceeded', async () => {
    const pending = fakePendingStore();
    const handler = makeCircleRecipePeerHandler({
      pendingStore: pending, dedupCap: 2, logger: silentLogger,
    });
    await handler('a', envelope({ msgId: 'A' }));
    await handler('a', envelope({ msgId: 'B' }));
    await handler('a', envelope({ msgId: 'C' }));   // evicts A
    await handler('a', envelope({ msgId: 'A', recipe: { id: 'r1', name: 'replayed', blocks: [] } }));
    expect(pending.calls.map((c) => c.recipe.name))
      .toEqual(['Circle', 'Circle', 'Circle', 'replayed']);
  });

  it('last-write-wins when distinct broadcasts arrive for the same circle', async () => {
    const pending = fakePendingStore();
    const handler = makeCircleRecipePeerHandler({ pendingStore: pending, logger: silentLogger });
    await handler('a', envelope({ msgId: 'm1', recipe: { id: 'r1', name: 'first', blocks: [] } }));
    await handler('a', envelope({ msgId: 'm2', recipe: { id: 'r1', name: 'second', blocks: [] } }));
    expect(pending.calls).toHaveLength(2);
    expect(pending.cache.get('g1').name).toBe('second');
  });

  it('does not throw when pendingStore.set rejects (logs warn)', async () => {
    const warn = vi.fn();
    const pending = {
      set: () => Promise.reject(new Error('disk full')),
    };
    const handler = makeCircleRecipePeerHandler({
      pendingStore: pending, logger: { warn, info: () => {}, debug: () => {} },
    });
    await expect(handler('a', envelope())).resolves.toBeUndefined();
    expect(warn).toHaveBeenCalledWith(
      '[circle-recipe] pendingStore.set failed', 'disk full',
    );
  });
});
