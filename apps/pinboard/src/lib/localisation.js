/**
 * Pinboard V1 — i18next wrapper.
 *
 * Per `Project Files/conventions/localisation.md`: every user-facing string
 * lives in `locales/<lang>.json`; substrates emit error codes,
 * apps localise them.  `i18next` is the chosen library.
 *
 * V1 scope:
 *   - Loads en + nl JSON files at module-init.
 *   - Exposes `t(key, params?)` for skill / lib code.
 *   - Default lang `en`, `nl` shipped from V1.
 *   HTML pages currently keep their copy hard-coded; moves
 *     HTML strings out via `data-i18n` attributes.  The wrapper is
 *     ready when that day comes.
 */

import i18next from 'i18next';

import en from '../../locales/en.json' with { type: 'json' };
import nl from '../../locales/nl.json' with { type: 'json' };

let initialised = false;

/**
 * Initialise i18next.  Idempotent — calling twice is a no-op.
 *
 * @param {object} [opts]
 * @param {string} [opts.lng='en']     initial language
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
      en: { translation: en },
      nl: { translation: nl },
    },
    interpolation: { escapeValue: false },
  });
  initialised = true;
}

/**
 * Translate a key.  Falls back to the key itself if the translation
 * is missing (developer hint).  Apps can pass `params` for
 * interpolation (`{name}`).
 *
 * @param {string} key
 * @param {Record<string, unknown>} [params]
 * @returns {string}
 */
export function t(key, params) {
  if (!initialised) {
    // Soft-fall: callers that forget to initialise still get something.
    return params?.defaultValue ?? key;
  }
  return i18next.t(key, params);
}

/**
 * Switch language at runtime.
 *
 * @param {string} lang
 */
export async function setLang(lang) {
  if (!initialised) await initLocalisation({ lng: lang });
  else              await i18next.changeLanguage(lang);
}

/** Currently active language code. */
export function getLang() {
  return initialised ? i18next.language : null;
}
