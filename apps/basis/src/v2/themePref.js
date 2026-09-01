/**
 * themePref — the display-theme preference contract, shared web ↔ mobile.
 *
 * One vocabulary + one storage key so the two platforms can't drift:
 *   'system' (default) — follow the OS scheme (prefers-color-scheme / useColorScheme)
 *   'light' / 'dark'   — an explicit override that wins over the OS
 *
 * Web persists this as localStorage['basis.theme'] (a pre-paint hook stamps
 * document.documentElement.dataset.theme; 'system' removes the key so the OS
 * media query wins). Mobile persists the SAME key via AsyncStorage and resolves
 * it in the theme context. `resolveThemeName` is the one pure decision both
 * platforms share.
 *
 * Pure + a tiny pluggable store (mirrors surfacePref.js / relayPref.js), so the
 * resolve logic is unit-testable off-platform.
 */

export const THEME_PREFS = Object.freeze(['system', 'light', 'dark']);
export const DEFAULT_THEME_PREF = 'system';
// The shared storage key. Web reads/writes it on localStorage; mobile on
// AsyncStorage. Same string ⇒ one contract (a device that syncs prefs across a
// web+mobile install lands on the same choice by construction).
// pre-boot cache of display.theme
export const THEME_PREF_KEY = 'basis.theme';

/** Normalize an arbitrary value to a known preference. */
export function normalizeThemePref(value) {
  return THEME_PREFS.includes(value) ? value : DEFAULT_THEME_PREF;
}

/**
 * Pure resolve: which concrete theme NAME ('light' | 'dark') applies, given the
 * user's preference and the live OS scheme. 'system' follows the OS; an explicit
 * light/dark override wins. Mirrors web exactly (data-theme override else the
 * prefers-color-scheme fallback).
 *
 * @param {string} pref      'system' | 'light' | 'dark'
 * @param {string} osScheme  'light' | 'dark' | null/undefined (the live OS scheme)
 * @returns {'light'|'dark'}
 */
export function resolveThemeName(pref, osScheme) {
  const p = normalizeThemePref(pref);
  if (p === 'light') return 'light';
  if (p === 'dark') return 'dark';
  return osScheme === 'dark' ? 'dark' : 'light';
}

/**
 * A tiny preference store over an injectable io (`{get, set}` of a string).
 * Web passes a localStorage io; mobile an AsyncStorage io. Synchronous get with
 * a cached value + async hydrate keeps first paint non-blocking (defaults to
 * 'system' until hydrate resolves).
 */
export function createThemePrefStore(io = {}) {
  let cached = DEFAULT_THEME_PREF;
  return {
    /** Current preference (cached; call hydrate() once at boot to load). */
    get: () => cached,
    /** Load from the backing io (best-effort). */
    async hydrate() {
      try { cached = normalizeThemePref(await io.get?.()); } catch { /* keep default */ }
      return cached;
    },
    /** Persist + update the cache. */
    async set(value) {
      cached = normalizeThemePref(value);
      try { await io.set?.(cached); } catch { /* best-effort */ }
      return cached;
    },
  };
}

/**
 * RN AsyncStorage io for the theme preference. Writes 'light'/'dark' and CLEARS
 * the key on 'system' — parity with web's `localStorage.removeItem` so the
 * default reads back as 'system' (an absent key = follow the OS).
 */
export function asyncStorageThemePrefIo(AsyncStorage, key = THEME_PREF_KEY) {
  return {
    get: async () => { try { return await AsyncStorage?.getItem(key); } catch { return null; } },
    set: async (v) => {
      try {
        if (v == null || v === 'system') await AsyncStorage?.removeItem(key);
        else await AsyncStorage?.setItem(key, v);
      } catch { /* best-effort */ }
    },
  };
}
