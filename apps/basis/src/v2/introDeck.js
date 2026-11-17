/**
 * THE INTRODUCTION — seven short cards a new person can read once: what Basis is, circles, contacts, the "+", selves,
 * Nearby, the recovery phrase. One card per screen, "Next" (the last one: "Get started"), "Skip" under each. Opened from
 * Today's "New to Basis?" card ("Read more"); both shells paint this one model, so the cards, their order and the
 * buttons cannot drift between web and the phone.
 *
 * The words live in the locale files (`circle.introDeck.*`); this file only orders them and says which buttons a step
 * has. The shells mark the intro seen on this device when the deck OPENS (`onboardingFlags.markIntroSeen`, as "Read
 * more" did before), so Today's card goes once it is opened, however the deck is left.
 */

/** The cards, in order: each id names its title and body keys (`circle.introDeck.<id>_title` / `_body`). */
export const INTRO_CARDS = Object.freeze(['welcome', 'circles', 'contacts', 'plus', 'selves', 'nearby', 'keys']);

/**
 * What one step of the deck shows.
 * @param {number} index  0-based; clamped into the deck
 * @returns {{ index: number, id: string, titleKey: string, bodyKey: string, isLast: boolean, nextKey: string,
 *   skipKey: string, position: { at: number, of: number } }}
 */
export function introStep(index = 0) {
  const last = INTRO_CARDS.length - 1;
  const i = Math.min(Math.max(0, Number.isInteger(index) ? index : 0), last);
  const id = INTRO_CARDS[i];
  return {
    index: i,
    id,
    titleKey: `circle.introDeck.${id}_title`,
    bodyKey: `circle.introDeck.${id}_body`,
    isLast: i === last,
    // the last card's button leaves the deck for Today; the others turn the page
    nextKey: i === last ? 'circle.introDeck.start' : 'circle.introDeck.next',
    skipKey: 'circle.introDeck.skip',
    position: { at: i + 1, of: INTRO_CARDS.length },
  };
}

/**
 * Where "Next" leads: the following step, or `null` when the deck is done (the shell closes it, marks it seen and
 * shows Today).
 * @param {number} index
 * @returns {number|null}
 */
export function introNext(index) {
  const step = introStep(index);
  return step.isLast ? null : step.index + 1;
}
