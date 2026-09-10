/**
 * The shell's handle on the device's content-at-rest key.
 *
 * `realAgent` mints the key at boot (it is the only place that holds the sealed vault it lives in), but the
 * stores that need it are built in the SHELLS: the web app constructs its search index at module scope,
 * and both shells build a circle's item store the moment a circle is opened. So the key is PUBLISHED here
 * at boot and READ lazily at first use — which works because every backend call is already async.
 *
 * One shared source, so web and mobile seal by construction rather than by both remembering to (invariant
 * #2/#3). A store wrapped through `sealedLocalBackend` is sealed on both platforms or on neither, and the
 * guard that keeps it that way greps for exactly this call.
 *
 * ── Why a module-level holder is right HERE and would be wrong in the agent ─────────────────────────
 * A shell is one app instance with one person and one key, so "the current device's content key" is a
 * genuinely global fact for it. The AGENT deliberately does not read this: it takes its strategy as a
 * local value, because a test process routinely boots several agents and a shared holder would hand the
 * second one's key to the first one's stores. Shells never do that; test processes always do.
 */
import { createSealingBackend, PLAINTEXT_AT_REST } from '@onderling/pseudo-pod';

let current = null;

/**
 * Publish this device's content-seal strategy. Called once by `realAgent` during boot.
 * @param {{seal:Function, open:Function}|null} strategy
 */
export function setShellContentSeal(strategy) {
  if (strategy === PLAINTEXT_AT_REST) { current = PLAINTEXT_AT_REST; return; }   // the person opted out
  current = (strategy && typeof strategy.seal === 'function' && typeof strategy.open === 'function') ? strategy : null;
}

/** This device's content-seal strategy, or null before boot has reached it. */
export function shellContentSeal() {
  return current;
}

/**
 * Wrap a local StorageBackend so what it writes is sealed at rest.
 *
 * Use this at EVERY local backend construction in a shell — the circle item store, the search index, the
 * device-log snapshot, the circle cache. It is deliberately the same call on both platforms so a reviewer
 * can see at a glance which stores are covered and a guard can prove it.
 *
 * @param {object} backend  a `StorageBackend` (IndexedDB on web, AsyncStorage on mobile, memory in tests)
 * @returns {object} the same port, sealed
 */
export function sealedLocalBackend(backend) {
  return createSealingBackend({ backend, getStrategy: () => shellContentSeal() });
}
