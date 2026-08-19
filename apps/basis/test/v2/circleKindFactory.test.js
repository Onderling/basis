/**
 * basis v2 — anti-drift guard for the circle policy/rules/recipe triplet.
 *
 * The three circle broadcast "kinds" collapsed into ONE parameterised
 * factory family (`circleKindFactory.js`); the per-kind modules are thin
 * instantiations.  This guard fails if any kind silently re-diverges from
 * the shared substrate — the CLAUDE.md "leave a check so the drift can't
 * recur" rule (invariant #3).
 *
 * It asserts BY CONSTRUCTION that:
 *   - all three receivers are the factory's output (same behaviour modulo
 *     the {subtype, payloadKey, logTag} descriptor);
 *   - all three pending stores + storage caches are the one factory shape,
 *     each with its own on-disk key prefix (which must NOT change);
 *   - policy + rules conflict share the flat-doc factory (recipe does not —
 *     it stays its own per-block module, and we assert that difference).
 */

import { describe, it, expect, vi } from 'vitest';

import { makeCirclePolicyPeerHandler } from '../../src/v2/circlePolicyReceiver.js';
import { makeCircleRulesPeerHandler }  from '../../src/v2/circleRulesReceiver.js';
import { makeCircleRecipePeerHandler } from '../../src/v2/circleRecipeReceiver.js';

import { createCirclePolicyPendingStore } from '../../src/v2/circlePolicyPending.js';
import { createCircleRulesPendingStore }  from '../../src/v2/circleRulesPending.js';
import { createCircleRecipePendingStore } from '../../src/v2/circleRecipePending.js';

import {
  localStorageCirclePolicyPendingIo,
  createCirclePolicyPendingStoreLocal,
} from '../../src/v2/circlePolicyPendingStorage.js';
import {
  localStorageCircleRulesPendingIo,
  createCircleRulesPendingStoreLocal,
} from '../../src/v2/circleRulesPendingStorage.js';
import {
  localStorageCircleRecipePendingIo,
  createCircleRecipePendingStoreLocal,
} from '../../src/v2/circleRecipePendingStorage.js';

import { detectPolicyConflicts, applyPolicyResolution } from '../../src/v2/policyConflict.js';
import { detectRulesConflicts,  applyRulesResolution }  from '../../src/v2/rulesConflict.js';
import { detectRecipeConflicts } from '../../src/v2/recipeConflict.js';

const silentLogger = { warn: () => {}, info: () => {}, debug: () => {} };

/** One row per kind: the factory + the wire subtype + the envelope payload field. */
const RECEIVER_KINDS = [
  { name: 'policy', make: makeCirclePolicyPeerHandler, subtype: 'circle-policy-broadcast', key: 'policy' },
  { name: 'rules',  make: makeCircleRulesPeerHandler,  subtype: 'circle-rules-broadcast',  key: 'rulesDoc' },
  { name: 'recipe', make: makeCircleRecipePeerHandler, subtype: 'circle-recipe-broadcast', key: 'recipe' },
];

const PENDING_KINDS = [
  { name: 'policy', make: createCirclePolicyPendingStore },
  { name: 'rules',  make: createCircleRulesPendingStore },
  { name: 'recipe', make: createCircleRecipePendingStore },
];

const STORAGE_KINDS = [
  { name: 'policy', io: localStorageCirclePolicyPendingIo, local: createCirclePolicyPendingStoreLocal, prefix: 'cc.circlePolicyPending.' },
  { name: 'rules',  io: localStorageCircleRulesPendingIo,  local: createCircleRulesPendingStoreLocal,  prefix: 'cc.circleRulesPending.' },
  { name: 'recipe', io: localStorageCircleRecipePendingIo, local: createCircleRecipePendingStoreLocal, prefix: 'cc.circleRecipePending.' },
];

describe('circle triplet · anti-drift guard (one factory, three kinds)', () => {
  it('all three receivers share the factory shape (same behaviour, kind-specific descriptor)', async () => {
    for (const kind of RECEIVER_KINDS) {
      const pending = { set: vi.fn().mockResolvedValue(undefined) };
      const handler = kind.make({ pendingStore: pending, logger: silentLogger });

      // Missing pendingStore throws for every kind (same guard).
      expect(() => kind.make({})).toThrow(/pendingStore/);

      const doc = { hello: kind.name };
      const envelope = {
        subtype: kind.subtype, circleId: 'c1', msgId: 'm1', ts: 1,
        [kind.key]: doc,
      };
      await handler('peer', envelope);
      // Caches the correct payload field for this kind.
      expect(pending.set).toHaveBeenCalledWith('c1', doc);

      // Wrong subtype is dropped (kind isolation).
      pending.set.mockClear();
      await handler('peer', { ...envelope, subtype: 'circle-other-broadcast' });
      expect(pending.set).not.toHaveBeenCalled();

      // msgId dedup: a replay of the same msgId is skipped.
      pending.set.mockClear();
      await handler('peer', envelope);
      expect(pending.set).not.toHaveBeenCalled();
    }
  });

  it('all three pending stores are the one factory shape (identical get/set/clear contract)', async () => {
    for (const kind of PENDING_KINDS) {
      const store = kind.make();
      expect(typeof store.get).toBe('function');
      expect(typeof store.set).toBe('function');
      expect(typeof store.clear).toBe('function');
      // No IO injected → get is a safe null, set/clear are no-ops (no throw).
      await expect(store.get('c1')).resolves.toBeNull();
      await expect(store.set('c1', {})).resolves.toBeUndefined();
      await expect(store.clear('c1')).resolves.toBeUndefined();
      // Empty circleId is guarded for every kind.
      await expect(store.get('')).resolves.toBeNull();
    }
  });

  it('all three storage caches share IO behaviour but keep DISTINCT, stable key prefixes', async () => {
    for (const kind of STORAGE_KINDS) {
      const backing = new Map();
      const storage = {
        getItem:    (k) => (backing.has(k) ? backing.get(k) : null),
        setItem:    (k, v) => backing.set(k, v),
        removeItem: (k) => backing.delete(k),
      };
      const io = kind.io(storage);
      await io.save('c1', { v: kind.name });
      // The on-disk key is prefix + circleId — must not drift (would orphan data).
      expect(backing.has(kind.prefix + 'c1')).toBe(true);
      expect(await io.load('c1')).toEqual({ v: kind.name });
      await io.remove('c1');
      expect(await io.load('c1')).toBeNull();

      // The *Local helper round-trips through the same prefix.
      const local = kind.local(storage);
      await local.set('c2', { v: 2 });
      expect(backing.has(kind.prefix + 'c2')).toBe(true);
      expect(await local.get('c2')).toEqual({ v: 2 });
    }
  });

  it('every storage prefix is unique (kinds cannot collide on disk)', () => {
    const prefixes = STORAGE_KINDS.map((k) => k.prefix);
    expect(new Set(prefixes).size).toBe(prefixes.length);
  });

  it('policy + rules conflict share the flat-doc factory (empty blockConflicts, identical detect)', () => {
    const local    = { purpose: 'a', extra: 'keep' };
    const incoming = { purpose: 'b', extra: 'keep' };
    const base     = { purpose: 'a', extra: 'keep' };

    const p = detectPolicyConflicts(local, incoming, base);
    const r = detectRulesConflicts(local, incoming, base);
    // Flat-doc shape: no blocks array, ever.
    expect(p.blockConflicts).toEqual([]);
    expect(r.blockConflicts).toEqual([]);
    // Same underlying objectDiff → identical report for identical input.
    expect(p).toEqual(r);

    // Missing decision defaults to 'theirs' (incoming wins) for both.
    expect(applyPolicyResolution(local, incoming, {}).purpose).toBe('b');
    expect(applyRulesResolution(local, incoming, {}).purpose).toBe('b');
    // Local-only key preserved (lossless) for both.
    expect(applyPolicyResolution(local, incoming, {}).extra).toBe('keep');
    expect(applyRulesResolution(local, incoming, {}).extra).toBe('keep');
  });

  it('recipe conflict is NOT the flat-doc shape — it stays its own per-block module', () => {
    // A recipe divergence in a block surfaces as a blockConflict, not a
    // meta-conflict — the genuinely-different regime the factory does NOT
    // absorb.  If someone tried to route recipe through the flat-doc
    // factory, blockConflicts would be empty and this would fail.
    const base     = { name: 'r', blocks: [{ id: 'b1', type: 't', config: { x: 0 } }] };
    const local    = { name: 'r', blocks: [{ id: 'b1', type: 't', config: { x: 1 } }] };
    const incoming = { name: 'r', blocks: [{ id: 'b1', type: 't', config: { x: 2 } }] };
    const report = detectRecipeConflicts(local, incoming, base);
    expect(report.blockConflicts.length).toBe(1);
    expect(report.blockConflicts[0].blockId).toBe('b1');
  });
});
