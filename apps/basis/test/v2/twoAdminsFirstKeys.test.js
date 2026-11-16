/**
 * TWO ADMINS WHO EACH OPEN A FRESH CIRCLE AT ONCE MINT TWO FIRST KEYS. Both may establish the circle's first key, so
 * each device's producer bootstraps its own version 1. The collapse rule (`collapseKeyEvents`) keeps two DIFFERENT keys
 * at one version (up to `MAX_KEYS_PER_VERSION`), because a reader trials the chain: discarding one would lose what was
 * sealed under it. Pinned here with the strategies the shells build: an admin's (its key resource, read through the key
 * log's fold) and a member's (the key log only, `strategyFromKeyLog`). Each of the three devices opens what either admin
 * sealed, once both key events reached it.
 */
import { describe, it, expect, vi } from 'vitest';
import { createControlAgent, generateKeypair, resolveCircleStorage, collapseKeyEvents, MAX_KEYS_PER_VERSION } from '@onderling/pod-client';
import { strategyFromKeyLog, wrapStrategyWithKeyEventFold } from '../../src/v2/keyEventStore.js';

const G = 'two-admins';

function admin(controllerKey, roster) {
  let stored = null;
  const emitted = [];
  const keyStore = { read: async () => stored, write: async (r) => { stored = r; } };
  const ca = createControlAgent({
    sharing: { grant: vi.fn(async () => {}), revoke: vi.fn(async () => {}) },
    containerUri: `https://pod/${G}/`, keyStore, controllerKey, roster, groupId: G,
    keyEventLog: { append: async (e) => { emitted.push(e); } },
  });
  return { ca, emitted, resource: () => stored };
}

describe('two admins open a fresh circle at once', () => {
  it('two first keys are both kept, and every device opens what either admin sealed', async () => {
    const A = generateKeypair(); const B = generateKeypair(); const M = generateKeypair();
    const roster = [A, B, M].map((k, i) => ({ webId: ['a', 'b', 'm'][i], publicKey: k.publicKey, role: i < 2 ? 'admin' : 'member' }));
    const a = admin(A, roster); const b = admin(B, roster);
    await Promise.all([a.ca.bootstrap(), b.ca.bootstrap()]);
    const events = [...a.emitted, ...b.emitted];
    expect(events.map((e) => e.version)).toEqual([1, 1]);
    // the collapse keeps both: two different keys at one version
    expect(collapseKeyEvents(events).length).toBe(2);
    expect(MAX_KEYS_PER_VERSION).toBeGreaterThanOrEqual(2);

    // the strategies the shells build, each device holding both key events in its log
    const adminStrat = (own, k) => wrapStrategyWithKeyEventFold(resolveCircleStorage({ posture: 'p2', resource: own.resource(), privateKey: k.privateKey }), { listEvents: () => events, groupId: G, privateKey: k.privateKey });
    const sA = adminStrat(a, A);
    const sB = adminStrat(b, B);
    const sM = wrapStrategyWithKeyEventFold(strategyFromKeyLog({ events, groupId: G, posture: 'p2', privateKey: M.privateKey }), { listEvents: () => events, groupId: G, privateKey: M.privateKey });

    const byA = await sA.seal('van admin a');
    const byB = await sB.seal('van admin b');
    const byM = await sM.seal('van het lid');
    const opens = async (s, x) => { try { return await s.open(x); } catch { return null; } };
    for (const [who, s] of [['A', sA], ['B', sB], ['M', sM]]) {
      expect(await opens(s, byA), `${who} opens what admin A sealed`).toBe('van admin a');
      expect(await opens(s, byB), `${who} opens what admin B sealed`).toBe('van admin b');
      expect(await opens(s, byM), `${who} opens what the member sealed`).toBe('van het lid');
    }
  });
});
