// A companion is CLAIMED by its owner, not configured with one.
//
// Started without an owner the node mints ONE claim code and prints it in its banner (the operator reads it from the
// node's log). The owner's app hands it back over the relay (`manage.claimOwner({code})`) in a statement signed by
// one of the person's DEVICES, with that device's root-signed delegation alongside; the node records the OWNER ROOT
// the delegation was signed by — in its own config dir, so a restart remembers. From then on any device of that root
// manages the node, and a device the root has revoked does not: the root-signed tombstones are kept here too. The
// code is single use, lasts ten minutes, and is burnt after a few wrong tries; a node with an owner mints no code
// and refuses any further claim.
import { randomBytes } from 'node:crypto';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { param, PARAM_SCOPE, PARAM_KIND } from '@onderling/core';

/** How long one claim code is good for. */
export const CLAIM_TTL_MS = param({ key: 'companion.claimCodeTtlMs', scope: PARAM_SCOPE.DEVICE, kind: PARAM_KIND.INTERNAL, default: 10 * 60 * 1000 });
/** Wrong tries a code takes before it is burnt. */
export const CLAIM_MAX_TRIES = param({ key: 'companion.claimCodeMaxTries', scope: PARAM_SCOPE.DEVICE, kind: PARAM_KIND.INTERNAL, default: 5 });

// 32 letters and digits a person reads off a log without mixing up (no 0/O, 1/I)
const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const mint = () => {
  const b = randomBytes(8);
  const s = [...b].map((x) => ALPHABET[x % ALPHABET.length]).join('');
  return `${s.slice(0, 4)}-${s.slice(4)}`;
};
/** A code as a person may type it: any case, with or without the dash or spaces. */
const norm = (c) => String(c ?? '').toUpperCase().replace(/[^A-Z0-9]/g, '');

/**
 * @param {object} a
 * @param {() => ({root: string, revoked?: string[]}|null)} a.load    the recorded owner, if any
 * @param {(record: {root: string, claimedAt: number, revoked: string[]}) => void} a.save
 * @param {() => number} [a.now]
 * @param {(code: string) => void} [a.onCode]   told each time a new code is minted (the banner / the log)
 */
export function createOwnerClaim({ load, save, now = Date.now, onCode = null } = {}) {
  let record = null;
  try {
    const r = load?.();
    if (r && typeof r.root === 'string' && r.root) record = { root: r.root, claimedAt: r.claimedAt ?? 0, revoked: Array.isArray(r.revoked) ? [...r.revoked] : [] };
  } catch { record = null; }
  let current = null;   // { code, at, tries }

  const fresh = () => {
    current = { code: mint(), at: now(), tries: 0 };
    try { onCode?.(current.code); } catch { /* the log is not the claim */ }
    return current.code;
  };
  const live = () => current && now() - current.at <= CLAIM_TTL_MS && current.tries < CLAIM_MAX_TRIES;

  return {
    /** The owner root's pubKey, or null while unclaimed. */
    owner: () => record?.root ?? null,
    /** The code to claim with — a fresh one when the last expired or was burnt — or null once owned. */
    code() {
      if (record) return null;
      return live() ? current.code : fresh();
    },
    /**
     * Claim the node for an owner root (the root the claiming device's delegation was VERIFIED to be signed by).
     * @returns {{ok: true} | {ok: false, error: 'already-owned'|'invalid-code'|'no-root'}}
     */
    claim({ code, root } = {}) {
      if (record) return { ok: false, error: 'already-owned' };
      if (typeof root !== 'string' || !root) return { ok: false, error: 'no-root' };
      if (!live()) { current = null; return { ok: false, error: 'invalid-code' }; }
      if (!code || norm(code) !== norm(current.code)) {
        current.tries += 1;
        return { ok: false, error: 'invalid-code' };
      }
      record = { root, claimedAt: now(), revoked: [] };
      save(record);
      current = null;
      return { ok: true };
    },
    /** Whether the owner root has revoked this device (a VERIFIED root-signed tombstone was delivered). */
    isRevoked: (deviceId) => !!record && record.revoked.includes(deviceId),
    /** Keep a verified tombstone. */
    revoke(deviceId) {
      if (!record || typeof deviceId !== 'string' || !deviceId) return false;
      if (!record.revoked.includes(deviceId)) { record.revoked.push(deviceId); save(record); }
      return true;
    },
  };
}

/** The owner's record as a file in the node's config dir. */
export function ownerFile(path) {
  return {
    load() {
      try { return JSON.parse(readFileSync(path, 'utf8')); } catch { return null; }
    },
    save(record) {
      mkdirSync(dirname(path), { recursive: true });
      writeFileSync(path, JSON.stringify(record), { mode: 0o600 });
    },
  };
}
