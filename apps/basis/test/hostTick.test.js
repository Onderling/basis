/**
 * The host's one tick: every timed thing a host does is a job on ONE clock — started in a fixed order, each on its own
 * period, never two runs of one job at once, and one job's failure never stops another's. The box's four loops
 * (reminders, the export shelf, the model watch, the unlocked-key sweep) are its first jobs.
 */
import { describe, it, expect } from 'vitest';
import { createHostTick } from '../src/v2/hostTick.js';

function clock(start = 0) {
  let at = start;
  const intervals = [];
  const timers = {
    setInterval: (fn, ms) => { const h = { fn, ms, unref() { return h; } }; intervals.push(h); return h; },
    clearInterval: (h) => { const i = intervals.indexOf(h); if (i >= 0) intervals.splice(i, 1); },
  };
  return { now: () => at, advance: (ms) => { at += ms; }, timers, intervals };
}

describe('the host tick', () => {
  it('runs the due jobs in the order they were added, each on its own period', async () => {
    const c = clock();
    const ran = [];
    const tick = createHostTick({ every: 60_000, now: c.now, timers: c.timers });
    tick.add('reminders', { every: 60_000, run: () => { ran.push('reminders'); } });
    tick.add('model-watch', { every: 3_600_000, run: () => { ran.push('model-watch'); } });
    await tick.start();
    expect(ran).toEqual(['reminders', 'model-watch']);
    c.advance(60_000); await tick.tick();
    expect(ran).toEqual(['reminders', 'model-watch', 'reminders']);
    c.advance(3_540_000); await tick.tick();
    expect(ran.slice(-2)).toEqual(['reminders', 'model-watch']);
  });

  it('a clock that fires a moment early still runs a job whose period is the tick (no skipped minute)', async () => {
    const c = clock();
    const ran = [];
    const tick = createHostTick({ every: 60_000, now: c.now, timers: c.timers });
    tick.add('reminders', { every: 60_000, run: () => { ran.push(c.now()); } });
    await tick.start();
    c.advance(59_998); await tick.tick();
    expect(ran).toEqual([0, 59_998]);
  });

  it('one interval for the whole host, never one per job', async () => {
    const c = clock();
    const tick = createHostTick({ every: 60_000, now: c.now, timers: c.timers });
    tick.add('a', { every: 60_000, run: () => {} });
    tick.add('b', { every: 86_400_000, run: () => {} });
    await tick.start();
    expect(c.intervals.map((h) => h.ms)).toEqual([60_000]);
    tick.stop();
    expect(c.intervals).toEqual([]);
  });

  it('a job that must not run at boot runs first one period after the start', async () => {
    const c = clock();
    const ran = [];
    const tick = createHostTick({ every: 60_000, now: c.now, timers: c.timers });
    tick.add('export-shelf', { every: 3_600_000, atStart: false, run: () => { ran.push('shelf'); } });
    await tick.start();
    c.advance(3_540_000); await tick.tick();
    expect(ran).toEqual([]);
    c.advance(60_000); await tick.tick();
    expect(ran).toEqual(['shelf']);
  });

  it('a job still running is not started again, and does not hold up the others', async () => {
    const c = clock();
    const ran = [];
    let release;
    const tick = createHostTick({ every: 60_000, now: c.now, timers: c.timers });
    tick.add('slow', { every: 60_000, run: () => { ran.push('slow'); return new Promise((r) => { release = r; }); } });
    tick.add('fast', { every: 60_000, run: () => { ran.push('fast'); } });
    tick.start();
    await new Promise((r) => { setTimeout(r, 0); });   // the fast one settles; the slow one does not
    c.advance(60_000); await tick.tick();
    expect(ran).toEqual(['slow', 'fast', 'fast']);
    release();
  });

  it("one job's failure is reported and never stops another's", async () => {
    const c = clock();
    const ran = [];
    const errors = [];
    const tick = createHostTick({ every: 60_000, now: c.now, timers: c.timers, onError: (e) => errors.push(e) });
    tick.add('broken', { every: 60_000, run: () => { throw new Error('boom'); } });
    tick.add('fine', { every: 60_000, run: async () => { ran.push('fine'); } });
    await tick.start();
    expect(ran).toEqual(['fine']);
    expect(errors).toEqual([{ job: 'broken', error: 'boom' }]);
  });

  it('a name is one job: adding it twice is refused', () => {
    const tick = createHostTick({ timers: clock().timers });
    tick.add('reminders', { every: 60_000, run: () => {} });
    expect(() => tick.add('reminders', { every: 60_000, run: () => {} })).toThrow(/reminders/);
  });

  it('a bad period never makes a tight loop', async () => {
    const c = clock();
    const ran = [];
    const tick = createHostTick({ every: 0, now: c.now, timers: c.timers });
    tick.add('a', { every: 0, run: () => { ran.push('a'); } });
    await tick.start();
    expect(c.intervals[0].ms).toBeGreaterThanOrEqual(1_000);
    c.advance(10); await tick.tick();
    expect(ran).toEqual(['a']);
  });
});
