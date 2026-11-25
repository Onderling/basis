// The member's PERSONAL default LLM posture — their preference for private/business use. Consulted by
// `resolveCircleLlm` ONLY when a circle's policy is `'user'` ("user decides"); a circle that mandates
// (`local`/`cloud`) or forbids (`off`) ignores it. User-global (one per member/device, not per-circle),
// persisted via an injectable load/save: localStorage on web, AsyncStorage on mobile. Default `'off'`
// so a member never gets an LLM they didn't opt into.
//
// The value carries the member's OWN endpoint config so they can point the assistant at their own LLM +
// embedder from the in-app settings (not just a build-time env var): `{ preset, llmBaseUrl, llmModel,
// embedBaseUrl, embedModel, apiKey, attestation }`. `mode` is derived from the preset and kept on the
// value because it stays load-bearing for `resolveCircleLlm` (local|cloud|off selection).

import { storageName } from './storageRegister.js';   // every storage name from the one register
import { CIRCLE_LLM_ROUTE_PRESETS } from './circleLlmRoutes.js';
import { hmacBase64Url } from '@onderling/core';
import { sealedJsonIo } from './localStoreSeal.js';

const VALID_MODES   = ['off', 'local', 'cloud'];
const VALID_PRESETS = Object.keys(CIRCLE_LLM_ROUTE_PRESETS);   // off · local-ollama · confidential-proxy · openai-compatible

export const DEFAULT_USER_LLM = Object.freeze({
  mode: 'off', preset: 'off',
  llmBaseUrl: '', llmModel: '', embedBaseUrl: '', embedModel: '',
  apiKey: '', attestation: false,
});

const str  = (v) => (typeof v === 'string' ? v.trim() : '');
const bool = (v) => v === true || v === 'true';

/** Back-compat: an old `{mode}`-only value maps to the closest preset. */
function presetForLegacyMode(mode) {
  if (mode === 'local') return 'local-ollama';
  if (mode === 'cloud') return 'openai-compatible';
  return 'off';
}

/** Coerce any stored/raw value to the full `{ mode, preset, …endpoints }` shape; unknown/malformed → off. */
export function normalizeUserLlmDefault(raw) {
  if (!raw || typeof raw !== 'object') return { ...DEFAULT_USER_LLM };
  const preset = VALID_PRESETS.includes(raw.preset)
    ? raw.preset
    : presetForLegacyMode(VALID_MODES.includes(raw.mode) ? raw.mode : 'off');
  // mode follows the preset (presets define posture); a raw mode only survives when no preset narrows it.
  const mode = CIRCLE_LLM_ROUTE_PRESETS[preset]?.mode
    ?? (VALID_MODES.includes(raw.mode) ? raw.mode : 'off');
  return {
    mode, preset,
    llmBaseUrl:   str(raw.llmBaseUrl),
    llmModel:     str(raw.llmModel),
    embedBaseUrl: str(raw.embedBaseUrl),
    embedModel:   str(raw.embedModel),
    apiKey:       str(raw.apiKey),
    attestation:  bool(raw.attestation),
    // this device's secret for the prompt-cache salt (one per person per conversation, `hmacBase64Url`); kept with the
    // setting, beside its key; made once a route is set
    ...(str(raw.cacheSecret) ? { cacheSecret: str(raw.cacheSecret) } : {}),
  };
}

/**
 * @param {{ load?: () => any|Promise<any>, save?: (v:object) => void|Promise<void> }} [io]
 * @returns {{ get: () => Promise<object>, set: (patch:object|string) => Promise<object> }}
 *   `set` accepts a partial patch (merged into the current value) OR a bare mode string (back-compat).
 */
export function createUserLlmDefaultStore({ load, save } = {}) {
  const read = async () => {
    let raw = null;
    try { raw = load ? await load() : null; } catch { raw = null; }
    return normalizeUserLlmDefault(raw);
  };
  return {
    // a route saved before the cache secret existed gets one on its first read, kept from then on
    async get() {
      const cur = await read();
      const next = withCacheSecret(cur);
      if (next !== cur && save) { try { await save(next); } catch { /* best-effort persist */ } }
      return next;
    },
    async set(patch) {
      const current = await read();
      const merged = typeof patch === 'string'
        ? { ...current, preset: presetForLegacyMode(patch), mode: patch }
        : { ...current, ...patch };
      const next = withCacheSecret(normalizeUserLlmDefault(merged));
      if (save) { try { await save(next); } catch { /* best-effort persist */ } }
      return next;
    },
  };
}

/** A route that is set gets its cache secret once (32 random bytes, base64url); one already there is kept. */
function withCacheSecret(cfg) {
  if (!cfg || cfg.preset === 'off' || !cfg.preset || cfg.cacheSecret) return cfg;
  const bytes = new Uint8Array(32);
  globalThis.crypto.getRandomValues(bytes);
  return { ...cfg, cacheSecret: hmacBase64Url([...bytes].join(','), 'cache-secret') };
}

const STORAGE_KEY = storageName('userLlmDefault');

/**
 * The setting's io, SEALED at rest (ledger L1083): it holds the person's own model endpoint WITH its API key. One io for
 * both shells (`sealedJsonIo`): a write before the content key is refused, a read before it is "nothing kept" (the
 * store then answers 'off' and writes nothing over the sealed value), an old plain value is resealed at its first read.
 * A screen that can read before the key (the phone's first frame) reads again on `onShellContentSeal`.
 */
export function sealedUserLlmIo(storage) {
  const io = sealedJsonIo(storage, { name: 'the model setting', said: true });
  return {
    load: () => io.load(STORAGE_KEY),
    save: async (v) => { try { await io.save(STORAGE_KEY, v); } catch { /* no content key yet: kept for this session only */ } },
  };
}

/** The web's io (localStorage). */
export function localStorageUserLlmIo(storage = globalThis.localStorage) { return sealedUserLlmIo(storage); }

/** The phone's io (AsyncStorage). Pass the `@react-native-async-storage/async-storage` instance. */
export function asyncStorageUserLlmIo(AsyncStorage) { return sealedUserLlmIo(AsyncStorage); }
