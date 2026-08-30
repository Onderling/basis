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

export function writeNearbyAllows(next) {
  if (!next || typeof next !== 'object') return;
  cached = { card: next.card === true, chat: next.chat === true };
  AsyncStorage.setItem(KEY, JSON.stringify(cached)).catch(() => {});
}
