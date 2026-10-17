/**
 * loadLocale — RN-friendly locale resolver factory.
 *
 * Lifted from apps/pinboard-mobile/src/lib/localisation.js 2026-05-09 (Phase 41.0
 * L7; Tasks-mobile is the second consumer). The original module
 * hardcoded Pinboard's locale imports; the substrate factory takes the
 * locale bundles as args so each app provides its own.
 *
 * Apps consume:
 *
 *   import { loadLocale } from '@onderling/react-native/localisation';
 *   import en from '@onderling-app/<app>/locales/en';
 *   import nl from '@onderling-app/<app>/locales/nl';
 *   const localisation = loadLocale({ bundles: { en, nl }, defaultLang: 'en' });
 *
 *   await localisation.initLocalisation();             // detects device locale
 *   localisation.t('mobile.scan_qr');          // dotted-path lookup; unwraps {text, doc}
 *   localisation.format('chat.unread', { count: 3 });
 *
 * The resolver is per-instance — apps can run two instances if they
 * need to (e.g. one for app strings, one for substrate strings).
 */

/**
 * @param {object} args
 * @param {Object<string, object>} args.bundles
 *   Map of language code → locale bundle (object tree of `{text, doc}` leaves).
 * @param {string} [args.defaultLang='en']
 * @returns {{
 *   initLocalisation:      (opts?: {lng?: string}) => Promise<void>,
 *   detectDeviceLang: () => string,
 *   setLang:       (lang: string) => Promise<void>,
 *   currentLang:   () => string,
 *   isInitialised: () => boolean,
 *   t:             (key: string, fallback?: string) => string,
 *   format:        (key: string, params?: object, fallback?: string) => string,
 *   _internal:     object,
 * }}
 */
export function loadLocale({ bundles, defaultLang = 'en' } = {}) {
  if (!bundles || typeof bundles !== 'object') {
    throw new TypeError('loadLocale: bundles map required');
  }
  if (!bundles[defaultLang]) {
    throw new TypeError(`loadLocale: defaultLang "${defaultLang}" not in bundles`);
  }

  let _bundle      = bundles[defaultLang];
  let _lang        = defaultLang;
  let _initialised = false;

  function detectDeviceLang() {
    try {
      const tag = new Intl.DateTimeFormat().resolvedOptions().locale;
      if (typeof tag === 'string') {
        const lower = tag.toLowerCase();
        // Pick the longest available language prefix (so 'nl-NL' resolves
        // to 'nl' but 'pt-BR' would resolve to 'pt' if both are present).
        for (const lang of Object.keys(bundles)) {
          if (lower.startsWith(lang.toLowerCase())) return lang;
        }
      }
    } catch { /* fall through */ }
    return defaultLang;
  }

  async function setLang(lang) {
    const next = bundles[lang];
    if (!next) {
      _lang   = defaultLang;
      _bundle = bundles[defaultLang];
      return;
    }
    _lang   = lang;
    _bundle = next;
  }

  async function initLocalisation({ lng } = {}) {
    await setLang(lng ?? detectDeviceLang());
    _initialised = true;
  }

  function currentLang()   { return _lang; }
  function isInitialised() { return _initialised; }

  function t(key, fallback) {
    const hit = _lookupKey(_bundle, key);
    if (typeof hit === 'string') return hit;
    return fallback ?? key;
  }

  function format(key, params, fallback) {
    let s = t(key, fallback);
    if (!params) return s;
    for (const [k, v] of Object.entries(params)) {
      s = s.replace(new RegExp(`\\{${k}\\}`, 'g'), String(v));
    }
    return s;
  }

  return {
    initLocalisation,
    detectDeviceLang,
    setLang,
    currentLang,
    isInitialised,
    t,
    format,
    _internal: { _lookupKey, get bundle() { return _bundle; } },
  };
}

/**
 * Walk a dotted key + unwrap `{text, doc}` leaves.
 * @param {object} bundle
 * @param {string} key
 * @returns {string|undefined}
 */
function _lookupKey(bundle, key) {
  if (!bundle || typeof key !== 'string') return undefined;
  let cur = bundle;
  for (const part of key.split('.')) {
    if (cur && typeof cur === 'object' && part in cur) cur = cur[part];
    else return undefined;
  }
  if (typeof cur === 'string') return cur;
  if (cur && typeof cur === 'object' && typeof cur.text === 'string') return cur.text;
  return undefined;
}
