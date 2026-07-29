/**
 * settings — read helpers over `manifest.settings` (B, ruling).
 *
 * The declaration is validated in `validate.js`; this module is the shared read layer the creation
 * wizard + inline settings forms (web AND mobile) consume, so the `requiredWhen` resolution and the
 * scope split live ONCE. `scope:'circle'` settings are the admin template; `scope:'user'` settings
 * are member preferences (the two-level `admin-template ∩ member-prefs` resolution lands in).
 */

/** The declared settings, optionally filtered to a `scope` ('circle' default when a setting omits it). */
export function settingsOf(manifest, { scope } = {}) {
  const all = Array.isArray(manifest?.settings) ? manifest.settings : [];
  return scope ? all.filter((s) => (s?.scope ?? 'circle') === scope) : all;
}

/** `{ key: default }` for every setting (in `scope`) that declares a default — seeds a wizard/form. */
export function settingDefaults(manifest, opts = {}) {
  const out = {};
  for (const s of settingsOf(manifest, opts)) {
    if (s && s.key != null && s.default !== undefined) out[s.key] = s.default;
  }
  return out;
}

/**
 * Resolve `requiredWhen`: a setting is required iff EVERY named sibling in `values` matches its
 * allowed value (or one of an allowed array). No `requiredWhen` → never conditionally-required.
 * @param {object} setting  a Setting declaration
 * @param {object} [values] the current form values (sibling keys → chosen values)
 * @returns {boolean}
 */
export function isSettingRequired(setting, values = {}) {
  const rw = setting?.requiredWhen;
  if (!rw || typeof rw !== 'object' || Array.isArray(rw)) return false;
  const keys = Object.keys(rw);
  if (keys.length === 0) return false;
  return keys.every((k) => {
    const allowed = rw[k];
    const v = values?.[k];
    return Array.isArray(allowed) ? allowed.includes(v) : v === allowed;
  });
}

/**
 * Project `manifest.settings` into render-ready FORM FIELDS (B) — the pure layer the web
 * + mobile wizard/settings shells draw from (they own only the widgets). Each field resolves its
 * current `value` (supplied `values` ?? declared default) and conditional `required` (via
 * `isSettingRequired`), so the shell renders without re-deriving anything. `control` is the setting
 * `kind` verbatim (toggle|choice|text|number|member) — the shell maps it to a platform widget.
 *
 * @param {object} manifest
 * @param {object} [opts]
 * @param {'circle'|'user'} [opts.scope]  restrict to one scope (admin template vs member prefs)
 * @param {object} [opts.values]          current values (overrides defaults; drives requiredWhen)
 * @returns {Array<{key,label,control,choices?,value,required,adminOnly,hint?,scope}>}
 */
export function buildSettingsForm(manifest, { scope, values = {} } = {}) {
  return settingsOf(manifest, { scope }).map((s) => ({
    key:       s.key,
    label:     s.label,
    control:   s.kind,                                             // widget hint for the shell
    choices:   s.kind === 'choice' ? (Array.isArray(s.of) ? s.of : []) : undefined,
    // `multi` carries the NAME of its option source; the shell resolves it against the registry at render
    // time, so adding a kind to that registry cannot leave this control behind.
    optionsFrom: s.kind === 'multi' ? s.optionsFrom : undefined,
    value:     values[s.key] !== undefined ? values[s.key] : s.default,
    required:  isSettingRequired(s, values),
    adminOnly: !!s.adminOnly,
    hint:      s.description,
    scope:     s.scope ?? 'circle',
  }));
}
