/**
 * A KEY HOLDER: the one at-rest key every sealed vault of an agent reads at each call, switched by a ceremony.
 *
 * A ceremony (a device revoked, a persona removed, a root-custody device enrolling itself) reseals every sealed backing
 * under a new key. A VaultEncrypted that holds the key's bytes keeps the old key, so whatever reads a sealed vault after
 * the reseal in the same session fails; a VaultEncrypted built with this holder reads the key in force at each call.
 *
 * `rotate(fn)` is the ceremony's window. A read or write already running finishes first; one that arrives waits until
 * the rotation is done; `fn(oldKey)` runs alone and answers the key in force afterwards (the new key, or the old one when
 * it rolled back). A rotation that throws leaves the key as it was. So no read sees a half-resealed store, and no write
 * lands under the old key after its backing was resealed.
 */
import nacl from 'tweetnacl';

const KEY_LENGTH = nacl.secretbox.keyLength;
const isKey = (k) => k instanceof Uint8Array && k.length === KEY_LENGTH;

/**
 * A holder for the at-rest key every sealed vault reads at each call; `rotate` switches it in one window.
 * @param {Uint8Array} initialKey  the 32-byte key in force now
 * @returns {{ current(): Uint8Array, use<T>(fn: (key: Uint8Array) => Promise<T>|T): Promise<T>, rotate(fn: (oldKey: Uint8Array) => Promise<Uint8Array>|Uint8Array): Promise<Uint8Array> }}
 */
export function createKeyHolder(initialKey) {
  if (!isKey(initialKey)) throw new Error(`createKeyHolder: the key must be a ${KEY_LENGTH}-byte Uint8Array`);
  let key = initialKey;
  let inFlight = 0;
  let drained = null;          // resolves when the last running use finishes (set while a rotation waits for it)
  let rotation = null;         // the rotation running now, which every new use waits for

  async function use(fn) {
    while (rotation) await rotation.catch(() => {});
    inFlight += 1;
    try { return await fn(key); }
    finally {
      inFlight -= 1;
      if (inFlight === 0 && drained) drained.resolve();
    }
  }

  async function rotate(fn) {
    while (rotation) await rotation.catch(() => {});
    const run = (async () => {
      if (inFlight > 0) {
        let resolve;
        const p = new Promise((r) => { resolve = r; });
        drained = { resolve };
        await p;
        drained = null;
      }
      const next = await fn(key);
      if (!isKey(next)) throw new Error('createKeyHolder: a rotation must answer the key in force (32 bytes)');
      key = next;
      return key;
    })();
    rotation = run;
    try { return await run; }
    finally { if (rotation === run) rotation = null; }
  }

  return Object.freeze({ current: () => key, use, rotate });
}

/** Whether a value is a key holder (it reads the key at each call) rather than a key's bytes. */
export function isKeyHolder(k) {
  return !!k && typeof k.use === 'function' && typeof k.current === 'function' && typeof k.rotate === 'function';
}
