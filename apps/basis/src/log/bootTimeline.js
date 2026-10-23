/**
 * The boot timeline: one logger line per startup step (`boot/<step>`, `ms` since the first mark, `dt` since the
 * previous one), so a slow start says where its time went. Codes and numbers only, like every logger line.
 *
 * And the JS-thread stall watch: a timer that should fire every `everyMs`; when it fires late by more than
 * `overMs`, the thread was busy that long and it logs `jsthread/stall {lag}`. Started by test builds only,
 * so a release build's ring buffer is not filled with it.
 */
import { log } from '@onderling/logger';

let t0 = null;
let last = null;

/**
 * @param {string} step  a short code: 'js.start', 'agent.ready', 'launcher.paint', …
 * @param {object} [fields]  scalar extras
 * @param {number} [now]
 */
export function bootMark(step, fields = {}, now = Date.now()) {
  if (t0 === null) { t0 = now; last = now; }
  log.info('boot', step, { ...fields, ms: now - t0, dt: now - last });
  last = now;
}

/** Forget the timeline's start (tests). */
export function resetBootTimeline() { t0 = null; last = null; }

/**
 * @param {{ everyMs?: number, overMs?: number, now?: () => number, setInterval?: Function, clearInterval?: Function }} [o]
 * @returns {() => void} stop
 */
export function startStallWatch({
  everyMs = 100, overMs = 200, now = () => Date.now(),
  setInterval: si = globalThis.setInterval, clearInterval: ci = globalThis.clearInterval,
} = {}) {
  let prev = now();
  const id = si(() => {
    const at = now();
    const lag = at - prev - everyMs;
    if (lag > overMs) log.warn('jsthread', 'stall', { lag });
    prev = at;
  }, everyMs);
  return () => ci(id);
}
