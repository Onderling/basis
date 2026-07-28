/**
 * V0 mobile storage for extension mappings (feedback-extension mobile parity).
 *
 * The React-Native twin of web's `localStorageMappingsStore`: an AsyncStorage
 * adapter satisfying the SUBSET of the pseudo-pod contract that
 * `@onderling/pod-routing` `loadMappings`/`writeMapping`/`removeMapping` use —
 * `list(containerUri)` · `read(uri)` · `write(uri, body)` · `delete(uri)`, with
 * keys == URIs. So `loadMappings` drives it unchanged on mobile too.
 *
 * `storage` is injected (no top-level `@react-native-async-storage/async-storage`
 * import) so the module stays testable under node vitest — the composition root
 * passes the real `AsyncStorage`. Same pattern as `circleStoresRN.js`. Swap for a
 * real pseudo-pod when the mobile pod layer lands (3.3c).
 */

const PREFIX = 'onderling.mappings:';   // AsyncStorage namespace; JSON stored under PREFIX + <uri>
// Naming migration 2026-07-29 — mappings persisted under the OLD prefix still resolve (an installed
// extension must not vanish on update). Reads fall back; writes/deletes use the new prefix only.
const LEGACY_PREFIX = 'canopy.mappings:';

/** The fixed V0 device id for mobile mappings (app-scoped; no real pod yet). */
export const MAPPINGS_DEVICE = 'mobile';

export function asyncStorageMappingsStore(storage) {
  const keyFor = (uri) => PREFIX + uri;
  return {
    async write(uri, body) {
      await storage.setItem(keyFor(uri), JSON.stringify(body));
      return { etag: undefined };
    },
    async read(uri) {
      const raw = (await storage.getItem(keyFor(uri))) ?? (await storage.getItem(LEGACY_PREFIX + uri));
      if (raw == null) return null;
      try { return { bytes: JSON.parse(raw) }; }
      catch { return { bytes: raw }; }
    },
    async list(containerUri) {
      const prefix = containerUri.endsWith('/') ? containerUri : `${containerUri}/`;
      const full = PREFIX + prefix;
      const keys = (await storage.getAllKeys()) || [];
      const legacyFull = LEGACY_PREFIX + prefix;
      const uris = keys
        .filter((k) => k && (k.startsWith(full) || k.startsWith(legacyFull)))
        .map((k) => (k.startsWith(PREFIX) ? k.slice(PREFIX.length) : k.slice(LEGACY_PREFIX.length)));
      return [...new Set(uris)].sort();
    },
    async delete(uri) {
      await storage.removeItem(keyFor(uri));
      // …and any legacy copy — else the dual-read resurrects what the user just removed.
      try { await storage.removeItem(LEGACY_PREFIX + uri); } catch { /* best-effort */ }
    },
  };
}
