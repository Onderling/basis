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
/** The recovery phrase was written down (or photographed) on this device — the key card is done. */
export const KEY_SAVED_KEY = 'cc.mnemonicAck';
/** The key card was put away with "Later" until this moment (epoch ms, as a string). */
export const KEY_SNOOZED_UNTIL_KEY = 'cc.keyCardSnoozedUntil';

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
  const write = async (key, value = '1') => {
    try { await io.set?.(key, value); } catch { /* best-effort persist */ }
  };
  return {
    isHelpCircleProvisioned: () => read(HELP_CIRCLE_PROVISIONED_KEY),
    markHelpCircleProvisioned: () => write(HELP_CIRCLE_PROVISIONED_KEY),
    isOnboardingDone: () => read(ONBOARDING_DONE_KEY),
    markOnboardingDone: () => write(ONBOARDING_DONE_KEY),
    isIntroSeen: () => read(INTRO_CARD_SEEN_KEY),
    markIntroSeen: () => write(INTRO_CARD_SEEN_KEY),
    isKeySaved: () => read(KEY_SAVED_KEY),
    markKeySaved: () => write(KEY_SAVED_KEY),
    keySnoozedUntil: async () => {
      let v = null;
      try { v = await io.get?.(KEY_SNOOZED_UNTIL_KEY); } catch { v = null; }
      const n = Number(v);
      return Number.isFinite(n) ? n : 0;
    },
    snoozeKey: (untilMs) => write(KEY_SNOOZED_UNTIL_KEY, String(untilMs)),
  };
}

/**
 * Whether Vandaag's key card is due: the phrase is not saved on this device and no "Later" is still running. The card
 * only SAYS the key is not saved — the words open from its explicit "Toon", never by themselves.
 */
export async function keyCardPending(flags, now = Date.now()) {
  if (await flags.isKeySaved()) return false;
  return (await flags.keySnoozedUntil()) <= now;
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
