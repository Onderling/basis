/**
 * A screen's blocks are a HEAD kept current, not read again on every landing. On the phone each Vandaag landing ran
 * calendar.listEvents ×6 and tasks.listOpen ×3 (2026-10-30, the effect probe) though nothing had changed. The head
 * holds what it materialized for the landing's key; a change it hears marks it stale; while the screen is shown it
 * refolds once after a short wait, and while it is hidden the next landing refolds. An idle screen does no work.
 */
import { describe, it, expect } from 'vitest';
import { createScreenHead } from '../../src/v2/screenHead.js';

function harness({ debounceMs = 50 } = {}) {
  const listeners = new Set();
  const subscribe = (fn) => { listeners.add(fn); return () => listeners.delete(fn); };
  const change = (...a) => { for (const fn of listeners) fn(...a); };
  let runs = 0;
  const materialize = async (key) => { runs += 1; return [{ key, run: runs }]; };
  const head = createScreenHead({ materialize, subscribe: [subscribe], debounceMs });
  return { head, change, runs: () => runs, listeners };
}
const wait = (ms) => new Promise((r) => { setTimeout(r, ms); });

describe('a screen head', () => {
  it('a second landing with nothing changed reads nothing', async () => {
    const h = harness();
    expect(await h.head.land('k1')).toEqual([{ key: 'k1', run: 1 }]);
    expect(await h.head.land('k1')).toEqual([{ key: 'k1', run: 1 }]);
    expect(h.runs()).toBe(1);
    expect(h.head.isFresh('k1')).toBe(true);
    expect(h.head.isFresh('k2')).toBe(false);
  });

  it('a change while shown refolds ONCE after the wait, and tells the screen', async () => {
    const h = harness({ debounceMs: 40 });
    const painted = [];
    h.head.onUpdate((blocks) => painted.push(blocks));
    await h.head.land('k1');
    h.change('c1'); h.change('c2'); h.change('c1');   // a burst is one refold
    expect(h.runs()).toBe(1);
    await wait(80);
    expect(h.runs()).toBe(2);
    expect(painted).toEqual([[{ key: 'k1', run: 2 }]]);
    expect(await h.head.land('k1')).toEqual([{ key: 'k1', run: 2 }]);
    expect(h.runs(), 'the refold is what the next landing reads').toBe(2);
  });

  it('a change while hidden does no work; the next landing refolds', async () => {
    const h = harness({ debounceMs: 20 });
    await h.head.land('k1');
    h.head.hide();
    h.change('c1');
    await wait(60);
    expect(h.runs(), 'hidden: nothing ran').toBe(1);
    expect(await h.head.land('k1')).toEqual([{ key: 'k1', run: 2 }]);
  });

  it('another key is another head; invalidate makes the next landing read', async () => {
    const h = harness();
    await h.head.land('k1');
    expect(await h.head.land('k2')).toEqual([{ key: 'k2', run: 2 }]);
    h.head.invalidate();
    expect(await h.head.land('k2')).toEqual([{ key: 'k2', run: 3 }]);
  });

  it('two landings at once share one read; dispose stops listening', async () => {
    const h = harness();
    const [a, b] = await Promise.all([h.head.land('k1'), h.head.land('k1')]);
    expect(a).toBe(b);
    expect(h.runs()).toBe(1);
    h.head.dispose();
    expect(h.listeners.size).toBe(0);
  });
});

describe('a head whose reader comes with the landing', () => {
  it('a screen mounted anew per landing brings its reader; the head still reads once', async () => {
    const head = createScreenHead({ subscribe: [], debounceMs: 20 });
    let runs = 0;
    const reader = async (k) => { runs += 1; return [k]; };
    expect(await head.land('mij', reader)).toEqual(['mij']);
    expect(await head.land('mij', reader)).toEqual(['mij']);
    expect(runs).toBe(1);
  });
});
