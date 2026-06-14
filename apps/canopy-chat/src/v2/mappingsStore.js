/**
 * V0 web storage for extension mappings (feedback-extension P2c).
 *
 * A localStorage adapter that satisfies the SUBSET of the pseudo-pod contract
 * that `@canopy/pod-routing` `loadMappings`/`writeMapping`/`removeMapping` use:
 * `list(containerUri)` · `read(uri)` · `write(uri, body)` · `delete(uri)`, with
 * keys == URIs (matching pseudo-pod's `_keyForUri` identity). This lets the web
 * app load+install extensions today, mirroring how circle policy + the LLM
 * default already persist to localStorage.
 *
 * `loadMappings` is store-agnostic, so swapping this for a real pseudo-pod when
 * the web pod layer (P3 3.3c) lands is a one-line change at the call site.
 */

const PREFIX = 'canopy.mappings:';   // localStorage namespace; we store JSON under PREFIX + <uri>

/** The fixed V0 device id for web mappings (app-scoped; no real pod yet). */
export const WEB_MAPPINGS_DEVICE = 'web';

export function localStorageMappingsStore(storage = globalThis.localStorage) {
  const keyFor = (uri) => PREFIX + uri;
  return {
    async write(uri, body) {
      storage.setItem(keyFor(uri), JSON.stringify(body));
      return { etag: undefined };
    },
    async read(uri) {
      const raw = storage.getItem(keyFor(uri));
      if (raw == null) return null;
      try { return { bytes: JSON.parse(raw) }; }
      catch { return { bytes: raw }; }
    },
    async list(containerUri) {
      const prefix = containerUri.endsWith('/') ? containerUri : `${containerUri}/`;
      const full = PREFIX + prefix;
      const out = [];
      for (let i = 0; i < storage.length; i += 1) {
        const k = storage.key(i);
        if (k && k.startsWith(full)) out.push(k.slice(PREFIX.length));   // strip namespace → the bare URI
      }
      out.sort();
      return out;
    },
    async delete(uri) {
      storage.removeItem(keyFor(uri));
    },
  };
}
