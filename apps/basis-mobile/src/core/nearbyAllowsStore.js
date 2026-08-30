/**
 * The Nearby room's per-device allows (card / chat), kept across opens — this device only.
 *
 * The screen used to start from the defaults (both OFF) every time the tab opened, which threw away a
 * choice the person had just made (two-phone walk, 2026-08-30). A small synchronous cache, primed at
 * import from AsyncStorage: the first open before the prime lands sees the defaults, every later one
 * sees the choice. Never fanned, never shared — it decides what THIS device shows and joins.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';

const KEY = 'cc.nearbyAllows';
let cached = null;
AsyncStorage.getItem(KEY)
  .then((raw) => { try { cached = raw ? JSON.parse(raw) : null; } catch { cached = null; } })
  .catch(() => {});

/** @returns {{card?: boolean, chat?: boolean}|null} the stored allows, or null before the prime / when unset */
export function readNearbyAllows() { return cached; }

/**
 * "You here" opens on the FIRST-ever open of Nearby only (L66a): true once, then never again.
 * Synchronous like the allows cache; before the prime lands the answer is false (folded), which only
 * costs the very first open on a cold cache — honest enough.
 */
const SEEN_KEY = 'cc.nearbyMineSeen';
let seen = true;
AsyncStorage.getItem(SEEN_KEY).then((raw) => { seen = raw === '1'; }).catch(() => {});
export function firstNearbyMineOpen() {
  if (seen) return false;
  seen = true;
  AsyncStorage.setItem(SEEN_KEY, '1').catch(() => {});
  return true;
}

export function writeNearbyAllows(next) {
  if (!next || typeof next !== 'object') return;
  cached = { card: next.card === true, chat: next.chat === true };
  AsyncStorage.setItem(KEY, JSON.stringify(cached)).catch(() => {});
}
