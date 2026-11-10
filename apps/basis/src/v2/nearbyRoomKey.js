/**
 * basis v2 — the Nearby ROOM KEY: the one key this device speaks on the LAN while it is in the room.
 *
 * On the LAN a device says only a LAN key, never the person's canonical key (the transport refuses anything else). At
 * rest that is a random rest key; in the room it is a ROOM KEY, derived for the self the device entered as:
 * `self.circleIdentityFor('nearby:' + nonce)`, the nonce 16 random bytes drawn at entry and held in this closure only.
 * A new entry is a new nonce, so the same café on Tuesday and on Friday sees two strangers, and two selves on one
 * phone are two strangers too.
 *
 * The room key is registered with the agent as one of its identities, owned by the self (so the agent signs room
 * traffic with it, on the LAN transport that speaks it, and never on a relay), and forgotten on leave. It is never
 * registered on a relay or NKN: it lives on the LAN connection only.
 *
 * WHEN. Entering = the Nearby view opens. Leaving = the view is closed AND the room is empty (the room outlives the
 * screen: someone can still answer you while you are on another tab), or the radio goes off. A change of room self
 * while in the room is a leave and a fresh entry. A key change is a new presence: the LAN connections made under the
 * old key end and the peers dial again under the new one.
 *
 * @param {object} deps
 * @param {() => ({id?: string, asking?: boolean}|null)} deps.roomSelf  the self the device enters as (null = the default)
 * @param {(selfId: string, namespace: string) => Promise<object>} deps.identityFor  the self's identity for a namespace
 * @param {(selfId: string) => string|null} deps.ownerOf  the self's chat key (who owns the room key at the agent)
 * @param {(address: string, identity: object, o?: object) => boolean} deps.registerSelfIdentity
 * @param {(address: string) => boolean} deps.forgetSelfIdentity
 * @param {(identity: object|null) => Promise<string|null>} deps.setLanIdentity  the mesh surface's affordance
 * @param {() => Array} [deps.listPeers]
 * @param {(fn: (peers: Array) => void) => (() => void)} [deps.subscribeToPeers]
 * @param {(err: Error, phase: string) => void} [deps.onError]
 * @returns {{ viewOpened: () => Promise<void>, viewClosed: () => Promise<void>, selfChanged: () => Promise<void>,
 *   leave: () => Promise<void>, address: () => string|null }}
 */
export function createNearbyRoomKey({
  roomSelf, identityFor, ownerOf, registerSelfIdentity, forgetSelfIdentity, setLanIdentity,
  listPeers = () => [], subscribeToPeers = null, onError = null,
} = {}) {
  if (typeof identityFor !== 'function' || typeof setLanIdentity !== 'function') {
    throw new TypeError('nearbyRoomKey: identityFor and setLanIdentity are required');
  }
  const report = (err, phase) => { try { onError?.(err, phase); } catch { /* diagnostics only */ } };
  let entered = null;   // { selfId, address }
  let viewOpen = false;
  let queue = Promise.resolve();
  // every change runs after the one before it: an open and a close in quick succession must not interleave
  const serial = (fn) => { queue = queue.then(fn, fn).catch((err) => report(err, 'room-key')); return queue; };

  const selfNow = () => {
    let s = null;
    try { s = roomSelf?.() ?? null; } catch { s = null; }
    if (s?.asking) return null;   // the room is still asking which self: nobody enters yet
    return s?.id ?? 'default';
  };
  const peersNow = () => { try { return listPeers() ?? []; } catch { return []; } };

  const leaveNow = async () => {
    if (!entered) return;
    const { address } = entered;
    entered = null;
    try { forgetSelfIdentity?.(address); } catch (err) { report(err, 'forget'); }
    await setLanIdentity(null);   // back to a rest key
  };

  const enterNow = async () => {
    const selfId = selfNow();
    if (!selfId) { await leaveNow(); return; }
    if (entered?.selfId === selfId) return;
    await leaveNow();
    const nonce = new Uint8Array(16);
    globalThis.crypto.getRandomValues(nonce);
    const identity = await identityFor(selfId, `nearby:${Array.from(nonce, (b) => b.toString(16).padStart(2, '0')).join('')}`);
    nonce.fill(0);
    const address = identity?.pubKey;
    if (!address) return;
    const owner = (() => { try { return ownerOf?.(selfId) ?? null; } catch { return null; } })();
    if (!registerSelfIdentity?.(address, identity, owner ? { owner } : {})) {
      report(new Error('the room key could not be registered with the agent'), 'register');
      return;
    }
    entered = { selfId, address };
    await setLanIdentity(identity);
  };

  if (typeof subscribeToPeers === 'function') {
    try {
      subscribeToPeers((peers) => {
        if (!viewOpen && entered && (peers ?? []).length === 0) serial(leaveNow);
      });
    } catch (err) { report(err, 'subscribe'); }
  }

  return {
    viewOpened() { viewOpen = true; return serial(enterNow); },
    viewClosed() {
      viewOpen = false;
      return serial(async () => { if (peersNow().length === 0) await leaveNow(); });
    },
    /** The room self changed (the switcher, the room's question answered): enter again as the new one. */
    selfChanged() { return serial(async () => { if (viewOpen) await enterNow(); else await leaveNow(); }); },
    /** Out of the room now (the radio off). */
    leave() { return serial(leaveNow); },
    /** The room key spoken right now, or null when the device is not in the room. */
    address() { return entered?.address ?? null; },
  };
}
