/**
 * wakeNudges — the whole enable/disable/restore ladder, headless. The property that matters most
 * is the FLOOR: while the switch is off (the default), the relay never sees a token; and a
 * refused relay registration does NOT persist the switch on (the UI reports the truth).
 */
import { describe, it, expect } from 'vitest';
import { createWakeNudges, readWakeNudgesPref, WAKE_NUDGES_KEY } from '../src/push/wakeNudges.js';

function fakeStorage(map = new Map()) {
  return { map, getItem: async (k) => map.get(k) ?? null, setItem: async (k, v) => { map.set(k, v); } };
}
function fakeRelay() {
  const calls = { registered: [], unregistered: 0 };
  return {
    calls,
    registerPushToken: async (a) => { calls.registered.push(a); },
    unregisterPushToken: async () => { calls.unregistered += 1; },
  };
}
const grantedPerm = async () => ({ granted: true, status: 'granted' });
function fakeSetup({ token = 'tok-1', platform = 'android' } = {}) {
  const state = { up: 0, down: 0 };
  const setup = async () => ({ token, platform, teardown: async () => { state.down += 1; }, bridge: {} });
  return { setup: async (...a) => { state.up += 1; return setup(...a); }, state };
}

describe('wakeNudges', () => {
  it('the default is OFF and off means the relay never hears from us', async () => {
    const storage = fakeStorage();
    expect(await readWakeNudgesPref(storage)).toBe(false);
    const relay = fakeRelay();
    const w = createWakeNudges({ agent: {}, relay, asyncStorage: storage, deps: { requestPermission: grantedPerm, setup: fakeSetup().setup } });
    expect((await w.restore()).restored).toBe(false);
    expect(relay.calls.registered).toHaveLength(0);
  });

  it('enable: permission → token → relay registration → persisted on; disable: unregister + teardown + persisted off', async () => {
    const storage = fakeStorage();
    const relay = fakeRelay();
    const { setup, state } = fakeSetup();
    const w = createWakeNudges({ agent: {}, relay, asyncStorage: storage, deps: { requestPermission: grantedPerm, setup } });

    const r = await w.enable();
    expect(r.ok).toBe(true);
    expect(relay.calls.registered).toEqual([{ token: 'tok-1', platform: 'android' }]);
    expect(storage.map.get(WAKE_NUDGES_KEY)).toBe('on');

    const d = await w.disable();
    expect(d.ok).toBe(true);
    expect(relay.calls.unregistered).toBe(1);
    expect(state.down).toBe(1);                       // the bridge came down with the switch
    expect(storage.map.get(WAKE_NUDGES_KEY)).toBe('off');
  });

  it('a denied OS permission refuses without touching the relay or the pref', async () => {
    const storage = fakeStorage();
    const relay = fakeRelay();
    const w = createWakeNudges({ agent: {}, relay, asyncStorage: storage, deps: { requestPermission: async () => ({ granted: false }), setup: fakeSetup().setup } });
    const r = await w.enable();
    expect(r).toEqual({ ok: false, code: 'permission-denied' });
    expect(relay.calls.registered).toHaveLength(0);
    expect(storage.map.has(WAKE_NUDGES_KEY)).toBe(false);
  });

  it('a refused relay registration does NOT persist the switch on, and tears the bridge back down', async () => {
    const storage = fakeStorage();
    const { setup, state } = fakeSetup();
    const relay = { registerPushToken: async () => { throw new Error('no pushSender wired'); }, unregisterPushToken: async () => {} };
    const w = createWakeNudges({ agent: {}, relay, asyncStorage: storage, deps: { requestPermission: grantedPerm, setup } });
    const r = await w.enable();
    expect(r.ok).toBe(false);
    expect(r.code).toBe('relay-refused');
    expect(state.down).toBe(1);
    expect(storage.map.has(WAKE_NUDGES_KEY)).toBe(false);
  });

  it('restore: switch on → silent re-registration (relay restarts forget sleeping devices)', async () => {
    const storage = fakeStorage(new Map([[WAKE_NUDGES_KEY, 'on']]));
    const relay = fakeRelay();
    const { setup } = fakeSetup({ token: 'tok-boot' });
    const w = createWakeNudges({ agent: {}, relay, asyncStorage: storage, deps: { requestPermission: grantedPerm, setup } });
    const r = await w.restore();
    expect(r.restored).toBe(true);
    expect(relay.calls.registered).toEqual([{ token: 'tok-boot', platform: 'android' }]);
  });

  it('restore with a dead relay reports honestly and leaves the pref as the person set it', async () => {
    const storage = fakeStorage(new Map([[WAKE_NUDGES_KEY, 'on']]));
    const relay = { registerPushToken: async () => { throw new Error('offline'); }, unregisterPushToken: async () => {} };
    const w = createWakeNudges({ agent: {}, relay, asyncStorage: storage, deps: { requestPermission: grantedPerm, setup: fakeSetup().setup } });
    const r = await w.restore();
    expect(r.restored).toBe(false);
    expect(r.reason).toBe('relay-refused');
    expect(storage.map.get(WAKE_NUDGES_KEY)).toBe('on');   // intent stands; the row shows the live truth
  });
});
