/**
 * V0 web storage for extension mappings (feedback-extension P2c).
 *
 * A localStorage adapter that satisfies the SUBSET of the pseudo-pod contract
 * that `@onderling/pod-routing` `loadMappings`/`writeMapping`/`removeMapping` use:
 * `list(containerUri)` · `read(uri)` · `write(uri, body)` · `delete(uri)`, with
 * keys == URIs (matching pseudo-pod's `_keyForUri` identity). This lets the web
 * app load+install extensions today, mirroring how circle policy + the LLM
 * default already persist to localStorage.
 *
 * `loadMappings` is store-agnostic, so swapping this for a real pseudo-pod when
 * the web pod layer (3.3c) lands is a one-line change at the call site.
 */

/** The package's own default namespace; an app passes its own name (`{ prefix }`). JSON is stored under prefix + <uri>. */
export const DEFAULT_MAPPINGS_PREFIX = 'onderling.mappings:';

/** The fixed V0 device id for web mappings (app-scoped; no real pod yet). */
export const WEB_MAPPINGS_DEVICE = 'web';

export function localStorageMappingsStore(storage = globalThis.localStorage, { prefix: PREFIX = DEFAULT_MAPPINGS_PREFIX } = {}) {
  const keyFor = (uri) => PREFIX + uri;
  return {
    // awaited: the web hands a SEALED storage (ledger L1083), which answers async
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
      const out = [];
      for (let i = 0; i < storage.length; i += 1) {
        const k = storage.key(i);
        if (k && k.startsWith(full)) out.push(k.slice(PREFIX.length));   // strip namespace → the bare URI
      }
      out.sort();
      return out;
    },
    async delete(uri) {
      await storage.removeItem(keyFor(uri));
    },
  };
}
