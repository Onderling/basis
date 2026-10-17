/**
 * Tasks V1 — i18next wrapper.
 *
 * Mirrors `apps/pinboard/src/lib/localisation.js`. The substrate convention
 * (`Project Files/conventions/localisation.md`) is:
 *   - every user-facing string lives in `locales/<lang>.json`
 *   - leaf shape is `{text, doc}` where `doc` is a translator note
 *   - apps emit error CODES from skills; the UI localises them
 *
 * V1 scope: this wrapper loads en + nl JSON files at module-init,
 * exposes `t(key, params?)`, and unwraps the `{text, doc}` leaves
 * automatically (so callers write `t('common.save')` not
 * `t('common.save.text')`).
 *
 * Existing HTML pages still ship hardcoded copy; the back-fill from
 * hardcoded → t-keys is opportunistic per touched page.
 * The wrapper is ready when that day comes.
 */

import i18next from 'i18next';

import en from '../../locales/en.json' with { type: 'json' };
import nl from '../../locales/nl.json' with { type: 'json' };

let initialised = false;

/**
 * Recursively transform `{text, doc}` leaves to the bare string so
 * i18next renders the user-facing copy directly.
 */
function unwrapLeaves(node) {
  if (node === null || typeof node !== 'object') return node;
  if (Array.isArray(node)) return node.map(unwrapLeaves);
  // Leaf detection: an object with exactly `text` (string) + optional `doc`.
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
 * Initialise i18next. Idempotent — calling twice is a no-op.
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
      en: { translation: unwrapLeaves(en) },
      nl: { translation: unwrapLeaves(nl) },
    },
    interpolation: { escapeValue: false },
  });
  initialised = true;
}

/**
 * Translate a key. Falls back to the key itself when no translation
 * exists (matches Pinboard's pattern; the failure mode is visible in
 * the UI rather than silent empty strings).
 *
 * @param {string} key
 * @param {object} [params]
 * @returns {string}
 */
export function t(key, params) {
  if (!initialised) {
    // Auto-init synchronously is impossible; return the key so a
    // caller-before-init mistake is visible.
    return key;
  }
  return i18next.t(key, params);
}

/** Get the current language code. */
export function currentLang() {
  return i18next.language ?? 'en';
}

/** Switch language at runtime. */
export async function setLang(lng) {
  if (!initialised) await initLocalisation({ lng });
  else if (i18next.language !== lng) await i18next.changeLanguage(lng);
}

export const __test__ = { unwrapLeaves };
