/**
 * @onderling/pseudo-pod — Solid-shaped local store substrate.
 *
 * V0 (Phase 52.2): standalone + replication-ring modes.
 * V1 (Phase 52.8): cache mode (write-through queue + read-miss-through)
 *                  + per-URI mode overrides.
 *
 * See:
 *   - `Project Files/Substrates/substrates-v2-coding-plan-2026-05-11.md` §52.2 + §52.8
 *   - `Project Files/Substrates/substrates-v2-functional-design-2026-05-11.md` §4.1
 */

export { createPseudoPod, PSEUDO_POD_MODES } from './src/PseudoPod.js';
export { createMemoryBackend }      from './src/MemoryBackend.js';
export { createWriteThroughQueue, QUEUE_PREFIX as WRITE_THROUGH_QUEUE_PREFIX }
                                    from './src/writeThroughQueue.js';
// (sync-engine → pseudo-pod absorption): adapt a cache-mode
// PseudoPod into the podClient surface @onderling/sync-engine consumes.
export { createSyncEnginePodClient } from './src/syncEngineAdapter.js';

// NOTE: the persistent Node fs backend is deliberately NOT exported
// here — it imports `node:fs` and would poison browser/RN bundles that
// only want the portable surface. Import it from the dedicated subpath
// instead:  import { createNodeFsBackend } from '@onderling/pseudo-pod/node'
//
// Likewise the browser IndexedDB backend — platform-specific (it needs
// `globalThis.indexedDB`) — is exported from its own subpath, keeping
// the portable main surface free of any platform coupling:
//   import { createIndexedDbBackend } from '@onderling/pseudo-pod/browser'
export { createSealingBackend } from './src/SealingBackend.js';
