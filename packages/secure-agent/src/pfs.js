/**
 * @onderling/secure-agent — Perfect Forward Secrecy (partial Double-Ratchet).
 *
 * Wires A.8 from the v0.7 security roadmap.
 *
 * # What this DOES provide
 *
 * **Symmetric ratchet.**  Per-peer KDF chain advances by one HKDF
 * step on every send + every receive.  Each message gets a fresh
 * one-time `messageKey`.  Old messageKeys are deleted immediately
 * after use.
 *
 * Result: **forward secrecy against chain-state compromise**.  If
 * an attacker steals today's chain state, they cannot decrypt
 * yesterday's messages — the HKDF chain is one-way.
 *
 * # What this DOES NOT provide
 *
 * **No DH ratchet.**  The chain is seeded once from a static DH
 * (peer identity Curve25519 keys).  If an attacker steals an
 * identity private key, they can:
 *   - Recompute the initial chain seed (DH over public keys)
 *   - Replay the HKDF chain forward from there
 *   - Decrypt every message that has ever been sent on that chain
 *
 * Closing this gap requires a DH ratchet (Signal Double-Ratchet
 * proper) which needs piggybacking ephemeral keys on each outbound
 * message + new chain re-seeding when the peer's ephemeral changes.
 * That requires a transport-protocol change and is left for a
 * future slice (call it S8b).
 *
 * # Out-of-order tolerance
 *
 * Messages may arrive out of order (UDP-like).  We cache derived
 * messageKeys for any skipped sequence numbers (up to maxSkip).
 * Past-deletion-after-use is honoured — once a skipped key has been
 * consumed, it's dropped from the cache.
 *
 * # Wire format (per message)
 *
 *   {
 *     n:     <sequence-number-from-sender>,
 *     nonce: <24 random bytes, base64url>,
 *     ct:    <secretbox ciphertext, base64url>
 *   }
 *
 * The sequence number `n` is the SENDER'S count — receiver uses it
 * to skip forward through their own chain to find the matching key.
 *
 * Layer: substrate.  Platform-neutral.  Uses XSalsa20-Poly1305
 * (nacl.secretbox via AgentIdentity.secretbox) + HKDF-SHA256.
 */

import { AgentIdentity, b64encode, b64decode } from '@onderling/core';
import { hkdf }   from '@noble/hashes/hkdf.js';
import { sha256 } from '@noble/hashes/sha2.js';

export const PFS_VERSION  = 1;
// Key-derivation salt (hashed, invisible). Clean break pre-launch: anything sealed under the old
// salt no longer opens — accepted, there is nothing live (CLAUDE.md 2026-07-28).
export const PFS_SALT     = new TextEncoder().encode('onderling/secure-agent/pfs/v1');
export const DEFAULT_MAX_SKIP = 64;

/**
 * Build a per-peer PFSChain.  Both sides MUST be able to compute the
 * same chain seeds from the same pubkey-pair + static DH; the seed
 * derivation is symmetric (alphabetic ordering of pubkeys defines
 * which chain is "A→B" vs "B→A").
 *
 * @param {object} args
 * @param {AgentIdentity} args.identity         own identity (for DH + box-priv)
 * @param {string}        args.peerPubKey       peer's Ed25519 pubKey (base64url)
 * @param {number}        [args.maxSkip=64]     out-of-order tolerance
 * @param {object}        [args.vault]          persistence target
 * @param {string|null}   [args.vaultKey]       persistence slot
 * @returns {Promise<PFSChain>}
 */
export async function loadPFSChain(args = {}) {
  if (!args.identity?.pubKey || typeof args.identity.deriveSessionKey !== 'function') {
    throw new Error('loadPFSChain: identity with .deriveSessionKey() required');
  }
  if (typeof args.peerPubKey !== 'string' || !args.peerPubKey) {
    throw new Error('loadPFSChain: peerPubKey (string) required');
  }
  // Try to restore from vault first.
  if (args.vaultKey && args.vault) {
    try {
      const raw = await args.vault.get(args.vaultKey);
      if (raw) return PFSChain.restore(raw, args);
    } catch {
      // Corrupt slot → fall through to fresh init.
    }
  }
  return PFSChain.init(args);
}

export class PFSChain {
  #identity;
  #peerPubKey;
  #sendChainKey;   // Uint8Array(32)
  #recvChainKey;   // Uint8Array(32)
  #sendN  = 0;
  #recvN  = 0;
  #skipped = new Map();   // n → Uint8Array(32) messageKey
  #maxSkip;
  #vault;
  #vaultKey;

  constructor({ identity, peerPubKey, sendChainKey, recvChainKey, sendN, recvN, skipped, maxSkip, vault, vaultKey }) {
    this.#identity     = identity;
    this.#peerPubKey   = peerPubKey;
    this.#sendChainKey = sendChainKey;
    this.#recvChainKey = recvChainKey;
    this.#sendN        = sendN ?? 0;
    this.#recvN        = recvN ?? 0;
    this.#skipped      = skipped ?? new Map();
    this.#maxSkip      = maxSkip ?? DEFAULT_MAX_SKIP;
    this.#vault        = vault    ?? null;
    this.#vaultKey     = vaultKey ?? null;
  }

  static init({ identity, peerPubKey, maxSkip, vault, vaultKey }) {
    const shared = identity.deriveSessionKey(peerPubKey);       // 32 bytes
    // Direction assignment: by labeling chains with (from, to) pubkeys,
    // each peer's "send" chain naturally matches the other's "recv"
    // chain — no alphabetic flip needed.
    //
    //   A: send=chainSeed(s, A, B)  ←→  B: recv=chainSeed(s, A, B)
    //   B: send=chainSeed(s, B, A)  ←→  A: recv=chainSeed(s, B, A)
    return new PFSChain({
      identity, peerPubKey, maxSkip, vault, vaultKey,
      sendChainKey: _chainSeed(shared, identity.pubKey, peerPubKey),
      recvChainKey: _chainSeed(shared, peerPubKey,   identity.pubKey),
    });
  }

  static restore(jsonStr, opts) {
    const o = JSON.parse(jsonStr);
    return new PFSChain({
      identity:     opts.identity,
      peerPubKey:   opts.peerPubKey,
      sendChainKey: b64decode(o.sendChainKey),
      recvChainKey: b64decode(o.recvChainKey),
      sendN:        o.sendN,
      recvN:        o.recvN,
      skipped:      new Map((o.skipped ?? []).map(([n, k]) => [n, b64decode(k)])),
      maxSkip:      opts.maxSkip,
      vault:        opts.vault,
      vaultKey:     opts.vaultKey,
    });
  }

  get sendN() { return this.#sendN; }
  get recvN() { return this.#recvN; }
  get peerPubKey() { return this.#peerPubKey; }
  get skippedCount() { return this.#skipped.size; }

  /**
   * Encrypt a payload + advance the send chain by one step.
   * Returns the wire object — caller serializes/transmits.
   *
   * @param {string|Uint8Array} plaintext
   * @returns {Promise<{ n: number, nonce: string, ct: string }>}
   */
  async encrypt(plaintext) {
    const ptBytes = (plaintext instanceof Uint8Array)
      ? plaintext
      : new TextEncoder().encode(plaintext);
    const msgKey = _deriveMessageKey(this.#sendChainKey);
    this.#sendChainKey = _advanceChain(this.#sendChainKey);
    const n = this.#sendN++;
    const nonce = _randomBytes(24);
    const ct = AgentIdentity.secretbox(ptBytes, nonce, msgKey);
    await this.#persist();
    return {
      n,
      nonce: b64encode(nonce),
      ct:    b64encode(ct),
    };
  }

  /**
   * Decrypt a wire object + advance the receive chain to match its
   * sequence number.  Throws on unrecoverable error (bad ciphertext,
   * sequence too far ahead, missing skipped key).
   *
   * @param {{ n: number, nonce: string, ct: string }} wire
   * @returns {Promise<Uint8Array>}
   */
  async decrypt(wire) {
    if (!wire || typeof wire.n !== 'number') throw new Error('PFS decrypt: bad shape');
    const nonce = b64decode(wire.nonce);
    const ct    = b64decode(wire.ct);

    // Case 1: out-of-order — message N < recvN; look up cached key.
    if (wire.n < this.#recvN) {
      const cached = this.#skipped.get(wire.n);
      if (!cached) throw new Error(`PFS decrypt: replay or stale (n=${wire.n})`);
      const pt = AgentIdentity.secretunbox(ct, nonce, cached);
      if (!pt) throw new Error(`PFS decrypt: secretbox auth failed (n=${wire.n})`);
      this.#skipped.delete(wire.n);   // consume — past-deletion-after-use
      await this.#persist();
      return pt;
    }

    // Case 2: skipped-ahead — message N > recvN; cache intermediate keys.
    if (wire.n > this.#recvN) {
      const gap = wire.n - this.#recvN;
      if (gap > this.#maxSkip) {
        throw new Error(`PFS decrypt: sequence gap ${gap} > maxSkip ${this.#maxSkip}`);
      }
      while (this.#recvN < wire.n) {
        const k = _deriveMessageKey(this.#recvChainKey);
        this.#skipped.set(this.#recvN, k);
        this.#recvChainKey = _advanceChain(this.#recvChainKey);
        this.#recvN++;
        // Don't let the skipped cache grow unbounded; trim oldest first.
        if (this.#skipped.size > this.#maxSkip) {
          const oldestKey = this.#skipped.keys().next().value;
          this.#skipped.delete(oldestKey);
        }
      }
    }

    // Case 3: in-order — message N == recvN; derive + advance.
    const msgKey = _deriveMessageKey(this.#recvChainKey);
    this.#recvChainKey = _advanceChain(this.#recvChainKey);
    this.#recvN++;
    const pt = AgentIdentity.secretunbox(ct, nonce, msgKey);
    if (!pt) throw new Error(`PFS decrypt: secretbox auth failed (n=${wire.n})`);
    await this.#persist();
    return pt;
  }

  serialize() {
    return JSON.stringify({
      v: PFS_VERSION,
      peerPubKey:   this.#peerPubKey,
      sendChainKey: b64encode(this.#sendChainKey),
      recvChainKey: b64encode(this.#recvChainKey),
      sendN:        this.#sendN,
      recvN:        this.#recvN,
      skipped:      [...this.#skipped].map(([n, k]) => [n, b64encode(k)]),
    });
  }

  async #persist() {
    if (!this.#vaultKey || !this.#vault) return;
    await this.#vault.set(this.#vaultKey, this.serialize());
  }
}

// ── Private helpers ──────────────────────────────────────────────────

function _chainSeed(shared, fromPub, toPub) {
  const info = new TextEncoder().encode(`onderling-pfs|${fromPub}|${toPub}`);
  return hkdf(sha256, shared, PFS_SALT, info, 32);
}

function _advanceChain(chainKey) {
  return hkdf(sha256, chainKey, PFS_SALT, _ADVANCE_INFO, 32);
}

function _deriveMessageKey(chainKey) {
  return hkdf(sha256, chainKey, PFS_SALT, _MSGKEY_INFO, 32);
}

const _ADVANCE_INFO = new TextEncoder().encode('pfs|chain-advance');
const _MSGKEY_INFO  = new TextEncoder().encode('pfs|msg-key');

function _randomBytes(n) {
  const buf = new Uint8Array(n);
  globalThis.crypto.getRandomValues(buf);
  return buf;
}
