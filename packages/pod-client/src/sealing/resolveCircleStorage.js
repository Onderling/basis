// resolveCircleStorage.js — map a circle's storage POSTURE (the menukaart per-circle config, mirrors
// canopy-chat's `circlePolicy.storagePosture` enum) to a SealedPodClient strategy (HOW its content is
// sealed at rest), or null for plaintext. The companion to `resolveCircleLlm` for the storage axis.
//
//   p0 — trusted host / plaintext          → null (no client-side seal; use a plain PodClient)
//   p1 — TEE enclave (host-blind)          → null (sealing is the enclave's job, not a client wrap)
//   p2 — client-side E2E (group key)       → groupKeyStrategy({ groupKey })       [household default]
//   p3 — sealed at rest, opened to process → recipientStrategy({ recipients, privateKey })
//
// Fail-safe: returns null when the posture is plaintext/enclave OR the keys it needs aren't available,
// so the caller falls back to a plain client rather than ever sealing with missing material.

import { recipientStrategy, groupKeyStrategy, createSealedPodClient } from './SealedPodClient.js';

/**
 * @param {object} a
 * @param {'p0'|'p1'|'p2'|'p3'} a.posture
 * @param {string} [a.groupKey]                   for p2
 * @param {string|string[]} [a.recipients]        for p3 (seal)
 * @param {string} [a.privateKey]                 for p3 (open)
 * @returns {{seal:Function, open:Function}|null}  a SealedPodClient strategy, or null for plaintext
 */
export function resolveCircleStorage({ posture, groupKey, recipients, privateKey } = {}) {
  switch (posture) {
    case 'p2':
      return groupKey ? groupKeyStrategy({ groupKey }) : null;
    case 'p3': {
      const hasRecipients = Array.isArray(recipients) ? recipients.length > 0 : !!recipients;
      // a processor (private key, no recipients) can still OPEN; a writer (recipients) can SEAL.
      return (hasRecipients || privateKey) ? recipientStrategy({ recipients, privateKey }) : null;
    }
    case 'p0':
    case 'p1':
    default:
      return null;
  }
}

/**
 * Wrap a PodClient for a circle's posture: a SealedPodClient when the posture seals client-side, else
 * the plain client unchanged. One call for the circle's content read/write path.
 */
export function circleStorageClient(podClient, opts = {}) {
  const strategy = resolveCircleStorage(opts);
  return strategy ? createSealedPodClient(podClient, strategy) : podClient;
}
