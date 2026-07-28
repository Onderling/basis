/**
 * Type registry + validation pipeline.
 *
 * Apps register types via `registerType(name, schema)` (uncommon
 * — the substrate ships the canonical set as a default). Items
 * validate via `validate(item)` which returns `{ok, errors?}`.
 *
 * The registry is an in-process Map (one per call to
 * `createRegistry()`). The top-level `validate`/`schema`/`list`
 * functions exported from `index.js` operate on a shared
 * default-canonical registry.
 *
 * Standardisation Phase 52.1 — see
 * `Project Files/Substrates/substrates-v2-coding-plan-2026-05-11.md`.
 */

import Ajv from 'ajv';
import addFormats from 'ajv-formats';

/**
 * @typedef {object} ValidationOk
 * @property {true} ok
 *
 * @typedef {object} ValidationFail
 * @property {false} ok
 * @property {Array<{instancePath: string, message: string, [key: string]: any}>} errors
 *
 * @typedef {ValidationOk | ValidationFail} ValidationResult
 */

/**
 * @typedef {object} TypeEntry
 * @property {object} schema
 * @property {string} [iri]    — optional canonical IRI for the type
 *                               (project ns: `https://onderling.org/ns#<TypeName>`).
 *                               When set, available via `metadata(typeName).iri`.
 */

/**
 * Create an independent registry instance. Most callers use the
 * default canonical one (via the top-level `validate` etc.); apps
 * that want a fresh registry for tests can call this.
 */
export function createRegistry() {
  // ajv config:
  // - allErrors: true → return every validation error, not just the first
  // - strict: 'log'   → unknown keywords (like our `iri` annotation) log a
  //                     warning instead of throwing; `description` is already
  //                     a built-in JSON-Schema annotation so no need to add it.
  const ajv = new Ajv({ allErrors: true, strict: 'log' });
  addFormats(ajv);

  // `iri` is an unknown keyword; declare it explicitly so ajv treats it as a
  // descriptive annotation rather than logging a warning on every schema.
  ajv.addKeyword({ keyword: 'iri', metaSchema: { type: 'string' } });

  /** @type {Map<string, TypeEntry>}       */ const types       = new Map();
  /** @type {Map<string, (i: any) => boolean>} */ const validators  = new Map();
  /** @type {Map<string, string>}          */ const aliases     = new Map();  // alt name → canonical name

  /**
   * Register a new type.
   *
   * @param {string} name    — short kebab-case name (e.g. 'task')
   * @param {object} schema  — JSON Schema (draft-07-ish; ajv-compatible)
   * @param {object} [opts]
   * @param {string[]} [opts.aliases]  — alternative names that map to this type
   */
  function registerType(name, schema, opts = {}) {
    if (typeof name !== 'string' || name.length === 0) {
      throw Object.assign(
        new Error('registerType: `name` must be a non-empty string'),
        { code: 'INVALID_ARGUMENT' },
      );
    }
    if (types.has(name)) {
      throw Object.assign(
        new Error(`registerType: type "${name}" already registered`),
        { code: 'DUPLICATE_TYPE' },
      );
    }
    if (!schema || typeof schema !== 'object') {
      throw Object.assign(
        new Error('registerType: `schema` must be an object'),
        { code: 'INVALID_ARGUMENT' },
      );
    }

    let compiled;
    try {
      compiled = ajv.compile(schema);
    } catch (err) {
      throw Object.assign(
        new Error(`registerType: schema for "${name}" failed to compile: ${err?.message ?? err}`),
        { code: 'INVALID_SCHEMA', cause: err },
      );
    }

    types.set(name, { schema, iri: schema.iri ?? null });
    validators.set(name, compiled);

    if (Array.isArray(opts.aliases)) {
      for (const alias of opts.aliases) {
        if (typeof alias === 'string' && alias.length > 0 && !aliases.has(alias)) {
          aliases.set(alias, name);
        }
      }
    }
  }

  /**
   * Resolve a name through the alias table to its canonical form.
   * Returns `null` if neither the name nor any alias matches.
   */
  function _resolveName(name) {
    if (types.has(name)) return name;
    return aliases.get(name) ?? null;
  }

  /**
   * Validate an item against its declared type.
   *
   * @param {object} item   — must have `.type` matching a registered name (or alias)
   * @returns {ValidationResult}
   */
  function validate(item) {
    if (!item || typeof item !== 'object' || Array.isArray(item)) {
      return { ok: false, errors: [{ instancePath: '', message: 'item must be an object' }] };
    }
    if (typeof item.type !== 'string' || item.type.length === 0) {
      return { ok: false, errors: [{ instancePath: '/type', message: 'item.type must be a non-empty string' }] };
    }

    const canonical = _resolveName(item.type);
    if (canonical === null) {
      return { ok: false, errors: [{ instancePath: '/type', message: `unknown type: "${item.type}"` }] };
    }

    const v = validators.get(canonical);
    // Validate against the canonical schema. If the item came in
    // under an alias name, we don't rewrite item.type — the schema's
    // `type` const allows the canonical value, and aliases are a
    // pre-validation lookup convenience.
    if (item.type !== canonical) {
      // Item used an alias; temporarily clone with canonical type
      // for validation (don't mutate the caller's object).
      const probe = { ...item, type: canonical };
      const valid = v(probe);
      if (!valid) return { ok: false, errors: v.errors ?? [] };
      return { ok: true };
    }
    const valid = v(item);
    if (!valid) return { ok: false, errors: v.errors ?? [] };
    return { ok: true };
  }

  /** Return the raw schema for a type (or null). */
  function schema(typeName) {
    const canonical = _resolveName(typeName);
    if (canonical === null) return null;
    return types.get(canonical)?.schema ?? null;
  }

  /** Return metadata for a type: `{name, iri}` or `null`. */
  function metadata(typeName) {
    const canonical = _resolveName(typeName);
    if (canonical === null) return null;
    const entry = types.get(canonical);
    if (!entry) return null;
    return { name: canonical, iri: entry.iri ?? null };
  }

  /** Return all registered canonical type names. */
  function list() {
    return [...types.keys()].sort();
  }

  /** Return all alias mappings (alias → canonical). */
  function listAliases() {
    return Object.fromEntries(aliases);
  }

  /** Test-only: clear the registry. */
  function _clear() {
    types.clear();
    validators.clear();
    aliases.clear();
  }

  return {
    registerType,
    validate,
    schema,
    metadata,
    list,
    listAliases,
    _clear,
  };
}
