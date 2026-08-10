/**
 * settingsRestoreGate — probe-before-flush for the parameter register's pod settings (review finding 3).
 *
 * ── The clobber this prevents ────────────────────────────────────────────────────────────────────────
 * On sign-in, `realAgent` attaches the self-sealed pod medium to the settings store via
 * `CachingDataSource.attachInner`, which BULK-FLUSHES every local settings entry to the pod. The owner root
 * is local-only (derived from the recovery phrase, not restored from the pod), so a fresh install signed into
 * the same pod WITHOUT the phrase derives a DIFFERENT sealing key. Its medium seals under that new key, and the
 * flush silently OVERWRITES the owner's existing sealed blobs. No plaintext leak, but a first-write-before-
 * recover clobbers the user's portable settings.
 *
 * ── The gate ─────────────────────────────────────────────────────────────────────────────────────────
 * Before the flushing attach, PROBE the owner-portable blob (`shared.json`) read-only and classify the outcome.
 * Only `openable` (this device holds the key, or the blob is legacy-unsealed) and `missing` (no blob yet — a
 * fresh/first device) are safe to attach + flush. An `undecryptable` blob (sealed under a different key) means
 * HOLD: stay local, never overwrite, surface the recover-or-overwrite choice. Gate the write on being able to
 * open — never a silent write (Frits-confirmed 2026-08-10).
 *
 * ── The discrimination crux (Frits-confirmed) ───────────────────────────────────────────────────────
 * The sealed source's `read` throws on BOTH a decrypt failure AND a transient pod error, so the gate MUST tell
 * them apart or it would gate a legitimate device into local-only on a network hiccup — and, worse, falsely
 * accuse a key mismatch. Every sealing-layer open failure is namespaced `sealing:` (envelope.js:
 * `secretbox open failed`, `not a recipient`, …); a transport failure (fetch / 5xx) is not, and a 404 has
 * already become `null` (= missing) upstream. So `sealing:` ⇒ `undecryptable`; anything else ⇒ `transport`,
 * which HOLDS this session WITHOUT declaring a mismatch and retries next sign-in.
 */

/** The owner-portable (agent-scope) settings blob — the one sealed to the owner-derived key, so a wrong-key
 *  device cannot open it. Mirrors `@onderling/local-store` Settings.js `SHARED_PATH` for appId 'basis'. */
export const SETTINGS_SHARED_PROBE_PATH = 'mem://basis/settings/shared.json';

/** A sealing-layer open failure is namespaced `sealing:` (envelope.js). Everything else (pod fetch / 5xx) is
 *  transport — NOT a key mismatch, so it must never be treated as one. */
export const isSealingOpenFailure = (err) =>
  typeof err?.message === 'string' && err.message.startsWith('sealing:');

/**
 * Probe whether THIS device can open the pod's owner-sealed settings, WITHOUT writing anything.
 *
 * @param {{ read: (path: string) => Promise<any> }} medium  the self-sealed pod settings medium
 * @param {string} [path]  the blob to probe (defaults to the owner-portable shared.json)
 * @returns {Promise<'openable'|'missing'|'undecryptable'|'transport'>}
 *   - `openable`      read returned a value → this device holds the key (or the blob is legacy-unsealed) → SAFE
 *   - `missing`       read returned null → no blob yet (fresh / first device) → SAFE
 *   - `undecryptable` a `sealing:` open failure → blob sealed under a DIFFERENT key → HOLD + surface mismatch
 *   - `transport`     any other failure (pod unreachable / 5xx) → could not verify → HOLD, do NOT accuse
 */
export async function probeSettingsMedium(medium, path = SETTINGS_SHARED_PROBE_PATH) {
  if (!medium || typeof medium.read !== 'function') return 'transport';
  try {
    const value = await medium.read(path);
    return value == null ? 'missing' : 'openable';
  } catch (err) {
    return isSealingOpenFailure(err) ? 'undecryptable' : 'transport';
  }
}

/** Whether a probe status means the flushing attach is safe to proceed. */
export const isProbeSafeToAttach = (status) => status === 'openable' || status === 'missing';
