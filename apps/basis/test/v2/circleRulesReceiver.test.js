/**
 * basis v2 — γ-next.rules receiver tests.
 *
 * Mirrors circleRecipeReceiver.test.js shape.  Asserts envelope validation,
 * msgId dedup, and that the per-circle pending store gets the rules doc.
 */
import { describe, it, expect, vi } from 'vitest';
import { makeCircleRulesPeerHandler } from '../../src/v2/circleRulesReceiver.js';

function fakePendingStore() {
  const calls = [];
  const cache = new Map();
  return {
    calls,
    cache,
    set: (circleId, rulesDoc) => { calls.push({ circleId, rulesDoc }); cache.set(circleId, rulesDoc); },
    get: (circleId) => cache.get(circleId) ?? null,
    clear: (circleId) => { cache.delete(circleId); },
  };
}

function envelope(over = {}) {
  return {
    subtype:  'circle-rules-broadcast',
    circleId: 'g1',
    msgId:    'mr1',
    ts:       1735_000_000_000,
    rulesDoc: { purpose: 'Neighbourhood', agreements: 'be kind' },
    ...over,
  };
}

const silentLogger = { warn: () => {}, info: () => {}, debug: () => {} };

describe('makeCircleRulesPeerHandler · γ-next.rules receiver', () => {
  it('throws when pendingStore is missing', () => {
    expect(() => makeCircleRulesPeerHandler({})).toThrow(/pendingStore/);
  });

  it('writes the incoming rules doc to the per-circle pending cache', async () => {
    const pending = fakePendingStore();
    const handler = makeCircleRulesPeerHandler({ pendingStore: pending, logger: silentLogger });
    await handler('nkn-addr-of-anne', envelope());
    expect(pending.calls).toHaveLength(1);
    expect(pending.calls[0].circleId).toBe('g1');
    expect(pending.calls[0].rulesDoc.purpose).toBe('Neighbourhood');
    expect(pending.cache.get('g1').agreements).toBe('be kind');
  });

  it('dedupes by msgId — second envelope with same msgId is a no-op', async () => {
    const pending = fakePendingStore();
    const handler = makeCircleRulesPeerHandler({ pendingStore: pending, logger: silentLogger });
    await handler('a', envelope({ msgId: 'm-once', rulesDoc: { purpose: 'first' } }));
    await handler('a', envelope({ msgId: 'm-once', rulesDoc: { purpose: 'second' } }));
    expect(pending.calls).toHaveLength(1);
    expect(pending.cache.get('g1').purpose).toBe('first');
  });

  it('shares dedup state when caller passes a shared Set', async () => {
    const pending = fakePendingStore();
    const dedup = new Set();
    const h1 = makeCircleRulesPeerHandler({ pendingStore: pending, dedup, logger: silentLogger });
    const h2 = makeCircleRulesPeerHandler({ pendingStore: pending, dedup, logger: silentLogger });
    await h1('a', envelope({ msgId: 'shared-1' }));
    await h2('a', envelope({ msgId: 'shared-1' }));
    expect(pending.calls).toHaveLength(1);
  });

  it('drops malformed envelopes silently (no set, warns)', async () => {
    const pending = fakePendingStore();
    const warn = vi.fn();
    const handler = makeCircleRulesPeerHandler({
      pendingStore: pending, logger: { warn, info: () => {}, debug: () => {} },
    });
    await handler('a', null);
    await handler('a', { subtype: 'circle-rules-broadcast', circleId: '', msgId: 'm', ts: 1, rulesDoc: {} });
    await handler('a', { subtype: 'circle-rules-broadcast', circleId: 'g', msgId: '',  ts: 1, rulesDoc: {} });
    await handler('a', { subtype: 'circle-rules-broadcast', circleId: 'g', msgId: 'm', ts: 'x', rulesDoc: {} });
    await handler('a', { subtype: 'circle-rules-broadcast', circleId: 'g', msgId: 'm', ts: 1, rulesDoc: null });
    await handler('a', { subtype: 'circle-chat-message',    circleId: 'g', msgId: 'm', ts: 1, rulesDoc: {} });
    expect(pending.calls).toHaveLength(0);
    expect(warn).toHaveBeenCalledTimes(6);
  });

  it('LRU dedup evicts oldest msgId once cap is exceeded', async () => {
    const pending = fakePendingStore();
    const handler = makeCircleRulesPeerHandler({
      pendingStore: pending, dedupCap: 2, logger: silentLogger,
    });
    await handler('a', envelope({ msgId: 'A' }));
    await handler('a', envelope({ msgId: 'B' }));
    await handler('a', envelope({ msgId: 'C' }));   // evicts A
    await handler('a', envelope({ msgId: 'A', rulesDoc: { purpose: 'replayed' } }));
    expect(pending.calls.map((c) => c.rulesDoc.purpose))
      .toEqual(['Neighbourhood', 'Neighbourhood', 'Neighbourhood', 'replayed']);
  });

  it('last-write-wins when distinct broadcasts arrive for the same circle', async () => {
    const pending = fakePendingStore();
    const handler = makeCircleRulesPeerHandler({ pendingStore: pending, logger: silentLogger });
    await handler('a', envelope({ msgId: 'm1', rulesDoc: { purpose: 'first' } }));
    await handler('a', envelope({ msgId: 'm2', rulesDoc: { purpose: 'second' } }));
    expect(pending.calls).toHaveLength(2);
    expect(pending.cache.get('g1').purpose).toBe('second');
  });

  it('does not throw when pendingStore.set rejects (logs warn)', async () => {
    const warn = vi.fn();
    const pending = {
      set: () => Promise.reject(new Error('disk full')),
    };
    const handler = makeCircleRulesPeerHandler({
      pendingStore: pending, logger: { warn, info: () => {}, debug: () => {} },
    });
    await expect(handler('a', envelope())).resolves.toBeUndefined();
    expect(warn).toHaveBeenCalledWith(
      '[circle-rules] pendingStore.set failed', 'disk full',
    );
  });
});
