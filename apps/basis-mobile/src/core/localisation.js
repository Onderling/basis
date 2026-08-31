/**
 * Localisation for basis-mobile.  Portable wrapper around
 * i18next that unwraps the project's `{text, doc}` leaf shape and
 * exposes a `t()` that future RN screens call.
 *
 * Convention enforced from day 1: every user-facing string
 * goes through `t()` with a locale entry; hardcoded English is a
 * defect.  Mirrors apps/tasks-v0/src/lib/localisation.js + the
 * stoop-mobile equivalent.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';
import en from '../../locales/en.json';
import nl from '../../locales/nl.json';
// The shared `circle`/`consequence`/`role` blocks live in ONE place in the basis package
// (src/locales/) so web + mobile can't drift; merge them over the mobile-only keys below.
import { sharedLocale, mergeShared } from '@onderling-app/basis';

function unwrapLeaves(node) {
  if (node === null || typeof node !== 'object') return node;
  if (typeof node.text === 'string'
      && (node.doc === undefined || typeof node.doc === 'string')
      && Object.keys(node).every((k) => k === 'text' || k === 'doc')) {
    return node.text;
  }
  const out = {};
  for (const [k, v] of Object.entries(node)) out[k] = unwrapLeaves(v);
  return out;
}

const BUNDLES = {
  // One spread, no block names — see `src/locales/index.js`: a shared block cannot be added to one
  // shell and forgotten on the other, because neither shell names blocks any more.
  en: unwrapLeaves(mergeShared(en, sharedLocale.en)),
  nl: unwrapLeaves(mergeShared(nl, sharedLocale.nl)),
};

let currentLang = 'en';

function lookup(bundle, dottedKey) {
  let cur = bundle;
  for (const seg of dottedKey.split('.')) {
    if (cur === null || cur === undefined || typeof cur !== 'object') return undefined;
    cur = cur[seg];
  }
  return typeof cur === 'string' ? cur : undefined;
}

/**
 * The plural form of a key, in the convention the SHARED locale files are authored in: i18next's
 * JSON-v4 suffixes `key_one` / `key_other`, which is what web's i18next resolves for the same files.
 *
 * This t() is a small hand-rolled one and had no plural branch at all, so a key authored as a pair
 * was never consulted: `circle.nearby.count` fell through to the generic entry beside it and the
 * launcher row read "Nearby: 1 device(s)" (found on a phone, 2026-08-31). One locale source read two
 * ways is exactly the drift the shared block exists to prevent.
 *
 * The two categories are written out rather than asked of `Intl.PluralRules`: en and nl both have
 * exactly one/other, and Intl is not something to lean on in Hermes. A language with a richer plural
 * system would need the real thing — and would need it in the locale files first.
 */
function pluralKey(key, params) {
  const n = params?.count;
  if (typeof n !== 'number' || !Number.isFinite(n)) return null;
  return `${key}_${n === 1 ? 'one' : 'other'}`;
}

/**
 * `{{name}}` substitution. A value the caller did not supply leaves the placeholder ON SCREEN — which
 * is ugly, and is exactly what web's i18next does with the same entry, so the two shells agree.
 *
 * They very nearly stopped agreeing here: the consolidation plan recorded (from READING i18next, not
 * running it) that it substitutes an empty string, and this function was changed to match. The
 * translator contract failed on its first run and said otherwise. The rendering is therefore
 * deliberate rather than merely inherited — pinned in `translatorContract.js` — and the dev warning
 * is the part worth adding, because a missing value is silent either way.
 */
function interpolate(template, params, key) {
  if (!/\{\{\w+\}\}/.test(template)) return template;
  return template.replace(/\{\{(\w+)\}\}/g, (_, k) => {
    const v = params?.[k];
    if (v === undefined || v === null) {
      if (typeof __DEV__ !== 'undefined' && __DEV__) console.warn(`[locale] "${key}" wants {{${k}}} and no value was passed — the placeholder will show.`);
      return `{{${k}}}`;
    }
    return v;
  });
}

const LANG_KEY = 'circle.app.lang';
const _langListeners = new Set();
/** Subscribe to app-language changes (App.js re-renders the tree). Returns an unsubscribe fn. */
export function subscribeLang(cb) { _langListeners.add(cb); return () => _langListeners.delete(cb); }
function _notifyLang() { for (const cb of _langListeners) { try { cb(currentLang); } catch { /* ignore */ } } }

export async function initLocalisation({ lng } = {}) {
  // A persisted user choice (the Mij toggle) wins over the passed device locale.
  let stored = null; try { stored = await AsyncStorage.getItem(LANG_KEY); } catch { /* no storage */ }
  if (stored === 'en' || stored === 'nl') currentLang = stored;
  else if (lng === 'en' || lng === 'nl') currentLang = lng;
  return currentLang;
}

export function setLang(lng) {
  if (lng === 'en' || lng === 'nl') {
    currentLang = lng;
    AsyncStorage.setItem(LANG_KEY, lng).catch(() => { /* best-effort */ });
    _notifyLang();
  }
  return currentLang;
}

export function lang() { return currentLang; }

/** Translate a key.  Falls back to the key string if missing. `lng` overrides the current language for one
 *  call (the feedback thread renders its chrome in the BOT's chosen language, not the device locale). */
export function t(key, params, lng) {
  const L = (lng === 'en' || lng === 'nl') ? lng : currentLang;
  // Resolve WITHIN a language before falling back to English — a language that has the plain key but
  // not the plural pair should answer in its own words, not switch language mid-sentence.
  const pk = pluralKey(key, params);
  const inBundle = (b) => (pk ? lookup(b, pk) : undefined) ?? lookup(b, key);
  // `defaultValue` is i18next's escape hatch and web has always honoured it. Here it was ignored, so
  // five call sites that read fine in a browser rendered their raw key on a phone — and the fitness
  // guard SKIPS a call that carries one, on the assumption both shells mean the same thing by it.
  // That assumption is true from here on.
  const fallback = typeof params?.defaultValue === 'string' ? params.defaultValue : key;
  const hit = inBundle(BUNDLES[L]) ?? inBundle(BUNDLES.en) ?? fallback;
  return interpolate(hit, params, key);
}

export const __test__ = { unwrapLeaves, lookup, pluralKey, BUNDLES };
