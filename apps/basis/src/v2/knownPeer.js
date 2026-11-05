/**
 * Who this device knows on the wire — the question the wire gate asks of a caller it has no trust row for. A caller
 * it does not know is a stranger, and a stranger reaches only what is public; 'authenticated' only ever meant "a key
 * signed this", and every stranger has a key.
 *
 * Known, by KEY only (never a handle or a display name, which anyone can choose):
 *   - its own selves (the person and its personas) and its own devices;
 *   - the members of the circles it is in: their webid, their signing key and their per-circle address;
 *   - its contact book: the webid, key and address a contact's row holds.
 * Computed at call time from those sources, never kept as a second list. A co-member whose address this device has
 * not folded yet is a stranger until the fold; the late-recipient re-tell is what heals that.
 *
 * Pure: the sources are injected, so web, mobile and the box compose one predicate.
 */

const ROSTER_KEYS = ['webid', 'pubKey', 'circleAddress', 'signingPublicKey'];
const CONTACT_KEYS = ['webid', 'pubKey', 'peerAddr'];

const keysOf = (row, fields) => fields.map((f) => row?.[f]).filter((v) => typeof v === 'string' && v);

/**
 * @param {object} a
 * @param {(key: string) => boolean} [a.isSelf]                      one of this device's own selves
 * @param {() => Promise<string[]>} [a.ownDeviceAddresses]          the addresses of this person's other devices
 * @param {() => Promise<string[]>} [a.myCircleIds]                 the circles this device is in
 * @param {(circleId: string) => Promise<object[]>} [a.rosterOf]    a circle's member rows
 * @param {() => Promise<object[]>} [a.contacts]                    the contact book's rows
 * @returns {(key: string) => Promise<boolean>}
 */
export function makeIsKnownPeer({ isSelf = null, ownDeviceAddresses = null, myCircleIds = null, rosterOf = null, contacts = null } = {}) {
  const safe = async (fn, fallback) => { try { return (await fn()) ?? fallback; } catch { return fallback; } };
  return async function isKnownPeer(key) {
    if (typeof key !== 'string' || !key) return false;
    try { if (typeof isSelf === 'function' && isSelf(key)) return true; } catch { /* the next source */ }
    if (typeof ownDeviceAddresses === 'function' && (await safe(ownDeviceAddresses, [])).includes(key)) return true;
    if (typeof contacts === 'function' && (await safe(contacts, [])).some((c) => keysOf(c, CONTACT_KEYS).includes(key))) return true;
    if (typeof myCircleIds === 'function' && typeof rosterOf === 'function') {
      for (const circleId of await safe(myCircleIds, [])) {
        if ((await safe(() => rosterOf(circleId), [])).some((m) => keysOf(m, ROSTER_KEYS).includes(key))) return true;
      }
    }
    return false;
  };
}
