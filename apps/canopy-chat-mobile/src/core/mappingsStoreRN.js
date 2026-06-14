/**
 * V0 mobile storage for extension mappings (feedback-extension P2 mobile parity).
 *
 * The React-Native twin of web's `localStorageMappingsStore`: an AsyncStorage
 * adapter satisfying the SUBSET of the pseudo-pod contract that
 * `@canopy/pod-routing` `loadMappings`/`writeMapping`/`removeMapping` use —
 * `list(containerUri)` · `read(uri)` · `write(uri, body)` · `delete(uri)`, with
 * keys == URIs. So `loadMappings` drives it unchanged on mobile too.
 *
 * `storage` is injected (no top-level `@react-native-async-storage/async-storage`
 * import) so the module stays testable under node vitest — the composition root
 * passes the real `AsyncStorage`. Same pattern as `circleStoresRN.js`. Swap for a
 * real pseudo-pod when the mobile pod layer lands (P3 3.3c).
 */

const PREFIX = 'canopy.mappings:';   // AsyncStorage namespace; JSON stored under PREFIX + <uri>

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
      const raw = await storage.getItem(keyFor(uri));
      if (raw == null) return null;
      try { return { bytes: JSON.parse(raw) }; }
      catch { return { bytes: raw }; }
    },
    async list(containerUri) {
      const prefix = containerUri.endsWith('/') ? containerUri : `${containerUri}/`;
      const full = PREFIX + prefix;
      const keys = (await storage.getAllKeys()) || [];
      return keys.filter((k) => k && k.startsWith(full)).map((k) => k.slice(PREFIX.length)).sort();
    },
    async delete(uri) {
      await storage.removeItem(keyFor(uri));
    },
  };
}
