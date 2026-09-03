/**
 * The two halves of the board's vocabulary translation, pinned to each other: stoop WRITES a post by
 * mapping the intent a person picked onto `{type, kind}`, and the shells READ it back with the shared
 * reverse. Whoever changes one has to change the other (the "pin the agreement" rule).
 */
import { describe, it, expect } from 'vitest';
import { STOOP_TYPE_MAPPING } from '../src/lib/canonicalAdapter.js';
import { NOTICEBOARD_INTENTS, noticeboardIntentOf } from '@onderling/item-types';

describe('intent → {type, kind} → intent', () => {
  it('every board intent survives the round trip', () => {
    for (const intent of NOTICEBOARD_INTENTS) {
      const m = STOOP_TYPE_MAPPING[intent];
      expect(m, `${intent} has no forward mapping`).toBeTruthy();
      expect(noticeboardIntentOf({ type: m.type, kind: m.defaultKind })).toBe(intent);
    }
  });

  it("the legacy generic request reads as an ask (the board has no word of its own for it)", () => {
    const m = STOOP_TYPE_MAPPING.request;
    expect(noticeboardIntentOf({ type: m.type, kind: m.defaultKind })).toBe('ask');
  });
});
