/**
 * The person's clock on web and mobile: ONE host tick, ticking only while the app is in front (its timer is the
 * foreground cadence — background stops it, foreground resumes it), with one job: the intentions runner over the
 * person's own rows. The page's visibility stands in for the phone's app state on web.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { memoryDataSource } from '@onderling/item-store';
import { EventLog } from '../src/eventLog.js';
import { createOwnDevicesStore } from '../src/v2/ownDevicesStore.js';
import { foregroundTimers, webAppState, createPersonClock } from '../src/v2/personClock.js';

function fakeAppState(initial = 'active') {
  const subs = new Set();
  const s = {
    currentState: initial,
    addEventListener: (type, cb) => { subs.add(cb); return { remove: () => subs.delete(cb) }; },
    set(next) { s.currentState = next; for (const cb of subs) cb(next); },
  };
  return s;
}
afterEach(() => { vi.useRealTimers(); });

describe('the foreground timer', () => {
  it('ticks while the app is in front, stops in the background, resumes in front', async () => {
    vi.useFakeTimers();
    const app = fakeAppState('active');
    const timers = foregroundTimers({ AppState: app });
    let n = 0;
    const h = timers.setInterval(() => { n += 1; }, 1000);
    await vi.advanceTimersByTimeAsync(3100);
    const inFront = n;
    expect(inFront).toBeGreaterThanOrEqual(3);
    app.set('background');
    await vi.advanceTimersByTimeAsync(5000);
    expect(n, 'nothing in the background').toBe(inFront);
    app.set('active');
    await vi.advanceTimersByTimeAsync(2100);
    expect(n).toBeGreaterThan(inFront);
    timers.clearInterval(h);
    const at = n;
    await vi.advanceTimersByTimeAsync(5000);
    expect(n, 'cleared').toBe(at);
  });

  it('on web, the page\'s visibility is the app state', () => {
    const listeners = new Set();
    const doc = { visibilityState: 'visible', addEventListener: (t, f) => { if (t === 'visibilitychange') listeners.add(f); }, removeEventListener: (t, f) => listeners.delete(f) };
    const app = webAppState(doc);
    expect(app.currentState).toBe('active');
    const seen = [];
    const sub = app.addEventListener('change', (s) => seen.push(s));
    doc.visibilityState = 'hidden'; for (const f of listeners) f();
    doc.visibilityState = 'visible'; for (const f of listeners) f();
    expect(seen).toEqual(['background', 'active']);
    sub.remove();
    expect(listeners.size).toBe(0);
  });
});

describe('the person\'s clock', () => {
  it('runs the person\'s own due row while the app is in front, as the person', async () => {
    const store = createOwnDevicesStore({ dataSource: memoryDataSource() });
    await store.put({ type: 'intention', trigger: { at: new Date(Date.now() - 60_000).toISOString() }, op: 'weekCard', appOrigin: 'basis', args: {}, actsAs: 'me-person', state: 'open', createdAt: new Date(Date.now() - 3_600_000).toISOString() }, { by: 'me-person' });
    const calls = [];
    const agent = { ownStore: async () => store, identity: { chat: { pubKey: 'me-person' } }, callSkill: async (app, op, args) => { calls.push({ app, op, args }); return { ok: true }; } };
    const clock = await createPersonClock({ agent, log: new EventLog({ initial: [], muted: [] }), tz: 'Europe/Amsterdam', AppState: fakeAppState('active') });
    await clock.start();
    expect(calls.map((c) => `${c.app}.${c.op}`)).toEqual(['basis.weekCard']);
    expect(clock.tick.names()).toEqual(['intentions']);
    clock.stop();
  });
});
