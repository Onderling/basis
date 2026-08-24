/**
 * The three appliesTo matchers must answer identically.
 *
 * `matchesAppliesTo` exists three times — in the chat renderer, in the web adapter, and in basis's
 * embed builder — because they sit either side of package boundaries that are not wired to share
 * code. Three copies is the real shape here, so this pins the AGREEMENT rather than any one of
 * them: whoever teaches one copy a new discriminator has to teach the others, or this fails.
 *
 * It lives in the APP rather than in either package because it is the only place all three are
 * legally reachable — a package importing an app is invariant #5 backwards, and the dep-boundary
 * guard says so.
 *
 * It exists because `kind` was declared in five manifest rows while all three copies ignored it.
 * Nothing failed. The rows read as narrow — "approve THIS proposal kind", "assign a lend" — and
 * behaved as wide: every inbox item, every offer. A filter that does not filter is invisible
 * until someone acts on an affordance they should never have been shown.
 */
import { describe, it, expect } from 'vitest';
import { chatMatchesAppliesTo as chatMatches } from '@onderling/app-manifest';
import { itemMatchesAppliesTo }                 from '@onderling/web-adapter';
import { matchesAppliesTo as embedMatches }     from '../src/embed.js';

/** Every (appliesTo, item) pair the three must agree on — the discriminators and their combinations. */
const CASES = [
  { name: 'no appliesTo matches anything',      appliesTo: undefined,                                   item: { type: 'offer' },                      expect: true  },
  { name: 'type matches',                       appliesTo: { type: 'offer' },                           item: { type: 'offer' },                      expect: true  },
  { name: 'type misses',                        appliesTo: { type: 'offer' },                           item: { type: 'ask' },                        expect: false },
  { name: 'type array matches',                 appliesTo: { type: ['ask', 'offer'] },                  item: { type: 'offer' },                      expect: true  },
  { name: 'type wildcard matches',              appliesTo: { type: '*' },                               item: { type: 'anything' },                   expect: true  },
  { name: 'kind matches',                       appliesTo: { kind: 'lend' },                            item: { type: 'offer', kind: 'lend' },        expect: true  },
  { name: 'kind misses',                        appliesTo: { kind: 'lend' },                            item: { type: 'offer', kind: 'gift' },        expect: false },
  { name: 'kind absent on the item misses',     appliesTo: { kind: 'lend' },                            item: { type: 'offer' },                      expect: false },
  { name: 'kind array matches',                 appliesTo: { kind: ['lend', 'gift'] },                  item: { type: 'offer', kind: 'gift' },        expect: true  },
  { name: 'type+kind both must match',          appliesTo: { type: 'offer', kind: 'lend' },             item: { type: 'offer', kind: 'lend' },        expect: true  },
  { name: 'type+kind: right type wrong kind',   appliesTo: { type: 'offer', kind: 'lend' },             item: { type: 'offer', kind: 'gift' },        expect: false },
  { name: 'type+kind: wrong type right kind',   appliesTo: { type: 'offer', kind: 'lend' },             item: { type: 'ask',   kind: 'lend' },        expect: false },
  { name: 'state still matches alongside kind', appliesTo: { kind: 'lend', state: 'open' },             item: { type: 'offer', kind: 'lend', state: 'open' },  expect: true  },
  { name: 'state misses alongside kind',        appliesTo: { kind: 'lend', state: 'open' },             item: { type: 'offer', kind: 'lend', state: 'done' },  expect: false },
];

/** The three copies, as predicates. Each is pure, which is why comparing them directly is the
 *  whole test — the surfaces around them (inline keyboards, embed buttons, web rows) differ, but
 *  the question "does this op apply to this item" must not. */
const MATCHERS = {
  'app-manifest/renderChat':          (appliesTo, item) => chatMatches(appliesTo, item),
  'web-adapter/itemMatchesAppliesTo': (appliesTo, item) => itemMatchesAppliesTo(appliesTo, item),
  'basis/embed':                      (appliesTo, item) => embedMatches(appliesTo, item),
};

describe('appliesTo — the three matchers agree', () => {
  for (const c of CASES) {
    it(c.name, () => {
      const answers = Object.entries(MATCHERS).map(([who, fn]) => [who, fn(c.appliesTo, c.item)]);
      // Report WHICH copy disagreed, not just that one did — the failure is otherwise a puzzle.
      expect(Object.fromEntries(answers))
        .toEqual(Object.fromEntries(answers.map(([who]) => [who, c.expect])));
    });
  }
});
