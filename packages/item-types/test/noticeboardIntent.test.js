/**
 * The board's badge names an INTENT; a stored post carries a canonical {type, kind}. These are two
 * vocabularies and this pins the translation between them — the shells read `item.kind` straight into
 * the badge and printed `CIRCLE.NOTICEBOARD.INTENT.BORROW` at every asker (walked on a phone).
 */
import { describe, it, expect } from 'vitest';
import { NOTICEBOARD_INTENTS, noticeboardIntentOf } from '../src/noticeboardPost.js';

describe('noticeboardIntentOf', () => {
  it('always answers with an intent the locale knows', () => {
    for (const item of [
      { type: 'request', kind: 'borrow' }, { type: 'offer', kind: 'give' },
      { type: 'offer', kind: 'lend' }, { type: 'announcement' }, { type: 'post' }, {}, null,
    ]) expect(NOTICEBOARD_INTENTS).toContain(noticeboardIntentOf(item));
  });

  it('reads the canonical pair the way the writer meant it', () => {
    expect(noticeboardIntentOf({ type: 'request', kind: 'borrow' })).toBe('ask');
    expect(noticeboardIntentOf({ type: 'offer', kind: 'give' })).toBe('offer');
    expect(noticeboardIntentOf({ type: 'offer', kind: 'lend' })).toBe('lend');   // a lend is an offer with a return
  });

  it('a declared intent wins, and a row that stored the board word still reads', () => {
    expect(noticeboardIntentOf({ intent: 'lend', type: 'request', kind: 'borrow' })).toBe('lend');
    expect(noticeboardIntentOf({ type: 'lend' })).toBe('lend');
    expect(noticeboardIntentOf({ intent: 'borrow' })).toBe('ask');   // a KIND in the intent slot is not an intent
  });
});
