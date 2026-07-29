/**
 * FITNESS — a declared state must be a state something can actually produce.
 *
 * Three findings in two days had the same shape, and none of them failed anything:
 *
 *   • **conversation kinds** (S3) — vocabulary, resolver, setter, templates, viewer filter: all built,
 *     all tested. Nothing writes `kind` or `conversationKinds` to a circle, and `setConversationKind`
 *     has no call site. Every circle silently falls through to the default.
 *   • **the delivery ladder** (S2) — seven states declared and labelled; the send path produces five.
 *     The two missing ones are exactly the two that carry uncertainty, so the app says "sent" both for
 *     "their phone took it" and for "we never heard anything back".
 *   • (and the same smell under J-CS7: a scope the send path cannot supply the knowledge for.)
 *
 * A vocabulary with a label and no producer is invisible from every direction. It reads as finished in
 * the source, it has tests, it appears in the locale files — and the feature is simply absent. Nothing
 * throws, so nothing catches it except somebody walking a journey and noticing the app is quietly
 * saying less than it knows how to say.
 *
 * So: for each closed vocabulary below, every member must be reachable from a real producer. Members
 * that are known NOT to be reachable are listed with a reason and a pointer — an allowlist, so the gap
 * is deliberate and dated rather than forgotten, and so a NEW gap fails here on the day it lands.
 *
 * **Adding a state?** Wire a producer in the same commit, or add it here with a reason. Both are fine;
 * silently doing neither is what this test exists to stop.
 */
import { describe, it, expect } from 'vitest';
import { DELIVERY, DELIVERY_ORDER, DELIVERY_TERMINAL } from '../../src/v2/deliveryState.js';
import { classifyFanOut } from '@onderling/kring-host/kringBroadcast';
import { KRING_KINDS } from '../../src/v2/kringTemplates.js';
import { policyPatchFromState, finalSubmit } from '../../src/core/wizards/createGroupState.js';

/**
 * Each entry: the full declared set, the states a real code path can put on the thing, and the
 * deliberate gaps. `produced` must be computed by CALLING producers — not by restating the list, which
 * would make the test agree with itself.
 */
const VOCABULARIES = {
  'delivery states': {
    declared: [...DELIVERY_ORDER, ...DELIVERY_TERMINAL],
    produced: () => new Set([
      DELIVERY.PENDING,                                       // kringBroadcast marks it before the fan-out
      classifyFanOut({ errors: [] }),                         // maybe-received
      classifyFanOut({ error: 'chat-unavailable' }),          // failed
      classifyFanOut({ errors: [{ reason: 'some-transient-thing' }] }),      // failed
      // …and the permanent case. The reason string matters: only `recipient-pubkey-unknown` is permanent
      // today, so writing anything else here quietly reports `undeliverable` as unreachable. The guard
      // caught exactly that on its own first run, which is a fair advertisement for it.
      classifyFanOut({ errors: [{ reason: 'recipient-pubkey-unknown' }] }),  // undeliverable
      DELIVERY.STORED,                                        // an inbound, now-authenticated receipt
    ]),
    // CLOSED 2026-07-29 (decision 1) — not by wiring the two missing rungs, but by RETIRING them.
    // `sent` read as success while meaning only "the fan-out accepted it"; `reached-device` is the
    // transport ack, which is deliberately never shown because a phone acks whatever its owner's receipt
    // setting says. What remains is what the product can honestly say.
    knownGaps: {},
  },

  'circle kinds': {
    // The wizard offers these; the question is whether a circle can ever CARRY one.
    declared: [...KRING_KINDS],
    produced: () => {
      // The only two writes a create performs: `finalSubmit`'s args, and the policy patch both shells
      // send straight after. If neither carries `kind`, no circle can hold any of these.
      const patch = policyPatchFromState({ kind: 'buurt', features: {}, revealPolicy: 'open' });
      const carriesKind = Object.prototype.hasOwnProperty.call(patch, 'kind');
      return carriesKind ? new Set(KRING_KINDS) : new Set();
    },
    // CLOSED 2026-07-29 (decision 3): `policyPatchFromState` now carries `kind`, so a circle remembers
    // the template that made it. This list is empty on purpose rather than deleted — the entry is what
    // keeps the vocabulary checked.
    knownGaps: {},
  },
};

// `finalSubmit` is imported to keep the reference honest — the producer analysis above is about what it
// sends, and a rename should break this file rather than silently invalidate the reasoning.
expectFunction(finalSubmit);
function expectFunction(fn) { if (typeof fn !== 'function') throw new Error('finalSubmit moved'); }

describe('FITNESS: every declared state has a producer', () => {
  for (const [name, spec] of Object.entries(VOCABULARIES)) {
    it(`${name} — nothing is declared that no code path can produce`, () => {
      const produced = spec.produced();
      const gaps = Object.keys(spec.knownGaps);
      const unexplained = spec.declared.filter((s) => !produced.has(s) && !gaps.includes(s));
      expect(
        unexplained,
        `${name}: these are declared and labelled but nothing produces them. Wire a producer, or add `
        + 'them to knownGaps with a reason and a pointer.',
      ).toEqual([]);
    });

    it(`${name} — the known gaps are still gaps (delete them once wired)`, () => {
      const produced = spec.produced();
      const stale = Object.keys(spec.knownGaps).filter((s) => produced.has(s));
      expect(
        stale,
        `${name}: these are listed as unreachable but something now produces them — good news. Remove `
        + 'them from knownGaps so the list keeps meaning something.',
      ).toEqual([]);
    });

    it(`${name} — every gap carries a reason someone can act on`, () => {
      for (const [state, reason] of Object.entries(spec.knownGaps)) {
        expect(typeof reason, `${state} has no reason`).toBe('string');
        expect(reason.length, `${state}'s reason is too short to be useful`).toBeGreaterThan(40);
      }
    });
  }
});

describe('FITNESS: the delivery ladder says only what it can produce', () => {
  it('every rung is reachable — the honesty gap is closed by subtraction, not by wiring', () => {
    // Was the S2/J-D2 finding: seven states declared, five produced, and the two missing ones were
    // exactly the two that carried uncertainty. Decision 1 removed them instead of reporting them, so
    // there is nothing left in the vocabulary that the product cannot say.
    const spec = VOCABULARIES['delivery states'];
    const produced = spec.produced();
    expect(spec.declared.filter((st) => !produced.has(st))).toEqual([]);
  });

  it('`sent` and `reached-device` are gone from the vocabulary entirely', () => {
    expect(Object.values(DELIVERY)).not.toContain('sent');
    expect(Object.values(DELIVERY)).not.toContain('reached-device');
  });
});


describe('FITNESS: a circle can carry the kind it was created as', () => {
  it('every kind the wizard offers survives a create', () => {
    // Was the S3/J-CW2+CW3 gap: the wizard offered four kinds and none was ever stored, so a circle's
    // conversation had no relation to the template its creator picked. Closed by decision 3.
    const spec = VOCABULARIES['circle kinds'];
    expect([...spec.produced()].sort()).toEqual([...KRING_KINDS].sort());
    expect(Object.keys(spec.knownGaps), 'a kind regressed to unstorable').toEqual([]);
  });
});
