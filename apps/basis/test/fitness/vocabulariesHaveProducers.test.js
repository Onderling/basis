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
import { DELIVERY, DELIVERY_ORDER, DELIVERY_TERMINAL, deliveryAfterSend } from '../../src/v2/deliveryState.js';
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
      classifyFanOut({ errors: [] }),                         // sent
      classifyFanOut({ error: 'chat-unavailable' }),          // failed
      classifyFanOut({ errors: [{ reason: 'some-transient-thing' }] }),      // failed
      // …and the permanent case. The reason string matters: only `recipient-pubkey-unknown` is permanent
      // today, so writing anything else here quietly reports `undeliverable` as unreachable. The guard
      // caught exactly that on its own first run, which is a fair advertisement for it.
      classifyFanOut({ errors: [{ reason: 'recipient-pubkey-unknown' }] }),  // undeliverable
      DELIVERY.STORED,                                        // an inbound, now-authenticated receipt
    ]),
    knownGaps: {
      [DELIVERY.MAYBE]:
        'S2/J-D2, 2026-07-29: `deliveryAfterSend` is called only from tests and `sendMessage`\'s '
        + '`onDelivery` report is wired only in tests, so an unconfirmed send reads `sent`. Entangled '
        + 'with J-D5 — see REMAINING-WORK.md "? Needs Frits".',
      [DELIVERY.REACHED]:
        'S2/J-D2, same cause: no transport ack is reported to the UI layer.',
    },
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
    knownGaps: Object.fromEntries(KRING_KINDS.map((k) => [k,
      'S3/J-CW2+CW3, 2026-07-29: `finalSubmit` never sends the circle\'s `kind` and '
      + '`policyPatchFromState` never carries `conversationKinds`, so every circle falls through to the '
      + 'default conversation regardless of the template picked. See REMAINING-WORK.md P1 #4.'])),
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

describe('FITNESS: the delivery gap, stated as its own fact', () => {
  it('`maybe-received` and `reached-device` are the two that carry uncertainty', () => {
    // Worth its own assertion because WHICH states are missing is the point. Losing the two uncertain
    // rungs is not a cosmetic gap: it is the difference between admitting doubt and claiming success.
    expect(deliveryAfterSend({ acked: false, downgraded: true })).toBe(DELIVERY.MAYBE);
    expect(deliveryAfterSend({ acked: true })).toBe(DELIVERY.REACHED);
    const produced = VOCABULARIES['delivery states'].produced();
    expect(produced.has(DELIVERY.MAYBE)).toBe(false);
    expect(produced.has(DELIVERY.REACHED)).toBe(false);
  });
});

describe('FITNESS: the circle-kind gap, stated as its own fact', () => {
  it('the wizard offers kinds that no circle can carry — every one of them is a known gap', () => {
    const spec = VOCABULARIES['circle kinds'];
    expect(spec.produced().size, 'a circle can now carry its kind — delete the knownGaps entries').toBe(0);
    expect(Object.keys(spec.knownGaps).sort()).toEqual([...KRING_KINDS].sort());
  });
});
