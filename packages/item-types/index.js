/**
 * @onderling/item-types — cross-app item-type taxonomy + JSON
 * Schema validation.
 *
 * The default export is a registry pre-loaded with the canonical
 * types. Apps that want a fresh registry call `createRegistry()`
 * and `registerCanonicalTypes(reg)` themselves.
 *
 * Standardisation Phase 52.1 — see
 * `Project Files/Substrates/substrates-v2-coding-plan-2026-05-11.md`.
 */

import { createRegistry }           from './src/registry.js';
export { SYSTEM_STOOP_TYPES, isNoticeboardPost } from './src/noticeboardPost.js';
import { registerCanonicalTypes }   from './src/canonical.js';

// Pre-load the default canonical registry.
const _defaultRegistry = createRegistry();
registerCanonicalTypes(_defaultRegistry);

/** Validate an item against its declared type via the default registry. */
export const validate     = (item) => _defaultRegistry.validate(item);
/** Get the raw schema for a type via the default registry. */
export const schema       = (typeName) => _defaultRegistry.schema(typeName);
/** Get metadata for a type via the default registry. */
export const metadata     = (typeName) => _defaultRegistry.metadata(typeName);
/** List every registered canonical type name. */
export const list         = () => _defaultRegistry.list();
/** Register a new type on the default registry (app-extension path). */
export const registerType = (name, schemaDef, opts) =>
  _defaultRegistry.registerType(name, schemaDef, opts);

// Lower-level surface for callers that want a fresh registry.
export { createRegistry }         from './src/registry.js';
export { registerCanonicalTypes } from './src/canonical.js';
export { CANONICAL_TYPES }        from './src/canonical.js';
export { NAMESPACE }              from './src/baseSchema.js';
export { EMBEDS_SCHEMA }          from './src/embedsSchema.js';

// App-adoption helpers (Phase 52.7) — adapt item-store-style items
// (addedAt/addedBy/text) to the canonical schema shape before validation.
import { adaptForCanonical }            from './src/adapter.js';
export { adaptForCanonical, makeValidateCanonical } from './src/adapter.js';

/** Adapt + validate via the default registry. Returns `{ok, errors?}`. */
export const validateCanonical = (item) => _defaultRegistry.validate(adaptForCanonical(item));
