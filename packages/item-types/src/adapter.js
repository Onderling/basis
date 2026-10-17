/**
 * Wire-shape adapter for app integration (Phase 52.7).
 *
 * Apps in the stack carry slightly different field names for the
 * base "who/when" attribution — `@onderling/item-store` uses
 * `addedAt`/`addedBy`; the canonical `@onderling/item-types` schema
 * requires `createdAt`/`createdBy`. The adapter is a tiny mapper
 * that adapts the item-store shape to the canonical shape for
 * validation purposes (without mutating the caller's object).
 *
 * Usage in each app's write entry point:
 *
 *   import { validateCanonical } from '@onderling/item-types';
 *
 *   const result = validateCanonical(item);
 *   if (!result.ok) console.warn('item-types:', result.errors);
 *
 * Adoption is intentionally warn-only — failing validation should
 * not block a write, because:
 *   1. Pre-existing app data may not yet match the canonical
 *      schema; hard-blocking would regress live storage.
 *   2. The canonical schemas are forward-additive — adding required
 *      fields would itself be a breaking change.
 */

/**
 * Adapt an item-store-shaped item to the canonical schema's wire
 * shape. Returns a NEW object — never mutates the input.
 *
 * Field mappings (apply only when the canonical target field is
 * absent — item-store data wins when both are set):
 *   - `addedAt`     (number, ms epoch) → `createdAt` (ISO string)
 *   - `addedBy`     (webid / agentUri) → `createdBy`
 *   - `completedAt` (number)           → `updatedAt`
 *   - `completedBy`                     → `updatedBy`
 *   - `text`        (any string)       → `body`
 *
 * `text → body` covers Pinboard / Folio / generic-message item types
 * whose canonical schemas require `body` (announcement, note,
 * chat-message, offer, request, neighbourhood-job). The `task`
 * schema requires `text` natively, so the copy is harmless
 * (forward-additive: extra `body` on a task is tolerated).
 */
export function adaptForCanonical(item) {
  if (!item || typeof item !== 'object') return item;
  const out = { ...item };
  if (out.createdAt === undefined && out.addedAt !== undefined) {
    // item-store uses ms-epoch numbers; canonical wants ISO strings.
    out.createdAt = typeof out.addedAt === 'number'
      ? new Date(out.addedAt).toISOString()
      : String(out.addedAt);
  }
  if (out.createdBy === undefined && out.addedBy !== undefined) {
    out.createdBy = out.addedBy;
  }
  if (out.updatedAt === undefined && out.completedAt !== undefined) {
    out.updatedAt = typeof out.completedAt === 'number'
      ? new Date(out.completedAt).toISOString()
      : String(out.completedAt);
  }
  if (out.updatedBy === undefined && out.completedBy !== undefined) {
    out.updatedBy = out.completedBy;
  }
  if (out.body === undefined && typeof out.text === 'string') {
    out.body = out.text;
  }
  return out;
}

/**
 * Adapt + validate in one shot. Always returns a `{ok, errors?}`
 * result; never throws. Designed for warn-only adoption sites.
 */
export function makeValidateCanonical(defaultRegistry) {
  return function validateCanonical(item) {
    const adapted = adaptForCanonical(item);
    return defaultRegistry.validate(adapted);
  };
}
