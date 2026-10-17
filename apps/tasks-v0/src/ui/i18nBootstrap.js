/**
 * tasks-v0 web — runtime locale loader.  Post-V0 follow-up
 * (2026-05-27).
 *
 * The Node-side wrapper `src/lib/localisation.js` can't run in the
 * browser (uses `import en from '…en.json' with {type:'json'}` —
 * Node-only import attributes; pulls in i18next which would need
 * bundling).  This module is a tiny browser-native equivalent —
 * fetches the JSON, resolves keys via dotted path, supports
 * `{{var}}` interpolation, walks the DOM by `data-i18n*` attributes.
 * Same `{text, doc}` leaf unwrap convention.
 *
 * Why not pull in i18next?  Tasks-v0 web ships as plain HTML/JS via
 * `bin/tasks-ui.js`'s static overlay — no bundler.  ~80 LoC of
 * runtime is cheaper than wiring up esbuild/webpack just for one
 * translator.  When/if tasks-v0 web grows a bundler, swap this for
 * the proper i18next instance.
 *
 * Usage on a tasks-v0 web page:
 *
 *   <script type="module">
 *     import { bootI18n, walkAndTranslate, setLang, t, currentLang }
 *       from '/lib/i18nBootstrap.js';
 *     await bootI18n();
 *     walkAndTranslate(document);
 *
 *     document.querySelector('#lang-nl')?.addEventListener('click', async () => {
 *       await setLang('nl');
 *       walkAndTranslate(document);
 *     });
 *   </script>
 *
 * DOM attribute conventions:
 *   - `data-i18n="key"`             → sets `.textContent = t(key)`
 *   - `data-i18n-html="key"`        → sets `.innerHTML = t(key)` (CAUTION: caller verifies the JSON value is safe)
 *   - `data-i18n-attr-<name>="key"` → sets `el.setAttribute(name, t(key))`
 *   - `data-i18n-params='{"x":1}'`  → optional JSON params for interpolation
 *
 * Interpolation: `{{varName}}` in the locale value is replaced by
 * `params.varName`.  Missing params resolve to the empty string.
 */

let _state = {
  lng:        'en',
  fallback:   'en',
  resources:  null,                            // {en: {...}, nl: {...}} after boot
  ready:      false,
  initPromise: null,
};

/**
 * Recursively transform `{text, doc}` leaves to bare strings.  Same
 * convention `src/lib/localisation.js` uses; lifted here so the
 * browser doesn't need to import the Node-side helper.
 */
export function unwrapLeaves(node) {
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
 * Resolve a dotted key against the loaded resources for the current
 * (or fallback) language.  Returns `undefined` when the key is missing
 * — caller decides the fallback (we return the key itself).
 */
function _lookup(lng, key) {
  if (!_state.resources?.[lng]) return undefined;
  const parts = key.split('.');
  let cur = _state.resources[lng];
  for (const p of parts) {
    if (cur === null || typeof cur !== 'object') return undefined;
    cur = cur[p];
  }
  return typeof cur === 'string' ? cur : undefined;
}

/**
 * Substitute `{{name}}` markers in `tpl` with `params[name]`.  Missing
 * keys render as the literal `{{name}}` so they're visible in the UI
 * (matches pinboard + i18next behaviour when interpolation fails).
 */
function _interpolate(tpl, params) {
  if (typeof tpl !== 'string')   return '';
  if (!params || typeof params !== 'object') return tpl;
  return tpl.replace(/\{\{(\w+)\}\}/g, (_, name) =>
    params[name] !== undefined ? String(params[name]) : `{{${name}}}`,
  );
}

/**
 * Translate a key.  Falls back to the fallback language, then to the
 * raw key.
 *
 * @param {string} key
 * @param {object} [params]
 * @returns {string}
 */
export function t(key, params) {
  if (!_state.ready) return key;
  const raw = _lookup(_state.lng, key)
    ?? _lookup(_state.fallback, key)
    ?? key;
  return _interpolate(raw, params);
}

/** Current language code. */
export function currentLang() { return _state.lng; }

/**
 * Boot the loader.  Fetches the locale JSON, applies `unwrapLeaves`,
 * stores in module state.  Idempotent — concurrent + repeat callers
 * share the same promise.
 *
 * @param {object} [opts]
 * @param {string} [opts.lng='en']
 * @param {string} [opts.basePath='/locales']
 * @param {{ fetch?: typeof fetch }} [opts._inject]   tests
 * @returns {Promise<void>}
 */
export async function bootI18n({ lng = 'en', basePath = '/locales', _inject } = {}) {
  if (_state.initPromise) return _state.initPromise;
  const f = _inject?.fetch ?? globalThis.fetch;
  _state.initPromise = (async () => {
    const [en, nl] = await Promise.all([
      f(`${basePath}/en.json`).then((r) => r.json()),
      f(`${basePath}/nl.json`).then((r) => r.json()),
    ]);
    _state.resources = {
      en: unwrapLeaves(en),
      nl: unwrapLeaves(nl),
    };
    _state.lng   = lng;
    _state.ready = true;
  })();
  return _state.initPromise;
}

/**
 * Switch language at runtime.  Resolves once the language is active.
 *
 * @param {string} lng
 */
export async function setLang(lng) {
  if (!_state.initPromise) return bootI18n({ lng });
  await _state.initPromise;
  if (!_state.resources?.[lng]) {
    // Unknown language — silently no-op (matches i18next when
    // `fallbackLng` is set and language is unknown).
    return;
  }
  _state.lng = lng;
}

/**
 * Walk `root` and apply `data-i18n*` attribute conventions.  Safe to
 * call repeatedly — runs every time; no caching.  Use after
 * `bootI18n()` and after any DOM mutation that injects new
 * translatable nodes.
 *
 * @param {Document | Element} root
 */
export function walkAndTranslate(root) {
  if (!root || typeof root.querySelectorAll !== 'function') return;
  // textContent — primary use case.
  for (const el of root.querySelectorAll('[data-i18n]')) {
    const key = el.getAttribute('data-i18n');
    if (!key) continue;
    el.textContent = t(key, _readParams(el));
  }
  // innerHTML — for rich text in locale values.  Used sparingly.
  for (const el of root.querySelectorAll('[data-i18n-html]')) {
    const key = el.getAttribute('data-i18n-html');
    if (!key) continue;
    el.innerHTML = t(key, _readParams(el));
  }
  // data-i18n-attr-<name> — for title, placeholder, aria-label, etc.
  for (const el of root.querySelectorAll('*')) {
    for (const a of el.attributes) {
      if (!a.name.startsWith('data-i18n-attr-')) continue;
      const attrName = a.name.slice('data-i18n-attr-'.length);
      if (!attrName) continue;
      el.setAttribute(attrName, t(a.value));
    }
  }
}

function _readParams(el) {
  const raw = el.getAttribute('data-i18n-params');
  if (!raw) return undefined;
  try { return JSON.parse(raw); } catch { return undefined; }
}

/** Test seam — reset module state between tests. */
export function __reset() {
  _state = {
    lng:         'en',
    fallback:    'en',
    resources:   null,
    ready:       false,
    initPromise: null,
  };
}
