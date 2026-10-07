/**
 * personClock — the person's own clock on web and mobile: ONE host tick, ticking only while the app is in front.
 *
 * A phone does not keep a loop alive in the background (the OS decides), so the honest shape is: the app paints what is
 * due while it is open, and an always-on device of the person (a companion) is what delivers on time. The tick's timer
 * is the foreground cadence (`@onderling/online-cadence`): in front it ticks, in the background it stops, back in front
 * it resumes. On web the page's visibility is the app state. Its one job: the intentions runner over the person's OWN
 * rows (their own store — never a circle's: a circle row is run by a host that may act for its author).
 */
import { createHostTick, foregroundTimers } from './hostTick.js';
import { createIntentionBook } from './intentionBook.js';
import { createIntentionRunner } from './intentionRunner.js';

/** The page's visibility as an app state: 'active' when it can be seen, 'background' when it cannot. */
export function webAppState(doc = globalThis.document) {
  const now = () => (doc?.visibilityState === 'hidden' ? 'background' : 'active');
  return {
    get currentState() { return now(); },
    addEventListener(type, cb) {
      if (type !== 'change' || typeof doc?.addEventListener !== 'function') return { remove() {} };
      const h = () => cb(now());
      doc.addEventListener('visibilitychange', h);
      return { remove: () => doc.removeEventListener('visibilitychange', h) };
    },
  };
}

/**
 * The person's clock: their own rows, run while the app is in front, as the person (their own agent's call).
 * @param {object} a
 * @param {{ownStore: () => Promise<object>, callSkill: Function, identity?: object}} a.agent
 * @param {{append: Function, query: Function}} a.log   the device log (the runner's done-marks)
 * @param {string} [a.tz]   the zone wall-clock triggers are read in (default: the device's)
 * @param {object} a.AppState   React Native's AppState, or `webAppState()`
 * @param {(o: object) => Promise<object>} [a.run]   how a due row runs (default: the op through the person's own agent)
 * @param {(e: object) => void} [a.onFired]
 * @param {(e: object) => void} [a.onError]
 */
export async function createPersonClock({ agent, log, tz = null, AppState, run = null, onFired = null, onError = null }) {
  // the device's zone, read here (a phone screen does not reach for Intl itself)
  if (!tz) { try { tz = Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC'; } catch { tz = 'UTC'; } }
  const store = await agent.ownStore();
  const book = createIntentionBook({ store, actor: agent.identity?.chat?.pubKey ?? 'me' });
  await book.load();
  const tick = createHostTick({ timers: foregroundTimers({ AppState }), onError });
  const runner = createIntentionRunner({
    book, log, tz, onFired,
    run: run ?? ((o) => agent.callSkill(o.appOrigin ?? 'basis', o.op, { ...o.args, occurrence: o.id })),
  });
  tick.add('intentions', { every: 60_000, run: () => runner.pass() });
  return { tick, book, runner, start: () => tick.start(), stop: () => tick.stop() };
}

// the foreground timer lives with the clock it drives
export { foregroundTimers } from './hostTick.js';
