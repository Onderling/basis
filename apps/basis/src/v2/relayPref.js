// The member's IN-APP relay URL — so the cross-peer relay (packages/relay) can be pointed at a reachable
// server from the SETTINGS UI, not only the build-time env var (VITE_/EXPO_PUBLIC_CIRCLE_RELAY_URL). One
// per member/device (user-global, not per-circle), persisted via an injectable load/save: localStorage on
// web, AsyncStorage on mobile. Empty ⇒ fall back to the env var (`resolveRelayUrl`), so existing installs
// with the env set are unchanged and a fresh install can configure the relay without a rebuild.
//
// Mirrors the userLlmDefault store shape (createStore + per-platform IO adapters) so the two settings feel
// the same in the Mij/My-data screen.

import { param, PARAM_SCOPE, PARAM_KIND } from '@onderling/item-store';

// pre-boot cache of relay.url
const STORAGE_KEY = 'cc.relayUrl';

/**
 * The relay a person's device dials when nothing else names one — the public relay. The LAST candidate: a saved or
 * build-time relay wins, and at boot so does a relay a circle recorded (`bootRelayUrl`'s `fallback`). INTERNAL: a person
 * already chooses their relay through `relay.url` (the saved setting, the first candidate) — a second user knob for the
 * same fact would be two answers to one question. The box does not use it: a headless node dials only what its
 * operator set.
 */
export const DEFAULT_RELAY_URL = param({ key: 'relay.defaultUrl', scope: PARAM_SCOPE.DEVICE, kind: PARAM_KIND.INTERNAL, default: 'wss://relay.onderling.org' });

/** Coerce raw input to a valid ws://|wss:// relay URL, or '' (blank ⇒ use the env fallback). */
export function normalizeRelayUrl(raw) {
  const s = (typeof raw === 'string' ? raw : '').trim();
  if (!s) return '';
  // Accept only websocket schemes — the relay transport is a WebSocket broker.
  if (!/^wss?:\/\/.+/i.test(s)) return '';
  try {
    const u = new URL(s);
    if (u.protocol !== 'ws:' && u.protocol !== 'wss:') return '';
    return u.toString().replace(/\/$/, '');   // drop a trailing slash for stable comparison
  } catch { return ''; }
}

/**
 * The relay URL to actually use — the FIRST valid candidate in precedence order, else null. Each
 * candidate is normalized (ws://|wss:// or dropped). Variadic so the precedence chain can grow without a
 * refactor. Today's callers pass `(deviceSetting, envUrl)`; when circles can pin a relay (see
 * REMAINING-WORK "per-circle relay") the chain becomes `(circleRelay, deviceSetting, envUrl, discovered)`
 * — a circle's shared meeting-point relay wins over a member's personal default.
 * @param {...(string|null|undefined)} candidates  in precedence order (most-specific first)
 * @returns {string|null}
 */
export function resolveRelayUrl(...candidates) {
  for (const c of candidates) {
    const url = normalizeRelayUrl(c);
    if (url) return url;
  }
  return null;
}

/**
 * The relay actually in use for this device's saved setting and build-time env — `resolveRelayUrl` with the public
 * default as the last candidate. For the places that ADVERTISE or REPORT the relay (an invite link, the transport
 * state); the settings field keeps `resolveRelayUrl(saved, '')` so it shows only what was saved.
 */
export function effectiveRelayUrl(saved, envUrl) {
  return resolveRelayUrl(saved, envUrl, DEFAULT_RELAY_URL);
}

/**
 * @param {{ load?: () => any|Promise<any>, save?: (v:string) => void|Promise<void> }} [io]
 * @returns {{ get: () => Promise<string>, set: (url:string) => Promise<string> }}
 *   get/set the normalized relay URL string ('' = unset ⇒ env fallback).
 */
export function createRelayPrefStore({ load, save } = {}) {
  const read = async () => {
    let raw = null;
    try { raw = load ? await load() : null; } catch { raw = null; }
    return normalizeRelayUrl(raw);
  };
  return {
    get: read,
    async set(url) {
      const next = normalizeRelayUrl(url);
      if (save) { try { await save(next); } catch { /* best-effort persist */ } }
      return next;
    },
  };
}

/** localStorage-backed IO (web). */
export function localStorageRelayIo(storage = globalThis.localStorage) {
  return {
    load: () => { try { return storage?.getItem(STORAGE_KEY) ?? null; } catch { return null; } },
    save: (v) => { try { if (v) storage?.setItem(STORAGE_KEY, v); else storage?.removeItem(STORAGE_KEY); } catch { /* ignore */ } },
  };
}

/** AsyncStorage-backed IO (mobile). Pass the `@react-native-async-storage/async-storage` instance. */
export function asyncStorageRelayIo(AsyncStorage) {
  return {
    load: async () => { try { return (await AsyncStorage?.getItem(STORAGE_KEY)) ?? null; } catch { return null; } },
    save: async (v) => { try { if (v) await AsyncStorage?.setItem(STORAGE_KEY, v); else await AsyncStorage?.removeItem(STORAGE_KEY); } catch { /* ignore */ } },
  };
}
