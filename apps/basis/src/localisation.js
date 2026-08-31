/**
 * basis — i18next wrapper.
 *
 * Mirrors `apps/stoop/src/lib/localisation.js` + `apps/tasks-v0/src/lib/localisation.js`.
 * Per `Project Files/conventions/localisation.md`:
 *   - every user-facing string lives in `locales/<lang>.json`
 *   - leaf shape is `{ text, doc }` where `doc` is a translator note
 *   - the chat shell emits LOCALISED strings via t(); raw substrate
 *     replies (e.g. error codes from skills) get mapped to keys
 *
 * Phase v0.1 per `/Project Files/basis/coding-plan.md`.
 */

import i18next from 'i18next';

import en from '../locales/en.json' with { type: 'json' };
import nl from '../locales/nl.json' with { type: 'json' };
// The shared `circle`/`consequence`/`role` blocks live in ONE place (src/locales/) so web + mobile
// can't drift; merge them in.
import { sharedLocale } from './locales/index.js';

let initialised = false;

/**
 * Recursively transform `{text, doc}` leaves to the bare string so
 * i18next renders the user-facing copy directly.
 *
 * @internal
 */
function unwrapLeaves(node) {
  if (node === null || typeof node !== 'object') return node;
  if (Array.isArray(node)) return node.map(unwrapLeaves);
  if (typeof node.text === 'string'
      && (node.doc === undefined || typeof node.doc === 'string')
      && Object.keys(node).every((k) => k === 'text' || k === 'doc')) {
    return node.text;
  }
  const out = {};
  for (const [k, v] of Object.entries(node)) out[k] = unwrapLeaves(v);
  return out;
}

/**
 * Initialise i18next.  Idempotent — calling twice is a no-op.
 *
 * @param {object} [opts]
 * @param {string} [opts.lng='en']         initial language
 * @param {string} [opts.fallbackLng='en']
 * @returns {Promise<void>}
 */
export async function initLocalisation({ lng = 'en', fallbackLng = 'en' } = {}) {
  if (initialised) {
    if (i18next.language !== lng) await i18next.changeLanguage(lng);
    return;
  }
  await i18next.init({
    lng,
    fallbackLng,
    resources: {
      // One spread, no block names: a block added to `src/locales/index.js` lands on both shells
      // without either loader being edited. (It used to name each block here and in the mobile
      // loader — three files to keep in step, and nothing failed when they fell out of step.)
      en: { translation: unwrapLeaves({ ...en, ...sharedLocale.en }) },
      nl: { translation: unwrapLeaves({ ...nl, ...sharedLocale.nl }) },
    },
    interpolation: { escapeValue: false },
  });
  initialised = true;
}

/**
 * Translate a key.  Falls back to the key itself when no translation
 * exists (the failure mode is visible in the UI rather than silent
 * empty strings).
 *
 * @param {string} key
 * @param {object} [params]
 * @param {'en'|'nl'} [lng]  override the active language for ONE call (the feedback thread renders its chrome
 *                           in the BOT's chosen language, not the app locale)
 * @returns {string}
 */
export function t(key, params, lng) {
  if (!initialised) {
    // Auto-init is async; return the key so a caller-before-init
    // mistake surfaces visibly rather than as an empty string.
    return key;
  }
  return i18next.t(key, (lng === 'en' || lng === 'nl') ? { ...params, lng } : params);
}

/**
 * Detect the user's preferred language from the browser, falling
 * back to 'en'.  Only the language tag prefix is consulted ('nl-NL'
 * → 'nl').  v0.1 supports en + nl.
 *
 * @returns {'en' | 'nl'}
 */
export function detectDeviceLang() {
  const nav = (typeof navigator !== 'undefined') ? navigator : null;
  const candidates = [];
  if (nav?.languages) candidates.push(...nav.languages);
  if (nav?.language)  candidates.push(nav.language);
  for (const tag of candidates) {
    if (typeof tag !== 'string') continue;
    const prefix = tag.slice(0, 2).toLowerCase();
    if (prefix === 'nl' || prefix === 'en') return prefix;
  }
  return 'en';
}

/** Get the current language code.  Returns 'en' when not initialised. */
export function currentLang() {
  return i18next.language ?? 'en';
}

/**
 * Switch language at runtime.  Auto-initialises if needed.
 *
 * @param {'en' | 'nl'} lng
 * @returns {Promise<void>}
 */
export async function setLang(lng) {
  if (!initialised) await initLocalisation({ lng });
  else if (i18next.language !== lng) await i18next.changeLanguage(lng);
}

/** Whether the localisation has been initialised. */
export function isInitialised() {
  return initialised;
}

/** Test-only export for verifying the leaf-unwrapping logic. */
export const __test__ = { unwrapLeaves };
