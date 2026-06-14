/**
 * Mappings folder — the pod-side store for downloadable EXTENSION mappings
 * (feedback-extension, DESIGN §2.2 / P2).
 *
 * A "mapping" is pure DATA: a manifest declaring ops (composites of existing
 * opIds — see `@canopy/app-manifest` `Operation.steps`) + clickable menus +
 * locale, scoped to `'app'` or a circle. Mappings live under a FOLDER:
 *
 *   pseudo-pod://<deviceId>/private/mappings/<id>
 *
 * and are SCANNED at startup → merged into the catalog (the merge + the
 * sandbox-by-construction verifier `verifyComposite` run LATER, at merge
 * time; this module is I/O + shape only). This is the folder analogue of
 * `configResource.js` (a single resource).
 *
 * Loading is FAULT-TOLERANT: a malformed mapping is collected in `errors`,
 * never thrown — one bad extension must not break boot.
 */

const MAPPINGS_SEGMENT = 'private/mappings';

function assertDeviceId(deviceId) {
  if (typeof deviceId !== 'string' || deviceId.length === 0) {
    throw Object.assign(new Error('mappingsResource: deviceId is required'),
      { code: 'INVALID_ARGUMENT' });
  }
}

function assertId(id) {
  if (typeof id !== 'string' || id.length === 0) {
    throw Object.assign(new Error('mappingsResource: mapping id is required'),
      { code: 'INVALID_ARGUMENT' });
  }
}

/** The folder all mappings live under (trailing slash → a container). */
export function mappingsContainerUri({ deviceId }) {
  assertDeviceId(deviceId);
  return `pseudo-pod://${deviceId}/${MAPPINGS_SEGMENT}/`;
}

/** The resource URI for one mapping by id. */
export function mappingResourceUri({ deviceId, id }) {
  assertDeviceId(deviceId);
  assertId(id);
  return `pseudo-pod://${deviceId}/${MAPPINGS_SEGMENT}/${encodeURIComponent(id)}`;
}

/**
 * @typedef {object} Mapping
 * @property {string}   id
 * @property {string}   [version]
 * @property {string}   [title]
 * @property {object}   [locale]            per-language string tables
 * @property {string[]} needs               atom/op ids required (consent + verify)
 * @property {'app'|'circle'} scope
 * @property {Array<object>} ops            composite/local Operations (data)
 * @property {Array<object>} [menus]        clickable keyboard declarations
 */

/**
 * Validate + freeze one mapping object (SHAPE only — catalog resolution of
 * the ops happens later via `verifyComposite`). Throws on a structural defect.
 *
 * @param {*} raw
 * @returns {Readonly<Mapping>}
 */
export function validateMapping(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    throw Object.assign(new Error('mapping must be an object'), { code: 'INVALID_MAPPING' });
  }
  assertId(raw.id);
  if (!Array.isArray(raw.ops)) {
    throw Object.assign(new Error(`mapping "${raw.id}": ops must be an array`),
      { code: 'INVALID_MAPPING' });
  }
  for (const op of raw.ops) {
    if (!op || typeof op !== 'object' || typeof op.id !== 'string' || op.id.length === 0) {
      throw Object.assign(new Error(`mapping "${raw.id}": every op needs a string id`),
        { code: 'INVALID_MAPPING' });
    }
  }
  const scope = raw.scope === 'circle' ? 'circle' : 'app';
  const needs = Array.isArray(raw.needs) ? raw.needs.filter((n) => typeof n === 'string') : [];
  return Object.freeze({
    id:      raw.id,
    version: typeof raw.version === 'string' ? raw.version : undefined,
    title:   typeof raw.title === 'string' ? raw.title : undefined,
    locale:  (raw.locale && typeof raw.locale === 'object') ? raw.locale : undefined,
    needs:   Object.freeze(needs),
    scope,
    ops:     Object.freeze(raw.ops.map((o) => Object.freeze({ ...o }))),
    menus:   Array.isArray(raw.menus) ? Object.freeze(raw.menus.map((m) => Object.freeze({ ...m }))) : undefined,
  });
}

/**
 * Scan the device's `private/mappings/` folder and load every mapping.
 * Returns the valid mappings plus a per-resource error list (never throws
 * for a bad/absent mapping — boot must survive a broken extension).
 *
 * @param {object} args
 * @param {import('@canopy/pseudo-pod').PseudoPod | {list:Function, read:Function}} args.pseudoPod
 * @param {string} args.deviceId
 * @returns {Promise<{ mappings: Mapping[], errors: Array<{uri:string, code:string, message:string}> }>}
 */
export async function loadMappings({ pseudoPod, deviceId }) {
  const container = mappingsContainerUri({ deviceId });

  let uris;
  try {
    uris = await pseudoPod.list(container);
  } catch {
    // No folder yet (first run) → no mappings. Tolerate.
    return { mappings: [], errors: [] };
  }

  const mappings = [];
  const errors = [];
  for (const uri of uris ?? []) {
    try {
      const rec = await pseudoPod.read(uri);
      if (!rec) continue;
      const obj = coerceToObject(rec.bytes);
      if (obj === null) {
        throw Object.assign(new Error(`mapping at ${uri} is not a JSON object`),
          { code: 'INVALID_MAPPING' });
      }
      mappings.push(validateMapping(obj));
    } catch (e) {
      errors.push({ uri, code: e.code ?? 'INVALID_MAPPING', message: e.message });
    }
  }
  return { mappings, errors };
}

/**
 * Persist one mapping into the folder (the "open link → consent → write"
 * install step stores the resolved mapping inline). Validates first.
 *
 * @returns {Promise<{uri:string, etag?:string, mapping: Mapping}>}
 */
export async function writeMapping({ pseudoPod, deviceId, mapping }) {
  const normalised = validateMapping(mapping);
  const uri = mappingResourceUri({ deviceId, id: normalised.id });
  const res = await pseudoPod.write(uri, normalised);
  return { uri, etag: res?.etag, mapping: normalised };
}

/**
 * Remove one mapping (the uninstall / "delete the ref → surfaces revert" step).
 *
 * @returns {Promise<{uri:string}>}
 */
export async function removeMapping({ pseudoPod, deviceId, id }) {
  const uri = mappingResourceUri({ deviceId, id });
  if (typeof pseudoPod.delete === 'function') await pseudoPod.delete(uri);
  return { uri };
}

function coerceToObject(value) {
  if (value === null || value === undefined) return null;
  if (typeof value === 'object' && !Array.isArray(value)) return value;
  if (typeof value === 'string') {
    try {
      const parsed = JSON.parse(value);
      return (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) ? parsed : null;
    } catch { return null; }
  }
  return null;
}
