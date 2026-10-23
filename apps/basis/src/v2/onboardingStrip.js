/**
 * THE ONBOARDING STRIP — a Vandaag block (`onboarding`), cards that go as each is done; never a modal, never in
 * the way (a person can use the app the moment it opens). One model both shells paint:
 *   0. "Bewaar je sleutel" — the recovery phrase is not saved on this device yet; the card never holds the words, its
 *      "Toon" opens them, "Later" puts it away for a while, "Opgeschreven" ends it (onboardingFlags.keyCardPending);
 *   1. "Zo heet je hier" — the handle: one field, saved through the profile op the identity line reads
 *      (`pinboard.setMyHandle`, which also tells the person's rosters); gone once a handle is set;
 *   2. "Nieuw bij Basis?" — three plain lines and "Lees meer" (the help circle's conversation); gone once seen on THIS
 *      device (a per-device mark), and never shown to a returning person (a handle and a circle: a restored device);
 *   3. "Begin" — make a circle / I have an invitation; gone once the person is in a circle (the help circle does not
 *      count).
 * The block is removable like any other; once all three are done it shows nothing at all.
 */
import { param, PARAM_SCOPE, PARAM_KIND } from '@onderling/item-store';
import { HELP_CIRCLE_ID } from './helpCircle.js';

/** How long "Later" puts the key card away. */
export const KEY_CARD_SNOOZE_DAYS = param({ key: 'onboarding.keyCardSnoozeDays', scope: PARAM_SCOPE.DEVICE, kind: PARAM_KIND.INTERNAL, default: 3 });

/** The moment a "Later" on the key card runs out, from `now`. */
export function keySnoozeUntil(now = Date.now()) {
  return now + KEY_CARD_SNOOZE_DAYS * 24 * 60 * 60 * 1000;
}

/**
 * @param {{handle: string|null, inCircle: boolean, introSeen: boolean, keyPending?: boolean}} s
 * @returns {Array<{id: 'key'|'handle'|'intro'|'begin'}>}
 */
export function onboardingCards({ handle, inCircle, introSeen, keyPending = false } = {}) {
  const hasHandle = typeof handle === 'string' && handle.trim() !== '';
  const returning = hasHandle && inCircle;
  return [
    ...(keyPending && !returning ? [{ id: 'key' }] : []),
    ...(hasHandle ? [] : [{ id: 'handle' }]),
    ...(introSeen || returning ? [] : [{ id: 'intro' }]),
    ...(inCircle ? [] : [{ id: 'begin' }]),
  ];
}

/**
 * The block's content: the cards left for this person on this device.
 * @param {{id: string}} block
 * @param {{callSkill: Function, circles?: Array<{id: string}>, allCircles?: Array<{id: string}>, introSeen?: () => Promise<boolean>, keyPending?: () => Promise<boolean>}} hostOps
 */
export async function materializeOnboarding(block, { callSkill, circles = [], allCircles = null, introSeen = async () => false, keyPending = async () => false } = {}) {
  let handle = null;
  try { handle = (await callSkill?.('pinboard', 'getMyProfile', {}))?.entry?.handle ?? null; } catch { handle = null; }
  // every circle the person is in (not only the ones the switcher shows): the help circle does not count
  const inCircle = (allCircles ?? circles ?? []).some((c) => c?.id && c.id !== HELP_CIRCLE_ID);
  let seen = false;
  try { seen = !!(await introSeen()); } catch { seen = false; }
  let keyDue = false;
  try { keyDue = !!(await keyPending()); } catch { keyDue = false; }
  const cards = onboardingCards({ handle, inCircle, introSeen: seen, keyPending: keyDue });
  return { blockId: block.id, type: 'onboarding', status: cards.length ? 'ok' : 'empty', content: { cards } };
}

/** The handle card's save: through the profile op, trimmed — or `{error}` (a locale key) when empty. */
export function handleOp(value) {
  const handle = typeof value === 'string' ? value.trim() : '';
  return handle ? { app: 'pinboard', opId: 'setMyHandle', args: { handle } } : { error: 'circle.vandaag.onboarding_handle_empty' };
}
