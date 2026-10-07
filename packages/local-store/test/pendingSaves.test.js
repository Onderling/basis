/**
 * Saves that wait on a timer (a store's debounce) are TRACKED while they wait, so a shell can make them all happen at
 * once when the page or the app goes away — a change made just before a reload or a close is not lost.
 */
import { describe, it, expect } from 'vitest';
import { trackPendingSave, flushPendingSaves, pendingSaveCount } from '../src/pendingSaves.js';

describe('pending saves', () => {
  it('a tracked save runs on flush, once; a settled one is not run again', async () => {
    const ran = [];
    const untrack = trackPendingSave(async () => { ran.push('a'); });
    trackPendingSave(async () => { ran.push('b'); });
    expect(pendingSaveCount()).toBe(2);
    await flushPendingSaves();
    expect(ran.sort()).toEqual(['a', 'b']);
    expect(pendingSaveCount()).toBe(0);
    await flushPendingSaves();
    expect(ran).toHaveLength(2);
    untrack();   // harmless after the flush
  });

  it('a save that fires on its own timer untracks itself; one that fails does not stop the others', async () => {
    const ran = [];
    const untrack = trackPendingSave(async () => { ran.push('timer'); });
    untrack();
    trackPendingSave(async () => { throw new Error('disk full'); });
    trackPendingSave(async () => { ran.push('c'); });
    await flushPendingSaves();
    expect(ran).toEqual(['c']);
  });
});
