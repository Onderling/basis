// memberIdentity.js — a member's stable SEALING identity (an X25519 keypair), the bridge between the
// app's membership (webid + transport pubKey) and the sealing substrate (which seals the group key to a
// member's sealing PUBLIC key). The private key lives in a vault (custody); the public key is what the
// circle's roster / control-agent uses to wrap the group key to this member.
//
// Note this is DISTINCT from a member's transport identity (e.g. stoop's NKN pubKey) — sealing is a
// separate key family. Generated once + persisted; the same member reuses it across sessions/devices
// (sync the vault entry to use the same sealing identity on a second device).
//
// Dependency-free: the secret store is INJECTED ({ get, set } — `@canopy/vault`'s shape exactly), so
// pod-client stays vault-agnostic (the app passes a Vault instance).

import { generateKeypair } from './envelope.js';

const DEFAULT_KEY = 'cc.sealing-identity';

/**
 * @param {{ get: (k:string)=>Promise<any>, set: (k:string, v:any)=>Promise<any> }} store  e.g. a @canopy/vault
 * @param {string} [key]   vault key under which the keypair is stored
 */
export function createMemberSealingIdentity({ store, key = DEFAULT_KEY } = {}) {
  if (!store || typeof store.get !== 'function' || typeof store.set !== 'function') {
    throw new Error('createMemberSealingIdentity: a store with get/set (e.g. a Vault) is required');
  }

  /** Load the member's sealing keypair, generating + persisting one on first use. Returns {publicKey, privateKey, recipientId}. */
  async function ensure() {
    const existing = await store.get(key);
    const parsed = coerce(existing);
    if (parsed) return parsed;
    const kp = generateKeypair();
    await store.set(key, JSON.stringify(kp));
    return kp;
  }

  return {
    ensure,
    /** The sealing PUBLIC key (b64url) to publish to the roster — never exposes the private key. */
    async publicKey() { return (await ensure()).publicKey; },
    /** The roster entry shape the control-agent consumes: `{ webId, publicKey }`. */
    async rosterEntry(webId, role = 'member') {
      if (!webId) throw new Error('rosterEntry: webId required');
      return { webId: String(webId), publicKey: await this.publicKey(), role };
    },
  };
}

function coerce(stored) {
  if (!stored) return null;
  let o = stored;
  if (typeof stored === 'string') { try { o = JSON.parse(stored); } catch { return null; } }
  return o && typeof o.publicKey === 'string' && typeof o.privateKey === 'string' ? o : null;
}
