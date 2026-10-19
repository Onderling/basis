/**
 * THE ONBOARDING STRIP — a Vandaag block (`onboarding`), three cards that go as each is done; never a modal, never in
 * the way (a person can use the app the moment it opens). One model both shells paint:
 *   1. "Zo heet je hier" — the handle: one field, saved through the profile op the identity line reads
 *      (`pinboard.setMyHandle`, which also tells the person's rosters); gone once a handle is set;
 *   2. "Nieuw bij Basis?" — three plain lines and "Lees meer" (the help circle's conversation); gone once seen on THIS
 *      device (a per-device mark), and never shown to a returning person (a handle and a circle: a restored device);
 *   3. "Begin" — make a circle / I have an invitation; gone once the person is in a circle (the help circle does not
 *      count).
 * The block is removable like any other; once all three are done it shows nothing at all.
 */
import { HELP_CIRCLE_ID } from './helpCircle.js';

/**
 * @param {{handle: string|null, inCircle: boolean, introSeen: boolean}} s
 * @returns {Array<{id: 'handle'|'intro'|'begin'}>}
 */
export function onboardingCards({ handle, inCircle, introSeen } = {}) {
  const hasHandle = typeof handle === 'string' && handle.trim() !== '';
  const returning = hasHandle && inCircle;
  return [
    ...(hasHandle ? [] : [{ id: 'handle' }]),
    ...(introSeen || returning ? [] : [{ id: 'intro' }]),
    ...(inCircle ? [] : [{ id: 'begin' }]),
  ];
}

/**
 * The block's content: the cards left for this person on this device.
 * @param {{id: string}} block
 * @param {{callSkill: Function, circles?: Array<{id: string}>, allCircles?: Array<{id: string}>, introSeen?: () => Promise<boolean>}} hostOps
 */
export async function materializeOnboarding(block, { callSkill, circles = [], allCircles = null, introSeen = async () => false } = {}) {
  let handle = null;
  try { handle = (await callSkill?.('pinboard', 'getMyProfile', {}))?.entry?.handle ?? null; } catch { handle = null; }
  // every circle the person is in (not only the ones the switcher shows): the help circle does not count
  const inCircle = (allCircles ?? circles ?? []).some((c) => c?.id && c.id !== HELP_CIRCLE_ID);
  let seen = false;
  try { seen = !!(await introSeen()); } catch { seen = false; }
  const cards = onboardingCards({ handle, inCircle, introSeen: seen });
  return { blockId: block.id, type: 'onboarding', status: cards.length ? 'ok' : 'empty', content: { cards } };
}

/** The handle card's save: through the profile op, trimmed — or `{error}` (a locale key) when empty. */
export function handleOp(value) {
  const handle = typeof value === 'string' ? value.trim() : '';
  return handle ? { app: 'pinboard', opId: 'setMyHandle', args: { handle } } : { error: 'circle.vandaag.onboarding_handle_empty' };
}
