/**
 * WHAT THE NEARBY ROOM IS TOLD ABOUT YOU — decided once, for both shells (the box has no room).
 *
 * The FACE: the same faces a circle offers — your display name (the default), your handle, or nobody — chosen per device
 * in "You here"; a label only, never an identity. The ADDRESSES ("share how to reach me", all-or-nothing by Frits'
 * call): the relay this device rides, and the NKN address only when the publication lock allows it (the same lock the
 * invite QR honours). A shell hands in only where its choice is stored and how it finds its relay and NKN address.
 */

/** The faces a device may show in the room. */
export const NEARBY_FACES = Object.freeze(['name', 'handle', 'none']);

/** A stored face choice, read: one of `NEARBY_FACES`; anything else is the default, your name. */
export function nearbyFaceChoice(raw) { return NEARBY_FACES.includes(raw) ? raw : 'name'; }

/**
 * @param {object} a
 * @param {() => string|null} a.readChoice                  the stored face choice (a shell's device-local store)
 * @param {(app: string, op: string, args: object) => Promise<any>} a.callSkill
 * @param {() => Promise<string|null>|string|null} [a.relayUrl]   the relay this device rides
 * @param {() => boolean} [a.shareNkn]                      the publication lock (true = the NKN address may be shared)
 * @param {() => string|null} [a.nknAddress]                this device's NKN address
 * @returns {{ myFace: () => Promise<{label: string}|null>, myAddresses: () => Promise<object> }}
 */
export function createNearbyIdentity({ readChoice, callSkill, relayUrl = () => null, shareNkn = () => false, nknAddress = () => null } = {}) {
  return {
    async myFace() {
      try {
        const choice = nearbyFaceChoice(readChoice?.());
        if (choice === 'none') return null;
        const e = (await callSkill?.('stoop', 'getMyProfile', {}))?.entry ?? {};
        const label = choice === 'handle' ? (e.handle ?? null) : (e.displayName ?? e.handle ?? null);
        return label ? { label: String(label) } : null;
      } catch { return null; }
    },
    async myAddresses() {
      const out = {};
      try { const url = await relayUrl(); if (url) out.relay = { url }; } catch { /* no relay is honest */ }
      try {
        const addr = nknAddress();
        if (shareNkn() === true && typeof addr === 'string' && addr) out.nkn = { address: addr };
      } catch { /* the lock stays closed on a broken read */ }
      return out;
    },
  };
}
