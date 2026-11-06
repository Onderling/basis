/**
 * THE ONBOARDING STRIP — a Vandaag block (`onboarding`), cards that go as each is done; never a modal, never in
 * the way (a person can use the app the moment it opens). One model both shells paint:
 *   0. "Bewaar je sleutel" — the recovery phrase is not saved on this device yet; the card never holds the words, its
 *      "Toon" opens them, "Later" puts it away for a while, "Opgeschreven" ends it (onboardingFlags.keyCardPending) —
 *      for everyone, a returning person included (they lose the most if the device dies);
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
import { isValidHandle, handleSuggestions } from '../core/wizards/joinGroupState.js';

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
    ...(keyPending ? [{ id: 'key' }] : []),
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
  let name = null;   // the display name already on the profile: the card shows it, so a person sees the name the avatar uses
  try {
    const entry = (await callSkill?.('pinboard', 'getMyProfile', {}))?.entry ?? null;
    handle = entry?.handle ?? null;
    name = typeof entry?.displayName === 'string' && entry.displayName.trim() ? entry.displayName.trim() : null;
  } catch { handle = null; }
  // every circle the person is in (not only the ones the switcher shows): the help circle does not count
  const inCircle = (allCircles ?? circles ?? []).some((c) => c?.id && c.id !== HELP_CIRCLE_ID);
  let seen = false;
  try { seen = !!(await introSeen()); } catch { seen = false; }
  let keyDue = false;
  try { keyDue = !!(await keyPending()); } catch { keyDue = false; }
  const cards = onboardingCards({ handle, inCircle, introSeen: seen, keyPending: keyDue })
    .map((c) => (c.id === 'handle' && name ? { ...c, name } : c));
  return { blockId: block.id, type: 'onboarding', status: cards.length ? 'ok' : 'empty', content: { cards } };
}

/**
 * THE NAME CARD'S SAVE. The card asks for a NAME ("Zo heet je hier"), and a person types one: "Tester B". That is
 * their display name, set as typed; the handle — the circle's unique, lowercase word — is made from it ("tester-b"),
 * and a handle someone else holds gets a suffix ("tester-b2") rather than a refusal the person would have to
 * understand. Before this the card saved the typed text AS the handle: "Tester B" was refused, both shells dropped
 * the refusal, and the card came back empty (walk, 2026-11-05).
 *
 * @param {string} value  what was typed
 * @param {{ callSkill: (app: string, op: string, args?: object) => Promise<any> }} host
 * @returns {Promise<{ ok: true, name: string, handle: string } | { ok: false, error: string }>}  `error` is a locale key
 */
export async function saveNameCard(value, { callSkill } = {}) {
  const name = typeof value === 'string' ? value.trim() : '';
  if (!name) return { ok: false, error: 'circle.vandaag.onboarding_handle_empty' };
  const base = isValidHandle(name.toLowerCase()) ? name.toLowerCase() : (handleSuggestions(name)[0] ?? null);
  if (!base) return { ok: false, error: 'circle.vandaag.onboarding_handle_unusable' };
  if (typeof callSkill !== 'function') return { ok: false, error: 'circle.vandaag.onboarding_handle_failed' };
  const shown = await Promise.resolve(callSkill('pinboard', 'setMyDisplayName', { displayName: name })).catch(() => null);
  if (!shown || shown.error) return { ok: false, error: 'circle.vandaag.onboarding_handle_failed' };
  // the handle: the made word, else the same with a number — the first one nobody holds
  for (const candidate of [base, ...[2, 3, 4, 5, 6, 7, 8, 9].map((n) => `${base}${n}`)].filter(isValidHandle)) {
    const r = await Promise.resolve(callSkill('pinboard', 'setMyHandle', { handle: candidate })).catch(() => null);
    if (r && !r.error) return { ok: true, name, handle: candidate };
    if (r?.reason !== 'handle-taken') return { ok: false, error: 'circle.vandaag.onboarding_handle_failed' };
  }
  return { ok: false, error: 'circle.vandaag.onboarding_handle_failed' };
}

/** What the card says after its save — never silence: "Opgeslagen — je heet hier Tester B", or why not. */
export function nameCardWords(result, t) {
  return result?.ok ? t('circle.vandaag.onboarding_handle_saved', { name: result.name }) : t(result?.error ?? 'circle.vandaag.onboarding_handle_failed');
}
