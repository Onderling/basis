/**
 * basis-mobile v2 — AsyncStorage-backed circle stores (M3).
 *
 * The shared circle stores (`@onderling-app/basis`) take an injectable
 * `{ load, save }` IO; web wires localStorage, mobile wires AsyncStorage
 * here.  Keys match the web convention verbatim (`cc.circlePolicy.<id>`,
 * `cc.circleOverride.<id>`, `cc.availability`) so a future pod-sync sees
 * the same shape on both surfaces.
 *
 * Portable: `storage` is injected (no top-level AsyncStorage import), so
 * vitest exercises the round-trip with a mock and the RN screens pass the
 * real AsyncStorage instance.
 */
import {
  createCirclePolicyStore,
  createMemberOverrideStore,
  createAvailabilityStore,
  podPolicyIo, tieredPolicyIo,
  // Objective D — publish the availability pref to the shared substrate.
  podAvailabilityIo, tieredAvailabilityIo,
  // SILENT out-of-circle delivery — the per-user "shared with me" store (received sealed copies).
  createSharedWithMeStore, podSharedWithMeIo, tieredSharedWithMeIo,
  // multi-admin proposal persistence on RN.
  // α.1a — screen recipe book store.
  createCircleRecipeStore,
  // α.2 — per-user screens store.
  createUserScreenStore,
  // β.5 — per-user pin-to-top store.
  createCirclePinStore,
  // γ.2 — per-circle rules store factory (new in γ.2).
  createCircleRulesStore,
} from '@onderling-app/basis';
// γ.2 — concrete `versions` adapter wiring AsyncStorage.  Imported via
// the basis-mobile-local module that itself reaches into the
// basis package by relative path (Metro-friendly; same pattern
// as podStorage above).
import { asyncStorageObjectVersions } from './objectVersionsStorageRN.js';
// 5.4c — pod-writer build is also imported via relative path (Metro doesn't
// honour package.json "exports" subpaths; same pattern as podPeerAddr.js).
import {
  discoverPodRoot as _discoverPodRoot,
  createPodWriter as _createPodWriter,
} from '../../../basis/src/web/podStorage.js';

/** Per-id AsyncStorage IO: key = `${prefix}${id}`. */
export function asyncKeyedIo(prefix, storage) {
  return {
    load: async (id) => {
      try { const s = await storage.getItem(`${prefix}${id}`); return s ? JSON.parse(s) : null; }
      catch { return null; }
    },
    save: async (id, value) => {
      try { await storage.setItem(`${prefix}${id}`, JSON.stringify(value)); }
      catch { /* ignore */ }
    },
  };
}

/** Single-key AsyncStorage IO (keyless store, e.g. cross-circle availability). */
export function asyncFixedIo(key, storage) {
  return {
    load: async () => {
      try { const s = await storage.getItem(key); return s ? JSON.parse(s) : null; }
      catch { return null; }
    },
    save: async (value) => {
      try { await storage.setItem(key, JSON.stringify(value)); }
      catch { /* ignore */ }
    },
  };
}

/**
 * 5.4a — `getPodWriter` is an optional thunk returning a podWriter (or null).
 * Defaults to `null` so behaviour is unchanged until 5.4b wires a session.
 */
export function makeCirclePolicyStoreRN(storage, { getPodWriter } = {}) {
  const localIo = asyncKeyedIo('cc.circlePolicy.', storage);
  const podIo   = podPolicyIo({
    getWriter: typeof getPodWriter === 'function' ? getPodWriter : () => null,
    app: 'cc-circle',
  });
  // γ.2 — version capture wired ABOVE the tier so snapshots happen
  // regardless of whether the write lands in AsyncStorage or pod.
  const versions = asyncStorageObjectVersions('policy', storage);
  return createCirclePolicyStore({ ...tieredPolicyIo(localIo, podIo), versions });
}

export function makeMemberOverrideStoreRN(storage) {
  return createMemberOverrideStore(asyncKeyedIo('cc.circleOverride.', storage));
}

/**
 * Objective D (Surface 3a) — the availability pref stays device-local
 * (AsyncStorage, key `cc.availability`) BUT its value must be readable by
 * other agents, so it mirrors to a per-user pod resource via the shared
 * `tieredAvailabilityIo` (same pattern as the circle-policy store). Pass a
 * `getPodWriter` thunk (returning a `createPodWriter`-shaped writer, or
 * null) to publish; omit it and behaviour is local-only (unchanged).
 */
export function makeAvailabilityStoreRN(storage, { getPodWriter } = {}) {
  const localIo = asyncFixedIo('cc.availability', storage);
  const podIo   = podAvailabilityIo({
    getWriter: typeof getPodWriter === 'function' ? getPodWriter : () => null,
  });
  return createAvailabilityStore(tieredAvailabilityIo(localIo, podIo));
}

/**
 * SILENT out-of-circle delivery — the per-user "shared with me" store on RN. Received sealed copies stay
 * device-canonical (AsyncStorage, key `cc.sharedWithMe` — SAME key web uses) AND mirror to a per-user pod
 * resource via the shared `tieredSharedWithMeIo` (leak-safe: only sealed ciphertext + structural metadata),
 * so copies SURVIVE + SYNC across the user's devices. Pass a `getPodWriter` thunk (a `createPodWriter`-shaped
 * writer, or null) to publish; omit it and behaviour is local-only. Mirrors `makeAvailabilityStoreRN` exactly
 * (web≡mobile: the SAME tiered factory web wires in circleApp.js).
 */
export function makeSharedWithMeStoreRN(storage, { getPodWriter } = {}) {
  const localIo = asyncFixedIo('cc.sharedWithMe', storage);
  const podIo   = podSharedWithMeIo({
    getWriter: typeof getPodWriter === 'function' ? getPodWriter : () => null,
  });
  return createSharedWithMeStore(tieredSharedWithMeIo(localIo, podIo));
}

/**
 * Objective D — synchronous OidcSessionRN → podWriter for the availability
 * pref's `getPodWriter` thunk. Returns null (never throws) when the session
 * isn't ready/authed; uses `createPodWriter`'s webid-heuristic pod root (no
 * async discovery), which is enough to address the per-user resource. For a
 * discovered root, `buildCirclePodWriter` (async) is the fuller path.
 */
export function sessionToPodWriterRN(session) {
  if (!session || typeof session.isAuthenticated !== 'function') return null;
  if (!session.isAuthenticated() || !session.webid) return null;
  let fetchFn;
  try { fetchFn = session.getAuthenticatedFetch(); }
  catch { return null; }
  if (typeof fetchFn !== 'function') return null;
  try { return _createPodWriter({ fetch: fetchFn, webid: session.webid }); }
  catch { return null; }
}

/** α.1a — per-circle recipe book store (one book per circle; key:
 *  `cc.circleRecipe.<circleId>`).  γ.2 — version capture above storage. */
export function makeCircleRecipeStoreRN(storage) {
  const versions = asyncStorageObjectVersions('recipe', storage);
  return createCircleRecipeStore({
    io: asyncKeyedIo('cc.circleRecipe.', storage),
    versions,
  });
}

/** γ.2 — per-circle rules store (`cc.circleRules.<circleId>`) with
 *  version capture.  Was inline AsyncStorage in CircleLauncherScreen up
 *  to β; now goes through the shared store factory. */
export function makeCircleRulesStoreRN(storage) {
  const versions = asyncStorageObjectVersions('rules', storage);
  return createCircleRulesStore({
    ...asyncKeyedIo('cc.circleRules.', storage),
    versions,
  });
}

/** α.2 — per-user screens store (single book; key: `cc.userScreens`). */
export function makeUserScreenStoreRN(storage) {
  return createUserScreenStore({ io: asyncFixedIo('cc.userScreens', storage) });
}

/**
 * proposal store IO is `{ load(key), save(key, value) }` shaped
 * (different from the per-id stores); a small adapter passes the
 * caller-supplied key through to AsyncStorage verbatim.
 */
export function asyncRawIo(storage) {
  return {
    load: async (key) => {
      try { const s = await storage.getItem(key); return s ? JSON.parse(s) : null; }
      catch { return null; }
    },
    save: async (key, value) => {
      try { await storage.setItem(key, JSON.stringify(value)); }
      catch { /* ignore */ }
    },
  };
}


/** β.5 — per-user "pin to top" store (single key: `cc.circlePinned`). */
export function makeCirclePinStoreRN(storage) {
  return createCirclePinStore(asyncFixedIo('cc.circlePinned', storage));
}

/**
 * 5.4c — build a `createPodWriter`-shaped writer from the launcher's
 * shared `OidcSessionRN`, mirroring web/v2/circleApp.js's
 * `podAuth.handleRedirect → discoverPodRoot → createPodWriter` flow.
 *
 * Returns `null` (never throws) when the session isn't ready/authed or
 * any step fails — the caller stores that into `circlePodWriterRef.current`
 * and the `getPodWriter` thunk in `makeCirclePolicyStoreRN` falls
 * through to local-only IO.
 *
 * `deps` is injectable for tests: defaults to the real
 * `discoverPodRoot`/`createPodWriter` from `apps/basis/src/web/
 * podStorage.js`.
 *
 * @param {{ isAuthenticated: () => boolean, webid?: string|null, getAuthenticatedFetch: () => Function } | null} session
 * @param {{ discoverPodRoot?: Function, createPodWriter?: Function }} [deps]
 * @returns {Promise<object|null>}
 */
export async function buildCirclePodWriter(session, deps = {}) {
  const discoverPodRootFn = deps.discoverPodRoot ?? _discoverPodRoot;
  const createPodWriterFn = deps.createPodWriter ?? _createPodWriter;
  if (!session || typeof session.isAuthenticated !== 'function') return null;
  if (!session.isAuthenticated() || !session.webid) return null;
  let fetchFn;
  try { fetchFn = session.getAuthenticatedFetch(); }
  catch { return null; }
  if (typeof fetchFn !== 'function') return null;
  const sessionShim = { fetch: fetchFn, webid: session.webid };
  const podRoot = await discoverPodRootFn(sessionShim).catch(() => null);
  try {
    return createPodWriterFn(sessionShim, podRoot ? { podRoot } : {});
  } catch {
    return null;
  }
}
