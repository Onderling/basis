// Shared (web ≡ mobile) — the NO-LOGIN feedback pod set for the invite-circle / collector flow.
//
// Raw stays in the participant's OWN in-memory pod (Stage 1); a round-approved SUMMARY is released to the
// project's central pod via the companion collector (Stage 2); the PM opens verification rounds through the
// shared control store (also the collector). No Solid login — the participant signs with their agent
// identity and the collector is the authenticated server-side writer. Both shells (web `attachFeedbackProject`
// and mobile `FeedbackThreadScreen`) build the same pods here so the mechanism can't drift between them.
import { getFeedbackPackage } from './feedbackPackage.js';
import { makeHttpCollectorPod } from './httpCollectorPod.js';
import { makeHttpRoundControl } from './httpRoundControl.js';
import { makePersistentOwnPod } from './persistentPod.js';

/**
 * @param {object} [o]
 * @param {string|null} [o.collectorUrl]   companion collector base URL; null → own-pod only (no central route)
 * @param {string} [o.participantKey]      this device's agent pubkey (lets `centralPod.list()` read own records)
 * @param {object} [o.storage]             optional storage adapter (`{getItem,setItem}` — localStorage / AsyncStorage);
 *                                         when given with `podKey`, the OWN pod PERSISTS so consented Stage-1 survives a
 *                                         reload (consent + the verify-round approval no longer need to be one session).
 * @param {string} [o.podKey]              storage key for the persistent own pod (namespace per project / thread)
 * @returns {{ ownPod:(object|Promise<object>), centralPod:(object|null), controlStore:(object|null) }}
 */
export function makeNoLoginFeedbackPods({ collectorUrl = null, participantKey, storage, podKey } = {}) {
  // The package is loaded at the feedback door (see feedbackPackage.js); this factory only reads it.
  const { InMemoryCentralPod } = getFeedbackPackage();
  // Persistent own-pod when a storage adapter is supplied (a Promise — the surface resolves it); else in-memory
  // (unchanged behaviour, e.g. tests / no-storage shells).
  const ownPod = storage && podKey
    ? makePersistentOwnPod({ storage, key: podKey, make: () => new InMemoryCentralPod() })
    : new InMemoryCentralPod();
  if (!collectorUrl) return { ownPod, centralPod: null, controlStore: null };
  return {
    ownPod,
    centralPod: makeHttpCollectorPod(collectorUrl, { participantKey }),
    controlStore: makeHttpRoundControl(collectorUrl),
  };
}
