/**
 * Background-fetch sync wiring (the tasks-mobile salvage) — the seam that matters:
 * `wireBackgroundSync` must point the substrate's `bgRunOnce` singleton (the SAME one
 * `index.js`'s bundle-load task definition calls) at the app's catch-up closure. A
 * wiring that sets a different singleton is the restore-door bug in bg-fetch form.
 */
import { describe, it, expect } from 'vitest';
import { bgRunOnce, clearBgRunOnce } from '@onderling/sync-engine-rn';
import { wireBackgroundSync, BASIS_BG_TASK_NAME } from '../src/core/backgroundSync.js';

describe('wireBackgroundSync', () => {
  it('wires the closure into the ONE bgRunOnce singleton the OS task calls', async () => {
    let runs = 0;
    const res = await wireBackgroundSync({ runOnce: async () => { runs += 1; return 'synced'; } });
    expect(res.wired).toBe(true);
    expect(res.registered).toBe(false);            // no native module under vitest — swallowed, not fatal
    expect(await bgRunOnce()).toBe('synced');      // the OS task's entry point reaches OUR closure
    expect(runs).toBe(1);
    clearBgRunOnce();
  });

  it('a missing closure is a loud error; the task name matches index.js', async () => {
    await expect(wireBackgroundSync({})).rejects.toThrow(/runOnce/);
    expect(BASIS_BG_TASK_NAME).toBe('basis-mobile-sync-background');
  });
});
