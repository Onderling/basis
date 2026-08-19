/**
 * basis v2 — γ-next.policy receiver tests.
 *
 * Mirrors circleRulesReceiver.test.js shape.  Asserts envelope validation,
 * msgId dedup, and that the per-circle pending store gets the policy doc.
 */
import { describe, it, expect, vi } from 'vitest';
import { makeCirclePolicyPeerHandler } from '../../src/v2/circlePolicyReceiver.js';

function fakePendingStore() {
  const calls = [];
  const cache = new Map();
  return {
    calls,
    cache,
    set: (circleId, policy) => { calls.push({ circleId, policy }); cache.set(circleId, policy); },
    get: (circleId) => cache.get(circleId) ?? null,
    clear: (circleId) => { cache.delete(circleId); },
  };
}

function envelope(over = {}) {
  return {
    subtype:  'circle-policy-broadcast',
    circleId: 'g1',
    msgId:    'mp1',
    ts:       1735_000_000_000,
    policy: {
      features: { chat: true, houseRules: true, memberDirectory: true },
      view: 'screen', llmTool: 'off', agents: 'admin-approval',
      revealPolicy: 'pairwise', pod: 'none',
      admins: [], consensusRequired: false,
    },
    ...over,
  };
}

const silentLogger = { warn: () => {}, info: () => {}, debug: () => {} };

describe('makeCirclePolicyPeerHandler · γ-next.policy receiver', () => {
  it('throws when pendingStore is missing', () => {
    expect(() => makeCirclePolicyPeerHandler({})).toThrow(/pendingStore/);
  });

  it('writes the incoming policy doc to the per-circle pending cache', async () => {
    const pending = fakePendingStore();
    const handler = makeCirclePolicyPeerHandler({ pendingStore: pending, logger: silentLogger });
    await handler('nkn-addr-of-anne', envelope());
    expect(pending.calls).toHaveLength(1);
    expect(pending.calls[0].circleId).toBe('g1');
    expect(pending.calls[0].policy.view).toBe('screen');
    expect(pending.cache.get('g1').features.houseRules).toBe(true);
  });

  it('dedupes by msgId — second envelope with same msgId is a no-op', async () => {
    const pending = fakePendingStore();
    const handler = makeCirclePolicyPeerHandler({ pendingStore: pending, logger: silentLogger });
    await handler('a', envelope({ msgId: 'm-once', policy: { view: 'chat' } }));
    await handler('a', envelope({ msgId: 'm-once', policy: { view: 'screen' } }));
    expect(pending.calls).toHaveLength(1);
    expect(pending.cache.get('g1').view).toBe('chat');
  });

  it('shares dedup state when caller passes a shared Set', async () => {
    const pending = fakePendingStore();
    const dedup = new Set();
    const h1 = makeCirclePolicyPeerHandler({ pendingStore: pending, dedup, logger: silentLogger });
    const h2 = makeCirclePolicyPeerHandler({ pendingStore: pending, dedup, logger: silentLogger });
    await h1('a', envelope({ msgId: 'shared-1' }));
    await h2('a', envelope({ msgId: 'shared-1' }));
    expect(pending.calls).toHaveLength(1);
  });

  it('drops malformed envelopes silently (no set, warns)', async () => {
    const pending = fakePendingStore();
    const warn = vi.fn();
    const handler = makeCirclePolicyPeerHandler({
      pendingStore: pending, logger: { warn, info: () => {}, debug: () => {} },
    });
    await handler('a', null);
    await handler('a', { subtype: 'circle-policy-broadcast', circleId: '',  msgId: 'm', ts: 1, policy: {} });
    await handler('a', { subtype: 'circle-policy-broadcast', circleId: 'g', msgId: '',  ts: 1, policy: {} });
    await handler('a', { subtype: 'circle-policy-broadcast', circleId: 'g', msgId: 'm', ts: 'x', policy: {} });
    await handler('a', { subtype: 'circle-policy-broadcast', circleId: 'g', msgId: 'm', ts: 1, policy: null });
    await handler('a', { subtype: 'circle-chat-message',     circleId: 'g', msgId: 'm', ts: 1, policy: {} });
    expect(pending.calls).toHaveLength(0);
    expect(warn).toHaveBeenCalledTimes(6);
  });

  it('LRU dedup evicts oldest msgId once cap is exceeded', async () => {
    const pending = fakePendingStore();
    const handler = makeCirclePolicyPeerHandler({
      pendingStore: pending, dedupCap: 2, logger: silentLogger,
    });
    await handler('a', envelope({ msgId: 'A' }));
    await handler('a', envelope({ msgId: 'B' }));
    await handler('a', envelope({ msgId: 'C' }));   // evicts A
    await handler('a', envelope({ msgId: 'A', policy: { view: 'cross-stream' } }));
    expect(pending.calls.map((c) => c.policy.view))
      .toEqual(['screen', 'screen', 'screen', 'cross-stream']);
  });

  it('last-write-wins when distinct broadcasts arrive for the same circle', async () => {
    const pending = fakePendingStore();
    const handler = makeCirclePolicyPeerHandler({ pendingStore: pending, logger: silentLogger });
    await handler('a', envelope({ msgId: 'm1', policy: { view: 'chat' } }));
    await handler('a', envelope({ msgId: 'm2', policy: { view: 'cross-stream' } }));
    expect(pending.calls).toHaveLength(2);
    expect(pending.cache.get('g1').view).toBe('cross-stream');
  });

  it('does not throw when pendingStore.set rejects (logs warn)', async () => {
    const warn = vi.fn();
    const pending = {
      set: () => Promise.reject(new Error('disk full')),
    };
    const handler = makeCirclePolicyPeerHandler({
      pendingStore: pending, logger: { warn, info: () => {}, debug: () => {} },
    });
    await expect(handler('a', envelope())).resolves.toBeUndefined();
    expect(warn).toHaveBeenCalledWith(
      '[circle-policy] pendingStore.set failed', 'disk full',
    );
  });

  it('passes nested policy shape (features + push) through opaquely', async () => {
    // Policy carries nested sub-objects (features.{chat,…}); the receiver
    // doesn't introspect them — it just stashes the doc.  The resolver
    // downstream is what understands the per-field merge.
    const pending = fakePendingStore();
    const handler = makeCirclePolicyPeerHandler({ pendingStore: pending, logger: silentLogger });
    const nested = {
      features: { chat: true, noticeboard: false, tasks: true, lists: true,
        calendar: false, notes: false, houseRules: true, memberDirectory: true },
      view: 'screen', llmTool: 'local', agents: 'no',
      revealPolicy: 'open', pod: 'shared',
      catchUpChooserMode: 'prompt',
      admins: ['anne', 'bob'], consensusRequired: true,
    };
    await handler('a', envelope({ msgId: 'nested-1', policy: nested }));
    const stashed = pending.cache.get('g1');
    expect(stashed).toEqual(nested);
    expect(stashed.features.tasks).toBe(true);
    expect(stashed.admins).toEqual(['anne', 'bob']);
  });
});
