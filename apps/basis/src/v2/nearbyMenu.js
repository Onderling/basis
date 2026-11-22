/**
 * nearbyMenu — what Nearby's gear menu holds, and what a choice in it writes: decided once here, so the web and the
 * phone offer the same menu and a choice does the same thing on both. The menu moves existing switches together; it
 * adds no setting and changes nothing the room is sent:
 *  - "how you are here": Zichtbaar (the room self's level, at least the floor), Even stil (the controller's
 *    session-only quiet), Helemaal uit (the persisted radio switch);
 *  - who you appear as (the room-self picker and the level's finer steps open behind "Change");
 *  - your card and what you offer (the card's own switch, `allows.card`, sits in that editor and keeps its value);
 *  - the chat switch (`allows.chat`), with what being out of the chat means;
 *  - the introduction again.
 */
import { nearbyVisibilityKey } from './nearbyScreen.js';

/** The three ways to be here, in the menu's order. */
export const NEARBY_HERE = Object.freeze(['visible', 'quiet', 'off']);

const HERE_WORDS = Object.freeze({
  visible: { labelKey: 'circle.nearbyScreen.here_visible', bodyKey: 'circle.nearbyScreen.here_visible_body' },
  quiet:   { labelKey: 'circle.nearbyScreen.here_quiet',   bodyKey: 'circle.nearbyScreen.here_quiet_body' },
  off:     { labelKey: 'circle.nearbyScreen.here_off',     bodyKey: 'circle.nearbyScreen.here_off_body' },
});

/** The level "Zichtbaar" writes when the room self has none: the floor (default-strict, the least that is visible). */
const VISIBLE_FLOOR = 'handle';

/**
 * Which of the three holds now, from the controller's report. No level chosen yet ("Alleen kijken" on first use: only
 * the device's asked-mark) holds none of them: the screen shows it as hidden, but the person did not pick "Even stil".
 * @param {object|null} visibility  `createNearbyScreen().visibility()`
 * @returns {'visible'|'quiet'|'off'|null}
 */
export function nearbyHereNow(visibility) {
  if (!visibility) return null;
  if (visibility.radioOff) return 'off';
  if (visibility.quiet) return 'quiet';
  if (visibility.levelChosen === false) return null;
  const key = nearbyVisibilityKey(visibility);
  return key === 'unavailable' ? null : 'visible';
}

/**
 * What a choice writes. `level`: the level to set, or null to keep the one there (a level above none is never
 * overwritten); `quiet`: the session switch, or null to leave it; `radio`: 'on'/'off', or null to leave it (a radio
 * that is off comes back on for Zichtbaar and Even stil: both see the room).
 * @param {'visible'|'quiet'|'off'} choice
 * @param {{level?: string|null, visibility?: object|null}} now
 * @returns {{level: string|null, quiet: boolean|null, radio: 'on'|'off'|null}|null}  null for an unknown choice
 */
export function nearbyHereWrites(choice, { level = null, visibility = null } = {}) {
  const radioBack = visibility?.radioOff ? 'on' : null;
  if (choice === 'visible') return { level: (!level || level === 'none') ? VISIBLE_FLOOR : null, quiet: false, radio: radioBack };
  if (choice === 'quiet') return { level: null, quiet: true, radio: radioBack };
  if (choice === 'off') return { level: null, quiet: null, radio: 'off' };
  return null;
}

/**
 * Run a choice through the host's own acts, the level first (going visible then announces at the level just written)
 * and stop when the level could not be written (nothing is announced at a level that is not there).
 * @param {'visible'|'quiet'|'off'} choice
 * @param {{level?: string|null, visibility?: object|null}} now
 * @param {{setLevel?: Function, setQuiet?: Function, setRadio?: Function}} acts  the host's: its level writer
 *   (`{ok}`), the controller's `setQuiet` and `setRadio`
 * @returns {Promise<{ok: boolean, reason?: string}>}
 */
export async function nearbyHereChoose(choice, now, { setLevel, setQuiet, setRadio } = {}) {
  const w = nearbyHereWrites(choice, now);
  if (!w) return { ok: false, reason: 'unknown' };
  if (w.level) {
    let r = null;
    try { r = await setLevel?.(w.level); } catch { r = null; }
    if (!r?.ok) return { ok: false, reason: 'level_not_set' };
  }
  if (w.radio) setRadio?.(w.radio);
  if (w.quiet !== null) setQuiet?.(w.quiet);
  return { ok: true };
}

/**
 * The menu for this room: the choices this host can carry (a host without a radio control, the web, offers only
 * Zichtbaar), the one that holds now, and the chat row.
 * @param {{visibility?: object|null, allows?: {card?: boolean, chat?: boolean}, can?: {quiet?: boolean, radio?: boolean}}} a
 */
export function nearbyMenu({ visibility = null, allows = {}, can = {} } = {}) {
  const carried = { visible: true, quiet: can.quiet === true, off: can.radio === true };
  const choices = NEARBY_HERE.filter((id) => carried[id]).map((id) => ({ id, ...HERE_WORDS[id] }));
  const chatOn = allows?.chat === true;
  return {
    titleKey: 'circle.nearbyScreen.menu_title',
    here: { titleKey: 'circle.nearbyScreen.menu_here', choices, selected: nearbyHereNow(visibility) },
    show: { titleKey: 'circle.nearbyScreen.menu_show', appearAsKey: 'circle.nearbyScreen.menu_appear_as', changeKey: 'circle.nearbyScreen.menu_change', cardKey: 'circle.nearbyScreen.menu_card' },
    chat: { on: chatOn, labelKey: 'circle.nearbyScreen.allow_chat', offKey: chatOn ? null : 'circle.nearbyScreen.menu_chat_off' },
    introKey: 'circle.nearbyScreen.menu_intro_again',
  };
}
