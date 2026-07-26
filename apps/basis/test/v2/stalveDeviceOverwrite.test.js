/**
 * A stale second device must not clobber a fresher change — story 6.2 of
 * `plans/NOTE-multi-device-user-stories.md`.
 *
 * This is the SAME shape as the bugs found on 2026-07-26 (a second operation re-derives from a partial base
 * and silently overwrites the first), but on the multi-device axis: Anna edits a circle rule on her PHONE
 * while her LAPTOP is offline holding the old document; the laptop reconnects and fans its stale copy.
 *
 * The property: an inbound document is never applied silently. `makeKringKindReceiver` caches it as PENDING
 * and the human resolves — so a stale broadcast cannot overwrite a newer local edit behind the user's back.
 * These tests pin that, plus the conflict detection the resolver UI reads.
 *
 * Cast: Anna's phone (fresh) · Anna's laptop (stale) · Bram (a third member who must converge, not diverge).
 */
import { describe, it, expect, vi } from 'vitest';
import { makeKringPolicyPeerHandler } from '../../src/v2/kringPolicyReceiver.js';
import { detectRulesConflicts, applyRulesResolution, decisionsForMerges } from '../../src/v2/rulesConflict.js';

/** A device's local doc + the pending slot an inbound broadcast lands in. */
function device(initialDoc) {
  let applied = initialDoc;
  const pending = new Map();
  return {
    applied: () => applied,
    pendingFor: (circleId) => pending.get(circleId) ?? null,
    /** The human accepting the pending doc — the ONLY way an inbound doc becomes local. */
    resolve: (circleId, decisions = {}) => {
      const incoming = pending.get(circleId);
      if (!incoming) return applied;
      applied = applyRulesResolution(applied, incoming, decisions);
      pending.delete(circleId);
      return applied;
    },
    handler: makeKringPolicyPeerHandler({
      pendingStore: { set: async (circleId, doc) => { pending.set(circleId, doc); } },
      logger: { warn: vi.fn(), info: vi.fn(), debug: vi.fn() },
    }),
  };
}

const envelope = (policy, msgId) => ({
  subtype: 'kring-policy-broadcast', circleId: 'c1', msgId, ts: Date.now(), policy,
});

const OLD = { houseRules: ['wees aardig'], quietHours: '22:00' };
const NEW = { houseRules: ['wees aardig', 'geen fietsen in de gang'], quietHours: '22:00' };

describe('6.2 — a stale device cannot silently overwrite a fresher change', () => {
  it('a stale inbound policy lands as PENDING and does NOT touch the applied doc', async () => {
    const phone = device(NEW);                                  // the phone made the fresh edit
    await phone.handler('laptop-addr', envelope(OLD, 'm1'));    // the laptop fans its stale copy

    expect(phone.applied()).toBe(NEW);                          // untouched — no silent clobber
    expect(phone.pendingFor('c1')).toEqual(OLD);                // parked for the human instead
  });

  it('the 3-way diff records WHICH side diverged, so an auto-merge can resolve correctly', () => {
    const base = OLD;                                           // what both devices last agreed on
    const localChanged = detectRulesConflicts(NEW, OLD, base);  // the phone edited; the laptop is at base
    expect(localChanged.metaConflicts).toEqual([]);             // not a conflict — only one side moved
    expect(localChanged.toMerge).toEqual([
      { path: ['houseRules'], yours: NEW.houseRules, theirs: OLD.houseRules, side: 'local' },
    ]);
    // …and the mirror case resolves the other way.
    const incomingChanged = detectRulesConflicts(OLD, NEW, base);
    expect(incomingChanged.toMerge[0].side).toBe('incoming');
  });

  it('AUTO-MERGE keeps each side\'s real change — a stale replica cannot revert a fresher local edit', () => {
    const base = OLD;
    // The no-conflict fast path both shells take. Passing `{}` here is what silently reverted the edit:
    // `apply` defaults every unlisted path to `theirs`.
    const naive = applyRulesResolution(NEW, OLD, {});
    expect(naive.houseRules).toEqual(OLD.houseRules);           // ← the bug, pinned as the counter-example

    const report = detectRulesConflicts(NEW, OLD, base);
    const merged = applyRulesResolution(NEW, OLD, decisionsForMerges(report.toMerge));
    expect(merged.houseRules).toEqual(NEW.houseRules);          // the fresh edit survives the stale fan

    // Symmetry: a genuinely NEWER incoming change is still taken.
    const r2 = detectRulesConflicts(OLD, NEW, base);
    expect(applyRulesResolution(OLD, NEW, decisionsForMerges(r2.toMerge)).houseRules).toEqual(NEW.houseRules);
  });

  it('a duplicate stale broadcast is ignored (msgId dedup), not re-parked repeatedly', async () => {
    const phone = device(NEW);
    await phone.handler('laptop-addr', envelope(OLD, 'm1'));
    phone.resolve('c1', { houseRules: 'yours' });               // human dismisses it, keeping the fresh value
    await phone.handler('laptop-addr', envelope(OLD, 'm1'));    // the same broadcast arrives again

    expect(phone.pendingFor('c1')).toBeNull();                  // not resurrected by the replay
    expect(phone.applied().houseRules).toEqual(NEW.houseRules);
  });

  it('the third member converges on the ACCEPTED doc, not on arrival order', async () => {
    const bram = device(OLD);
    // Bram receives the phone's fresh doc and accepts it (default: incoming wins).
    await bram.handler('phone-addr', envelope(NEW, 'm2'));
    const after = bram.resolve('c1');

    expect(after.houseRules).toEqual(NEW.houseRules);
    // A LATER stale fan from the laptop parks as pending and still does not overwrite what Bram applied.
    await bram.handler('laptop-addr', envelope(OLD, 'm3'));
    expect(bram.applied().houseRules).toEqual(NEW.houseRules);
    expect(bram.pendingFor('c1')).toEqual(OLD);
  });
});
