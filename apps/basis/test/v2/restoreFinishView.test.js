/**
 * The restore-finish flow's LAST screen: which sentence ends which branch. Written twice until 2026-09-24 — in web's
 * painter and in mobile's `RestoreFinishModal` — now once, for both shells to paint.
 */
import { describe, it, expect } from 'vitest';
import { restoreFinishOutcome } from '../../src/v2/restoreFinishView.js';

const inst = ({ source, retire, intent, retired } = {}) => ({
  steps: {
    ...(source ? { source: { outcome: source } } : {}),
    ...(retire ? { retire: { outcome: retire, out: { retiredDevices: retired ?? [] } } } : {}),
  },
  produces: intent ? { intent } : {},
});

describe('restoreFinishOutcome', () => {
  it('"later" says so', () => { expect(restoreFinishOutcome(inst({ source: 'later' })).messageKey).toBe('circle.restore_finish.later_title'); });
  it('a file that is not yours / unreadable', () => {
    expect(restoreFinishOutcome(inst({ source: 'not-your-file' })).messageKey).toBe('circle.restore_finish.err_not_yours');
    expect(restoreFinishOutcome(inst({ source: 'unreadable-file' })).messageKey).toBe('circle.restore_finish.err_unreadable');
  });
  it('adding a device next to one still in hand', () => { expect(restoreFinishOutcome(inst({ intent: 'adding' })).messageKey).toBe('circle.restore_finish.done_adding'); });
  it('a LOST phone retired: loud, with the count', () => {
    const r = restoreFinishOutcome(inst({ retire: 'ok', intent: 'lost', retired: ['d1', 'd2'] }));
    expect(r).toMatchObject({ messageKey: 'circle.restore_finish.done_loud', retry: false, retiredCount: 2 });
  });
  it('a BROKEN phone retired: quiet', () => { expect(restoreFinishOutcome(inst({ retire: 'ok', intent: 'broken' })).messageKey).toBe('circle.restore_finish.done_quiet'); });
  it('a wrong phrase: say so, and offer a retry', () => {
    expect(restoreFinishOutcome(inst({ retire: 'wrong-phrase', intent: 'lost' }))).toMatchObject({ messageKey: 'circle.enroll.invalid_phrase', retry: true });
  });
  it('anything else failed: the plain failure, with a retry when a retire ran', () => {
    expect(restoreFinishOutcome(inst({ retire: 'error', intent: 'lost' }))).toMatchObject({ messageKey: 'circle.restore_finish.err_failed', retry: true });
  });
});
