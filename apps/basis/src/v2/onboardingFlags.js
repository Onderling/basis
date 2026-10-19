/**
 * onboardingFlags — the two one-time first-run booleans, shared web ↔ mobile.
 *
 * There was no existing first-run flag; this establishes it. Two markers:
 *   - `helpCircleProvisioned` — the help circle + Onderling-bot were provisioned once
 *     (guards `provisionHelpCircle` so it never double-provisions).
 *   - `onboardingDone` — the guided onboarding conversation ran to its end, so it
 *     doesn't replay (the help circle + bot stay as a standing chat regardless).
 *
 * A tiny pluggable store over injectable IO (mirrors relayPref.js / themePref.js):
 * localStorage on web, AsyncStorage on mobile. Pure decision logic + per-platform IO
 * adapters, so it's unit-testable off-platform.
 */

export const HELP_CIRCLE_PROVISIONED_KEY = 'cc.helpCircleProvisioned';
export const ONBOARDING_DONE_KEY = 'cc.onboardingDone';
/** Vandaag's onboarding strip: the "Nieuw bij Basis?" card was seen (read or put away) on this device. */
export const INTRO_CARD_SEEN_KEY = 'cc.introCardSeen';

/**
 * A boolean-flag store over an injectable io (`{ get(key), set(key, '1') }`). `get`
 * returns the stored string (or null); any truthy stored value reads as `true`.
 *
 * @param {{ get?: (k:string)=>any, set?: (k:string,v:string)=>any }} [io]
 */
export function createOnboardingFlags(io = {}) {
  const read = async (key) => {
    try { return !!(await io.get?.(key)); } catch { return false; }
  };
  const write = async (key) => {
    try { await io.set?.(key, '1'); } catch { /* best-effort persist */ }
  };
  return {
    isHelpCircleProvisioned: () => read(HELP_CIRCLE_PROVISIONED_KEY),
    markHelpCircleProvisioned: () => write(HELP_CIRCLE_PROVISIONED_KEY),
    isOnboardingDone: () => read(ONBOARDING_DONE_KEY),
    markOnboardingDone: () => write(ONBOARDING_DONE_KEY),
    isIntroSeen: () => read(INTRO_CARD_SEEN_KEY),
    markIntroSeen: () => write(INTRO_CARD_SEEN_KEY),
  };
}

/** localStorage-backed IO (web). */
export function localStorageOnboardingIo(storage = globalThis.localStorage) {
  return {
    get: (k) => { try { return storage?.getItem(k) ?? null; } catch { return null; } },
    set: (k, v) => { try { storage?.setItem(k, v); } catch { /* private mode / quota */ } },
  };
}

/** AsyncStorage-backed IO (mobile). Pass the `@react-native-async-storage/async-storage` instance. */
export function asyncStorageOnboardingIo(AsyncStorage) {
  return {
    get: async (k) => { try { return (await AsyncStorage?.getItem(k)) ?? null; } catch { return null; } },
    set: async (k, v) => { try { await AsyncStorage?.setItem(k, v); } catch { /* best-effort */ } },
  };
}
