/**
 * The Nearby room's per-device allows (card / chat), kept across opens — this device only.
 *
 * The screen used to start from the defaults (both OFF) every time the tab opened, which threw away a
 * choice the person had just made (two-phone walk, 2026-08-30). A small synchronous cache, primed at
 * import from AsyncStorage: the first open before the prime lands sees the defaults, every later one
 * sees the choice. Never fanned, never shared — it decides what THIS device shows and joins.
 */
import { storageName } from '../../../basis/src/v2/storageRegister.js';   // every storage name from the one register
import AsyncStorage from '@react-native-async-storage/async-storage';
import { nearbyAskedKey } from '../../../basis/src/v2/nearbyLevel.js';

const KEY = storageName('nearbyAllows');
let cached = null;
AsyncStorage.getItem(KEY)
  .then((raw) => { try { cached = raw ? JSON.parse(raw) : null; } catch { cached = null; } })
  .catch(() => {});

/** @returns {{card?: boolean, chat?: boolean}|null} the stored allows, or null before the prime / when unset */
export function readNearbyAllows() { return cached; }

/**
 * The Nearby radio switch, persisted: 'on' (default) or 'off'. Off means nothing is browsed or
 * announced on the local network — at boot, at rest, and while the screen is open — until it is
 * turned back on. Same synchronous cache as the allows.
 */
const RADIO_KEY = storageName('nearbyRadio');
let radio = 'on';
AsyncStorage.getItem(RADIO_KEY).then((raw) => { if (raw === 'on' || raw === 'off') radio = raw; }).catch(() => {});
export function readNearbyRadio() { return radio; }
export function writeNearbyRadio(next) {
  if (next !== 'on' && next !== 'off') return;
  radio = next;
  AsyncStorage.setItem(RADIO_KEY, next).catch(() => {});
}

export function writeNearbyAllows(next) {
  if (!next || typeof next !== 'object') return;
  cached = { card: next.card === true, chat: next.chat === true };
  AsyncStorage.setItem(KEY, JSON.stringify(cached)).catch(() => {});
}

/**
 * Who this device enters the Nearby room as, when several selves are ticked in the header: the last answer, kept per
 * device as the question's default (nothing more durable). The rule is the shared `nearbyRoomSelf`.
 */
const SELF_KEY = storageName('nearbySelf');
let roomSelf = null;
AsyncStorage.getItem(SELF_KEY).then((raw) => { if (typeof raw === 'string' && raw) roomSelf = raw; }).catch(() => {});
export function readNearbySelf() { return roomSelf; }
export function writeNearbySelf(id) {
  if (typeof id !== 'string' || !id) return;
  roomSelf = id;
  AsyncStorage.setItem(SELF_KEY, id).catch(() => {});
}

/** The Nearby first-use question's device mark, per self (`nearbyAskedKey`): was this self asked on this device? */
export async function readNearbyAsked(selfId) {
  try { return (await AsyncStorage.getItem(`${storageName('nearbyAsked')}${selfId}`)) === '1'; } catch { return true; }
}
export function markNearbyAsked(selfId) {
  AsyncStorage.setItem(`${storageName('nearbyAsked')}${selfId}`, '1').catch(() => {});
}
