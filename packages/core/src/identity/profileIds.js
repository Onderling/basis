/**
 * Persona (profile) ids — a stable LABEL, never the display name.
 *
 * The id is what every key of a persona derives from (`deriveAgentSeed(id)`, `deriveProfileAuthority(id)`), so it can
 * never change: renaming a persona changes a property, not the id. Before this the typed name WAS the label, so a
 * rename would have re-keyed the persona, and a persona called "first-device" would have collided with the label the
 * first device's id derives from.
 *
 * `'default'` stays `'default'`: the person's first persona, the one every device runs.
 */
import nacl from 'tweetnacl';

/** Labels the owner root already derives other things from — never a persona's id. */
export const RESERVED_PROFILE_LABELS = Object.freeze(['first-device', 'household-export']);

const ID_SHAPE = /^(default|p-[0-9a-f]{12})$/;

/** Is this label one the root uses for something other than a persona? */
export function isReservedProfileLabel(label) {
  return RESERVED_PROFILE_LABELS.includes(String(label));
}

/**
 * Throw unless `id` is a persona id: `'default'` or a minted `p-<12 hex>`, and not a reserved label.
 * @param {string} id
 * @returns {string} the id
 */
export function assertProfileId(id) {
  if (typeof id !== 'string' || !id) throw new Error('profile id: a non-empty string is required');
  if (isReservedProfileLabel(id)) throw new Error(`profile id: "${id}" is reserved by the owner root`);
  if (!ID_SHAPE.test(id)) throw new Error(`profile id: "${id}" is not an id (default, or p-<12 hex>) — a name is a property`);
  return id;
}

/** Mint a fresh persona id, `p-<12 hex>` (48 random bits: unique within one person's handful of personas). */
export function mintProfileId() {
  let hex = '';
  for (const b of nacl.randomBytes(6)) hex += b.toString(16).padStart(2, '0');
  return `p-${hex}`;
}
