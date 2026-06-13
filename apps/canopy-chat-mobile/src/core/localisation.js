/**
 * Localisation for canopy-chat-mobile.  Portable wrapper around
 * i18next that unwraps the project's `{text, doc}` leaf shape and
 * exposes a `t()` that future RN screens call.
 *
 * Convention enforced from day 1 (#213): every user-facing string
 * goes through `t()` with a locale entry; hardcoded English is a
 * defect.  Mirrors apps/tasks-v0/src/lib/localisation.js + the
 * stoop-mobile equivalent.
 */
import en from '../../locales/en.json';
import nl from '../../locales/nl.json';
// The shared `circle` block lives in ONE place in the canopy-chat package (src/locales/) so web + mobile
// can't drift; merge it over the mobile-only keys below.
import { sharedCircleLocale } from '@canopy-app/canopy-chat';

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
  en: unwrapLeaves({ ...en, circle: sharedCircleLocale.en }),
  nl: unwrapLeaves({ ...nl, circle: sharedCircleLocale.nl }),
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

function interpolate(template, params) {
  if (!params) return template;
  return template.replace(/\{\{(\w+)\}\}/g, (_, k) => (params[k] ?? `{{${k}}}`));
}

export async function initLocalisation({ lng } = {}) {
  if (lng === 'en' || lng === 'nl') currentLang = lng;
  return currentLang;
}

export function setLang(lng) {
  if (lng === 'en' || lng === 'nl') currentLang = lng;
  return currentLang;
}

export function lang() { return currentLang; }

/** Translate a key.  Falls back to the key string if missing. */
export function t(key, params) {
  const hit = lookup(BUNDLES[currentLang], key)
           ?? lookup(BUNDLES.en, key)
           ?? key;
  return interpolate(hit, params);
}

export const __test__ = { unwrapLeaves, lookup, BUNDLES };
