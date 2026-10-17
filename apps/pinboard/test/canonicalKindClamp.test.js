/**
 * intentToCanonicalDraft — kind clamping (fixes the recurring
 * `WARN item-types[request]: /kind enum`). A caller-supplied kind is
 * honoured only if valid for the mapped canonical type; otherwise it
 * falls back to the always-valid defaultKind. Shared by web + mobile
 * (postRequest calls this).
 */

import { describe, it, expect } from 'vitest';
import { intentToCanonicalDraft } from '../src/lib/canonicalAdapter.js';

describe('intentToCanonicalDraft — canonical kind clamping', () => {
  it('clamps a non-canonical override to the defaultKind (the bug)', () => {
    // composer passed the UI verb 'ask' as kind → not a request kind.
    expect(intentToCanonicalDraft('ask', 'ask')).toEqual({ type: 'request', kind: 'borrow' });
  });

  it('honours a VALID canonical override', () => {
    expect(intentToCanonicalDraft('ask', 'share')).toEqual({ type: 'request', kind: 'share' });
    expect(intentToCanonicalDraft('offer', 'lend')).toEqual({ type: 'offer', kind: 'lend' });
  });

  it('falls back when the override is valid for a DIFFERENT type', () => {
    // 'borrow' is a request kind, not an offer kind → offer defaultKind.
    expect(intentToCanonicalDraft('offer', 'borrow')).toEqual({ type: 'offer', kind: 'give' });
  });

  it('uses defaultKind when no override is given', () => {
    expect(intentToCanonicalDraft('ask')).toEqual({ type: 'request', kind: 'borrow' });
    expect(intentToCanonicalDraft('lend')).toEqual({ type: 'offer', kind: 'lend' });
  });

  it('missing intent: keeps a valid kind, omits an invalid one (no enum violation)', () => {
    expect(intentToCanonicalDraft(null, 'borrow')).toEqual({ type: 'request', kind: 'borrow' });
    expect(intentToCanonicalDraft(null, 'ask')).toEqual({ type: 'request' });
    expect(intentToCanonicalDraft('')).toEqual({ type: 'request' });
  });

  it('bespoke intents pass through verbatim (skipped from canonical validation)', () => {
    expect(intentToCanonicalDraft('report', 'whatever')).toEqual({ type: 'report', kind: 'whatever' });
    expect(intentToCanonicalDraft('membership-code')).toEqual({ type: 'membership-code' });
  });
});
