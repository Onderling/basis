/**
 * wakeNudges — the device's wake-nudge switch (offline delivery, the wake rung), OFF by default.
 *
 * Silence-by-default is the recipient's half of the attention gate: no token ever reaches the
 * relay until the person turns this on, so with the switch off ZERO push metadata leaves the
 * device (the honoured floor — the relay ignores wakes for addresses it holds no token for).
 * Turning it on runs the whole enable chain: OS permission → push token (via the existing
 * `setupPush` bridge) → `relay.registerPushToken` on the transport facade. Turning it off
 * unregisters at the relay AND tears the bridge down. The sender's half of the gate already
 * lives in the shared entry-kind table (silent kinds stamp `noWake` at every fan site).
 *
 * The switch's persistence is an injected {getItem, setItem} seam — in production the app hands
 * a register-backed adapter (the `wake.nudges` parameter, device scope), so the value lives in
 * the ONE settings vocabulary; the key below only names this seam. `restore()` re-registers on
 * boot so a relay that lost its memory — or a fresh socket — gets the token back without the
 * person doing anything.
 *
 * Pure orchestration: every effect (permission prompt, bridge, relay, storage) is injected, so
 * the whole ladder tests headless.
 */
import { setupPush, requestPushPermission } from './setupPush.js';

export const WAKE_NUDGES_KEY = 'cc-wake-nudges';

/** Read the persisted switch — absent/unreadable means OFF (the default is the feature). */
export async function readWakeNudgesPref(asyncStorage) {
  try { return (await asyncStorage.getItem(WAKE_NUDGES_KEY)) === 'on'; }
  catch { return false; }
}

/**
 * @param {object} a
 * @param {object} a.agent          the live agent (setupPush wires the bridge onto it)
 * @param {{registerPushToken:Function, unregisterPushToken:Function}} a.relay  the transport facade's push half
 * @param {object} a.asyncStorage   AsyncStorage-shaped {getItem, setItem}
 * @param {string} [a.projectId]    EAS project id for the Expo token
 * @param {object} [a.deps]         injectables: {requestPermission, setup} (tests)
 * @returns {{enable:Function, disable:Function, restore:Function}}
 */
export function createWakeNudges({ agent, relay, asyncStorage, projectId, deps = {} } = {}) {
  const requestPermission = deps.requestPermission ?? requestPushPermission;
  const setup = deps.setup ?? setupPush;
  let teardown = null;   // the live bridge's teardown, held across enable/disable

  async function bringUp() {
    const r = await setup({ agent, projectId });
    if (!r?.token) return { ok: false, code: 'no-token' };
    teardown = r.teardown;
    try { await relay.registerPushToken({ token: r.token, platform: r.platform }); }
    catch (err) {
      // The token exists but the relay refused/timed out (no pushSender wired, or offline). The
      // bridge stays down and the switch is NOT persisted on — the UI reports the truth.
      try { await r.teardown?.(); } catch { /* best-effort */ }
      teardown = null;
      return { ok: false, code: 'relay-refused', detail: err?.message ?? String(err) };
    }
    return { ok: true, token: r.token, platform: r.platform };
  }

  return {
    /** The person turned it ON: permission → token → relay registration → persist. */
    async enable() {
      const perm = await requestPermission();
      if (!perm?.granted) return { ok: false, code: 'permission-denied' };
      const up = await bringUp();
      if (!up.ok) return up;
      try { await asyncStorage.setItem(WAKE_NUDGES_KEY, 'on'); } catch { /* pref is best-effort; the registration is live */ }
      return up;
    },

    /** The person turned it OFF: forget at the relay, tear the bridge down, persist. */
    async disable() {
      try { await relay.unregisterPushToken(); } catch { /* relay may be gone — off is off locally regardless */ }
      try { await teardown?.(); } catch { /* best-effort */ }
      teardown = null;
      try { await asyncStorage.setItem(WAKE_NUDGES_KEY, 'off'); } catch { /* best-effort */ }
      return { ok: true };
    },

    /** Boot: if the switch is on, silently re-register (no OS prompt — permission was granted at
     *  enable; if the OS since revoked it, setup fails and we report without flipping the pref:
     *  the person's intent stands, the Settings row shows the live truth). */
    async restore() {
      if (!(await readWakeNudgesPref(asyncStorage))) return { restored: false, reason: 'off' };
      const up = await bringUp();
      return up.ok ? { restored: true, token: up.token } : { restored: false, reason: up.code, detail: up.detail };
    },
  };
}
