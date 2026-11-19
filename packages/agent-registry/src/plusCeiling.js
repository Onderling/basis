/**
 * How far the person's own "+" goes for a persona (the ceiling of what it offers, by an op's weight `opWeight`):
 *   0  hidden: the "+" is off for this persona; its name and things never enter a prompt
 *   1  it only looks things up
 *   2  it also makes and changes the person's own things
 *   3  it also does things in the person's circles, after their yes on a card (the default: what the "+" did before)
 * Kept on the persona as `_plus.ceiling`, inherited from the default persona like any property. A machine key (the
 * leading underscore: never released, matched or shown), on the registry's reserved list, so the person-facing property
 * op refuses it: only the ceiling's own op, which weighs as the person's control, writes it, and the "+" can never offer
 * that op (it never changes its own reach).
 */
import { resolveProperty } from './profileProperties.js';

/** The profile property that holds a persona's ceiling for the "+". */
export const PLUS_CEILING_KEY = '_plus.ceiling';
/** The four ceilings, lightest first. */
export const PLUS_CEILINGS = Object.freeze([0, 1, 2, 3]);
/** With nothing said anywhere: own things, and a circle's through the card. */
export const PLUS_CEILING_DEFAULT = 3;

/** Is it one of the four ceilings? */
export const isPlusCeiling = (v) => PLUS_CEILINGS.includes(v);

/**
 * A persona's ceiling: its own word, else the default persona's, else 3. A value that is not one of the four reads as
 * the default.
 * @param {(id: string) => object|null} getProfile @param {string} personaId
 * @param {{ defaultProfileId?: string|null }} [opts]
 * @returns {0|1|2|3}
 */
export function plusCeilingFor(getProfile, personaId, { defaultProfileId = null } = {}) {
  const said = resolveProperty(getProfile, personaId, PLUS_CEILING_KEY, { defaultProfileId });
  return isPlusCeiling(said) ? said : PLUS_CEILING_DEFAULT;
}
