/**
 * A statement a person's DEVICE signs for a party outside their own devices — a companion node they own — to check.
 *
 * Every device of a person holds the profile key (a revoked one too), so a party that must tell the person's devices
 * apart, and refuse a revoked one, cannot go by that key. It goes by the device's DELEGATION key instead: the
 * statement is signed by it, and the device's root-signed delegation travels alongside, so the receiver verifies the
 * whole chain on its own — the delegation under the owner root, the statement under the delegation's key — and
 * learns which root the device speaks for. Which root it ACCEPTS, which devices it has seen revoked, and which
 * nonces it has already seen are the receiver's to keep.
 *
 * The signature covers the domain, the receiver, the op, the op's arguments, a nonce and the time, so a statement
 * made for one op on one node stands for nothing else and cannot be replayed outside its window.
 */
import { sha256 } from '@noble/hashes/sha2.js';
import { AgentIdentity } from './AgentIdentity.js';
import { verifyDeviceDelegation } from './deviceDelegation.js';
import { encode as b64encode } from '../crypto/b64.js';

/** The domains a device statement is made for — one string both ends share. */
export const STATEMENT_DOMAINS = Object.freeze({
  /** managing a companion node the person owns (claim it, read its status, revoke a device, pair a browser) */
  COMPANION_MANAGE: 'companion-manage',
});

/** How far a statement's time may sit from the receiver's clock. */
export const DEVICE_STATEMENT_WINDOW_MS = 5 * 60 * 1000;

/** JSON with its object keys sorted, so both ends hash the same arguments the same way. */
function stable(v) {
  if (Array.isArray(v)) return `[${v.map(stable).join(',')}]`;
  if (v && typeof v === 'object') {
    return `{${Object.keys(v).sort().filter((k) => v[k] !== undefined).map((k) => `${JSON.stringify(k)}:${stable(v[k])}`).join(',')}}`;
  }
  return JSON.stringify(v ?? null);
}
const hex = (bytes) => [...bytes].map((b) => b.toString(16).padStart(2, '0')).join('');
/** The hash of an op's arguments as the statement binds them. */
export const argsHashOf = (args) => hex(sha256(new TextEncoder().encode(stable(args ?? {}))));

/** The canonical text a device signs. */
export function deviceStatementMessage({ domain, node, op, argsHash, nonce, ts }) {
  return `onderling-device-statement-v1|${domain}|${node}|${op}|${argsHash}|${nonce}|${ts}`;
}

const randomNonce = () => {
  const b = new Uint8Array(16);
  globalThis.crypto.getRandomValues(b);
  return hex(b);
};

/**
 * Sign a statement with the device's delegation key.
 * @param {object} a
 * @param {string} a.domain          what kind of statement (e.g. 'companion-manage')
 * @param {string} a.node            the receiver's address
 * @param {string} a.op              the op it authorises
 * @param {object} [a.args]          the op's arguments, bound by hash
 * @param {object} a.delegation      this device's root-signed delegation record
 * @param {(message: string) => Uint8Array|string} a.sign   signs with the delegation key (an AgentIdentity's `sign`)
 * @param {() => number} [a.now]
 * @param {string} [a.nonce]
 */
export function signDeviceStatement({ domain, node, op, args = {}, delegation, sign, now = Date.now, nonce = randomNonce() }) {
  if (!domain || !node || !op) throw new Error('signDeviceStatement: domain, node and op are required');
  if (!delegation?.pubKey) throw new Error('signDeviceStatement: the device delegation is required');
  if (typeof sign !== 'function') throw new Error('signDeviceStatement: sign is required');
  const ts = now();
  const argsHash = argsHashOf(args);
  const raw = sign(deviceStatementMessage({ domain, node, op, argsHash, nonce, ts }));
  const sig = typeof raw === 'string' ? raw : b64encode(raw);
  return { v: 1, domain, node, op, argsHash, nonce, ts, delegation, sig };
}

/**
 * The receiver's memory of nonces it has accepted, for as long as a statement could still be fresh: a nonce seen
 * inside the window is a replay. Old ones are forgotten as the window moves on.
 * @param {{windowMs?: number, now?: () => number}} [a]
 */
export function createNonceWindow({ windowMs = DEVICE_STATEMENT_WINDOW_MS, now = Date.now } = {}) {
  const seen = new Map();   // nonce → ts
  const prune = () => { const floor = now() - 2 * windowMs; for (const [n, t] of seen) if (t < floor) seen.delete(n); };
  return {
    has: (nonce) => { prune(); return seen.has(nonce); },
    add: (nonce, ts) => { seen.set(nonce, ts); },
  };
}

/**
 * Verify a statement against what the receiver expects. Deny-by-default; says WHY it refused. In order: the
 * statement is for this domain, this node and this op; its device is not one the receiver holds revoked; its time is
 * inside the window and its nonce unseen; the arguments are the ones the op received; the delegation is signed by
 * the expected root and names the signer; the statement's signature is that device's. An accepted nonce is
 * remembered, so the same statement is refused the second time.
 * @param {object} statement
 * @param {object} expect
 * @param {string} expect.domain
 * @param {string} expect.node        the receiver's own address
 * @param {string} expect.op
 * @param {object} [expect.args]      the arguments the op received
 * @param {string|null} [expect.root] the owner root's pubKey the delegation must be signed by (null: any — a claim)
 * @param {(deviceId: string) => boolean} [expect.isRevoked]   the receiver's root-signed tombstones
 * @param {{has: (n: string) => boolean, add: (n: string, ts: number) => void}} [expect.nonces]  `createNonceWindow`
 * @param {() => number} [expect.now]
 * @param {number} [expect.windowMs]
 * @returns {{ok: true, root: string, deviceId: string, devicePubKey: string, nonce: string, ts: number}
 *          | {ok: false, reason: string}}
 */
export function verifyDeviceStatement(statement, {
  domain, node, op, args = {}, root = null, isRevoked = null, nonces = null, now = Date.now, windowMs = DEVICE_STATEMENT_WINDOW_MS,
} = {}) {
  const s = statement;
  if (!s || typeof s !== 'object' || s.v !== 1) return { ok: false, reason: 'no-statement' };
  if (s.domain !== domain || s.node !== node || s.op !== op) return { ok: false, reason: 'not-for-this' };
  const rec = s.delegation;
  if (!rec || typeof rec !== 'object' || typeof rec.deviceId !== 'string') return { ok: false, reason: 'bad-delegation' };
  if (typeof isRevoked === 'function' && isRevoked(rec.deviceId)) return { ok: false, reason: 'revoked' };
  if (typeof s.ts !== 'number' || Math.abs(now() - s.ts) > windowMs) return { ok: false, reason: 'stale' };
  if (typeof s.nonce !== 'string' || s.nonce.length < 16) return { ok: false, reason: 'no-nonce' };
  if (nonces?.has(s.nonce)) return { ok: false, reason: 'replayed' };
  if (s.argsHash !== argsHashOf(args)) return { ok: false, reason: 'args-differ' };
  if (!verifyDeviceDelegation(rec, root)) return { ok: false, reason: root ? 'not-this-owner' : 'bad-delegation' };
  let good = false;
  try { good = AgentIdentity.verify(deviceStatementMessage(s), s.sig, rec.pubKey); } catch { good = false; }
  if (!good) return { ok: false, reason: 'bad-signature' };
  nonces?.add(s.nonce, s.ts);
  return { ok: true, root: rec.by, deviceId: rec.deviceId, devicePubKey: rec.pubKey, nonce: s.nonce, ts: s.ts };
}
