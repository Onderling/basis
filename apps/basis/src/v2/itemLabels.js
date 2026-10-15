/**
 * Which item types carry LABELS — read from the type's own schema (a `tags` field), never a list kept here. The
 * Vandaag block filter and the customise sheet both ask; a type that carries none simply ignores a labels filter.
 */
import { schema as itemTypeSchema } from '@onderling/item-types';

/** @param {string} noun  an item type name @returns {boolean} */
export function carriesLabels(noun) {
  try { return Boolean(itemTypeSchema(noun)?.properties?.tags); } catch { return false; }
}

/** A label as it is compared: trimmed, lower-case. */
export const normLabel = (x) => String(x ?? '').trim().toLowerCase();

/** "werk, thuis" → ['werk', 'thuis']; an array passes through, normalised. */
export function parseLabels(value) {
  const list = Array.isArray(value) ? value : String(value ?? '').split(',');
  return [...new Set(list.map(normLabel).filter(Boolean))];
}
