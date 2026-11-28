// @reads-source: the shared came-from line is checked in both shells as text, so rung 1 runs it (docs/conventions/verification-ladder.md).
/**
 * The restore-finish flow's LAST screen: which sentence ends which branch. Written twice until 2026-09-24 — in web's
 * painter and in mobile's `RestoreFinishModal` — now once, for both shells to paint.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { restoreFinishOutcome, restoreFinishCameFrom } from '../../src/v2/restoreFinishView.js';

const inst = ({ source, retire, intent, retired } = {}) => ({
  steps: {
    ...(source ? { source: { outcome: source } } : {}),
    ...(retire ? { retire: { outcome: retire, out: { retiredDevices: retired ?? [] } } } : {}),
  },
  produces: intent ? { intent } : {},
});

describe('restoreFinishOutcome', () => {
  // "Not now" closes the flow at once: no last screen to tap away (the phone walk: the card stayed). Loading a file
  // later is My data's own action ("Load a recovery file"), so nothing needs saying here.
  it('"later" closes at once, with no last screen', () => {
    expect(restoreFinishOutcome(inst({ source: 'later' }))).toMatchObject({ closeAtOnce: true, messageKey: null });
    expect(restoreFinishOutcome(inst({ intent: 'adding' })).closeAtOnce).toBe(false);
  });
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

describe('where the circles came from (the shared line both shells paint)', () => {
  it('after a recovery FILE load: the file, not "this device" (the phone walk said "They came from this device.")', () => {
    expect(restoreFinishCameFrom({ steps: { status: { out: { carrier: 'local' } }, source: { outcome: 'ok', out: { source: 'file' } } } }))
      .toBe('circle.restore_finish.status_file');
  });
  it('from the pod, and from this device, as before', () => {
    expect(restoreFinishCameFrom({ steps: { status: { out: { carrier: 'pod' } } } })).toBe('circle.restore_finish.status_pod');
    expect(restoreFinishCameFrom({ steps: { status: { out: { carrier: 'local' } } } })).toBe('circle.restore_finish.status_local');
  });
  it('both shells take it from here', () => {
    const web = readFileSync(new URL('../../web/v2/circleApp.js', import.meta.url), 'utf8');
    const phone = readFileSync(new URL('../../../basis-mobile/src/screens/v2/RestoreFinishModal.js', import.meta.url), 'utf8');
    for (const src of [web, phone]) {
      expect(src).toMatch(/restoreFinishCameFrom\(/);
      expect(src).not.toMatch(/status\.carrier === 'pod'/);
    }
  });
});
