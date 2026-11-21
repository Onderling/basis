/**
 * DEBUG BUILD ONLY (branch debug/l1103-count-start-writes, never merged): every AsyncStorage write in the first 30 s
 * of a start, with its time since this module loaded, its op and its key (never its value). Logged once at 30 s as
 * `[start-writes]` lines, so a second start of an unchanged phone says exactly which keys it writes (the upgrade walk's
 * check 7: wanted 0). Imported first thing after the polyfills in index.js.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';

const T0 = Date.now();
const WINDOW_MS = 30_000;
const seen = [];
const note = (op, keys) => {
  const at = Date.now() - T0;
  if (at > WINDOW_MS) return;
  for (const k of Array.isArray(keys) ? keys : [keys]) seen.push({ at, op, key: String(k) });
};
const wrap = (name, keysOf) => {
  const orig = AsyncStorage[name];
  if (typeof orig !== 'function') return;
  AsyncStorage[name] = function counted(...args) {
    try { note(name, keysOf(...args)); } catch { /* never breaks a write */ }
    return orig.apply(this, args);
  };
};
wrap('setItem', (k) => k);
wrap('removeItem', (k) => k);
wrap('mergeItem', (k) => k);
wrap('multiSet', (pairs) => (Array.isArray(pairs) ? pairs.map((p) => p?.[0]) : []));
wrap('multiRemove', (keys) => keys);
wrap('multiMerge', (pairs) => (Array.isArray(pairs) ? pairs.map((p) => p?.[0]) : []));

setTimeout(() => {
  const early = seen.filter((w) => w.at <= 1400).length;
  console.log(`[start-writes] ${seen.length} writes in the first 30 s (${early} in the first 1.4 s)`);
  for (const w of seen) console.log(`[start-writes] +${w.at}ms ${w.op} ${w.key}`);
}, WINDOW_MS + 500);
