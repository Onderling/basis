// The member's PERSONAL default LLM posture — their preference for private/business use. Consulted by
// `resolveCircleLlm` ONLY when a circle's policy is `'user'` ("user decides"); a circle that mandates
// (`local`/`cloud`) or forbids (`off`) ignores it. User-global (one per member/device, not per-circle),
// persisted via an injectable load/save: localStorage on web, AsyncStorage on mobile. Default `'off'`
// so a member never gets an LLM they didn't opt into.

const VALID_MODES = ['off', 'local', 'cloud'];
export const DEFAULT_USER_LLM = Object.freeze({ mode: 'off' });

/** Coerce any stored/raw value to a valid `{ mode }`; unknown/malformed → off. */
export function normalizeUserLlmDefault(raw) {
  const mode = raw && typeof raw.mode === 'string' && VALID_MODES.includes(raw.mode) ? raw.mode : 'off';
  return { mode };
}

/**
 * @param {{ load?: () => any|Promise<any>, save?: (v:{mode:string}) => void|Promise<void> }} [io]
 * @returns {{ get: () => Promise<{mode:string}>, set: (mode:string) => Promise<{mode:string}> }}
 */
export function createUserLlmDefaultStore({ load, save } = {}) {
  return {
    async get() {
      let raw = null;
      try { raw = load ? await load() : null; } catch { raw = null; }
      return normalizeUserLlmDefault(raw);
    },
    async set(mode) {
      const next = normalizeUserLlmDefault({ mode });
      if (save) { try { await save(next); } catch { /* best-effort persist */ } }
      return next;
    },
  };
}

const STORAGE_KEY = 'cc.userLlmDefault';

/** localStorage-backed IO (web). */
export function localStorageUserLlmIo(storage = globalThis.localStorage) {
  return {
    load: () => { try { const s = storage?.getItem(STORAGE_KEY); return s ? JSON.parse(s) : null; } catch { return null; } },
    save: (v) => { try { storage?.setItem(STORAGE_KEY, JSON.stringify(v)); } catch { /* ignore */ } },
  };
}

/** AsyncStorage-backed IO (mobile). Pass the `@react-native-async-storage/async-storage` instance. */
export function asyncStorageUserLlmIo(AsyncStorage) {
  return {
    load: async () => { try { const s = await AsyncStorage?.getItem(STORAGE_KEY); return s ? JSON.parse(s) : null; } catch { return null; } },
    save: async (v) => { try { await AsyncStorage?.setItem(STORAGE_KEY, JSON.stringify(v)); } catch { /* ignore */ } },
  };
}
