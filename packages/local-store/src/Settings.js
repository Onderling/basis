/**
 * Settings — per-app factory for the shared/device-split settings
 * pattern.
 *
 * **2026-05-08:** lifted from `apps/pinboard/src/lib/Settings.js`
 * (Tasks V1 = rule-of-two consumer per
 * `Project Files/Pinboard/migration-tasks-v1-lifts-2026-05-08.md`).
 *
 * The original Pinboard file hard-coded the path prefix
 * (`mem://pinboard/settings/...`) and the field schema. This substrate
 * version is a factory: `createSettingsModule({appId, sharedFields,
 * deviceFields, defaults})` returns an app-specific
 * `{loadSettings, saveSettings, updateSettings, DEFAULT_SETTINGS,
 * SETTINGS_SHARED_PATH, SETTINGS_LEGACY_PATH, SETTINGS_MIGRATION_MARKER,
 * SETTINGS_DEVICE_PATH_PREFIX}` bundle. Each app exports those bound
 * to its own appId + schema.
 *
 * The shared/device split is a project-wide pattern (see
 * `Project Files/conventions/cross-app-settings.md`):
 *
 *   `<pod>/<appId>/settings/shared.json`              user-portable
 *   `<pod>/<appId>/settings/devices/<deviceId>.json`  per-install
 *
 * Apps that want only-shared, only-device, or neither still use this
 * module — supply empty arrays for the slots they don't need.
 */

const ALLOWED_APP_ID = /^[a-z][a-z0-9_-]*$/;

/**
 * Build a per-app Settings module.
 *
 * @param {object} args
 * @param {string} args.appId
 *   Lowercase identifier (matches `[a-z][a-z0-9_-]*`).  Becomes the
 *   path prefix: `mem://<appId>/settings/...`.
 * @param {string[]} args.sharedFields
 *   Field names that go to `shared.json`.  Defaults-validated by
 *   `mergeWithDefaults`; must all be keys of `defaults`.
 * @param {string[]} args.deviceFields
 *   Field names that go to `devices/<deviceId>.json`.
 * @param {object} args.defaults
 *   Object whose keys are the union of `sharedFields` ∪ `deviceFields`.
 *   Values supply the cold-boot defaults AND drive `mergeWithDefaults`'s
 *   per-field validation.
 * @param {(value: unknown, fieldName: string, def: unknown) => unknown} [args.fieldValidator]
 *   Optional per-field validator.  Receives the candidate value, the
 *   field name, and the default; returns the validated value (or the
 *   default if invalid).  Default: simple type-equality check against
 *   the default's typeof.  Apps with rich validation (Pinboard's
 *   `pollIntervalMs >= 100` etc.) supply a custom one.
 */
export function createSettingsModule({
  appId,
  sharedFields,
  deviceFields,
  defaults,
  fieldValidator,
}) {
  if (typeof appId !== 'string' || !ALLOWED_APP_ID.test(appId)) {
    throw new Error(`createSettingsModule: appId must match ${ALLOWED_APP_ID}, got ${JSON.stringify(appId)}`);
  }
  if (!Array.isArray(sharedFields)) throw new Error('createSettingsModule: sharedFields[] required');
  if (!Array.isArray(deviceFields)) throw new Error('createSettingsModule: deviceFields[] required');
  if (!defaults || typeof defaults !== 'object') {
    throw new Error('createSettingsModule: defaults object required');
  }

  const SHARED_PATH      = `mem://${appId}/settings/shared.json`;
  const LEGACY_PATH      = `mem://${appId}/settings.json`;
  const MIGRATION_MARKER = `mem://${appId}/settings/.migrated-from-v2`;
  const DEVICE_PATH_PREFIX = `mem://${appId}/settings/devices/`;

  const SHARED_FIELDS = Object.freeze(new Set(sharedFields));
  const DEVICE_FIELDS = Object.freeze(new Set(deviceFields));
  const DEFAULT_SETTINGS = Object.freeze({ ...defaults });

  const validate = typeof fieldValidator === 'function'
    ? fieldValidator
    : _defaultFieldValidator;

  function devicePathFor(deviceId) {
    if (!deviceId || typeof deviceId !== 'string') return null;
    return `${DEVICE_PATH_PREFIX}${deviceId}.json`;
  }

  function _partition(merged, allowedFields) {
    const out = {};
    for (const k of Object.keys(merged)) {
      if (allowedFields.has(k)) out[k] = merged[k];
    }
    return out;
  }

  async function _safeReadJson(dataSource, path) {
    if (!path) return null;
    try {
      const raw = await dataSource.read(path);
      if (raw == null) return null;
      return typeof raw === 'string' ? JSON.parse(raw) : raw;
    } catch {
      return null;
    }
  }

  function mergeWithDefaults(s) {
    if (!s || typeof s !== 'object') return { ...DEFAULT_SETTINGS };
    const out = {};
    for (const [k, def] of Object.entries(DEFAULT_SETTINGS)) {
      out[k] = validate(s[k], k, def);
    }
    return out;
  }

  async function _migrateLegacyIfPresent({ dataSource, deviceId }) {
    if (!dataSource?.read || !dataSource?.write) return;
    const marker = await _safeReadJson(dataSource, MIGRATION_MARKER);
    if (marker && marker.done === true) return;

    const legacy = await _safeReadJson(dataSource, LEGACY_PATH);
    if (legacy != null) {
      const merged = mergeWithDefaults(legacy);
      await Promise.all([
        dataSource.write(SHARED_PATH,
          JSON.stringify(_partition(merged, SHARED_FIELDS))),
        dataSource.write(devicePathFor(deviceId),
          JSON.stringify(_partition(merged, DEVICE_FIELDS))),
      ]);
      if (typeof dataSource.delete === 'function') {
        try { await dataSource.delete(LEGACY_PATH); } catch { /* best-effort */ }
      }
    }
    await dataSource.write(MIGRATION_MARKER, JSON.stringify({ done: true, at: Date.now() }));
  }

  async function loadSettings({ dataSource, deviceId = null }) {
    if (!dataSource?.read) return { ...DEFAULT_SETTINGS };
    if (deviceId) await _migrateLegacyIfPresent({ dataSource, deviceId });
    const [shared, device] = await Promise.all([
      _safeReadJson(dataSource, SHARED_PATH),
      deviceId ? _safeReadJson(dataSource, devicePathFor(deviceId)) : Promise.resolve(null),
    ]);
    return mergeWithDefaults({ ...(shared ?? {}), ...(device ?? {}) });
  }

  async function saveSettings({ dataSource, deviceId = null, settings }) {
    if (!dataSource?.write) return mergeWithDefaults(settings);
    const merged = mergeWithDefaults(settings);

    if (!deviceId) {
      await dataSource.write(LEGACY_PATH, JSON.stringify(merged));
      return merged;
    }

    const sharedSubset = _partition(merged, SHARED_FIELDS);
    const deviceSubset = _partition(merged, DEVICE_FIELDS);

    await Promise.all([
      dataSource.write(SHARED_PATH, JSON.stringify(sharedSubset)),
      dataSource.write(devicePathFor(deviceId), JSON.stringify(deviceSubset)),
    ]);
    return merged;
  }

  async function _saveScoped({ dataSource, deviceId, settings, scope }) {
    const merged = mergeWithDefaults(settings);
    if (!deviceId) {
      await dataSource.write(LEGACY_PATH, JSON.stringify(merged));
      return merged;
    }
    if (scope === 'device') {
      await dataSource.write(devicePathFor(deviceId),
        JSON.stringify(_partition(merged, DEVICE_FIELDS)));
    } else {
      await dataSource.write(SHARED_PATH,
        JSON.stringify(_partition(merged, SHARED_FIELDS)));
    }
    return merged;
  }

  async function updateSettings({ dataSource, deviceId = null, patch, scope = null }) {
    const current = await loadSettings({ dataSource, deviceId });
    const next = { ...current, ...patch };
    // Special-case: nested object fields merge instead of replace, so a
    // partial patch (e.g. {onlineWindow: {everyMinutes: 5}}) doesn't
    // wipe the other key.
    for (const [k, v] of Object.entries(patch ?? {})) {
      if (v && typeof v === 'object' && !Array.isArray(v)
          && current[k] && typeof current[k] === 'object' && !Array.isArray(current[k])) {
        next[k] = { ...current[k], ...v };
      }
    }
    if (scope === 'device' || scope === 'shared') {
      return _saveScoped({ dataSource, deviceId, settings: next, scope });
    }
    return saveSettings({ dataSource, deviceId, settings: next });
  }

  return {
    loadSettings,
    saveSettings,
    updateSettings,
    DEFAULT_SETTINGS,
    SETTINGS_SHARED_PATH:        SHARED_PATH,
    SETTINGS_LEGACY_PATH:        LEGACY_PATH,
    SETTINGS_MIGRATION_MARKER:   MIGRATION_MARKER,
    SETTINGS_DEVICE_PATH_PREFIX: DEVICE_PATH_PREFIX,
  };
}

/**
 * Default per-field validator: returns `value` if its `typeof` matches
 * the default's `typeof`, else returns the default.  Apps with richer
 * rules (`>= N`, enum membership, nested-object merge) pass a custom
 * `fieldValidator` to `createSettingsModule`.
 */
function _defaultFieldValidator(value, fieldName, def) {
  if (def === null || def === undefined) {
    // Defaults of `null`/`undefined` only validate `typeof === typeof null`
    // — basically pass through. Edge case; apps should avoid these
    // defaults.
    return value ?? def;
  }
  if (typeof value === typeof def) return value;
  return def;
}
