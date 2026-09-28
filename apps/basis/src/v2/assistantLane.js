/**
 * assistantLane — the assistant takes one thread's lines one turn at a time, and gathers quick lines into one turn.
 *
 * A LANE per thread: a line waits until the thread's turn before it has finished, so a second quick line sees the
 * first one's result (in memory, in a form the first turn asked for) instead of racing it. Lines of different threads
 * each have their own lane and run side by side.
 *
 * The COLLECT WINDOW: a line the assistant has to understand waits up to `collectMs` from its arrival for more lines of
 * the same thread; the lines that are there when the window closes — and any that queued up while a turn ran — are
 * ONE turn. "melk", "brood", "eieren" typed within a second are one turn with three adds, not three model calls. A lone
 * line waits no longer than the window.
 *
 * A line the door takes itself (an answer to the form it asked, a confirmation, a slash command, a button tap) is
 * never gathered: `prepare` names it, and it is its own turn in the lane.
 *
 * Pure over its callbacks and `setTimeout`; the assistant engine composes it, so every door gets it.
 */
import { param, PARAM_SCOPE, PARAM_KIND } from '@onderling/item-store';

/** How long a line the assistant has to understand waits for more lines of the same thread, in ms. */
export const COLLECT_MS = param({ key: 'assistant.collectMs', scope: PARAM_SCOPE.DEVICE, kind: PARAM_KIND.INTERNAL, default: 1500 });

/**
 * @template T
 * @param {object} a
 * @param {number} [a.collectMs]  the collect window (0: no wait; lines that queued during a turn are still gathered)
 * @param {(entry: T) => ({own: () => Promise<any>} | {collect: boolean})} a.prepare  called when the entry reaches the
 *        front of its lane (and for each line gathered behind it): the door's own handling, or whether it may be
 *        gathered with other lines
 * @param {(turn: {key: string, entries: T[]}) => Promise<any>} a.runTurn  run one gathered turn
 * @param {(turn: {key: string, entries: T[], own: boolean}, run: () => Promise<any>) => Promise<any>} [a.around]
 *        wraps every turn (the door's bookkeeping: its record of the turn, what it remembers afterwards)
 */
export function createThreadLanes({ collectMs = COLLECT_MS, prepare, runTurn, around = (_turn, run) => run() }) {
  /** key → { queue: Array<{entry, at, resolve, reject}>, busy: boolean, idle: Array<() => void> } */
  const lanes = new Map();

  function laneFor(key) {
    let lane = lanes.get(key);
    if (!lane) { lane = { queue: [], busy: false, idle: [] }; lanes.set(key, lane); }
    return lane;
  }

  async function drain(key, lane) {
    lane.busy = true;
    try {
      while (lane.queue.length) {
        const head = lane.queue[0];
        let plan;
        try { plan = prepare(head.entry); } catch (err) { lane.queue.shift(); head.reject(err); continue; }
        let taken;
        if (typeof plan?.own === 'function') {
          taken = [lane.queue.shift()];
          await settle(taken, () => around({ key, entries: [head.entry], own: true }, plan.own));
          continue;
        }
        if (plan?.collect) {
          const wait = head.at + Math.max(0, Number(collectMs) || 0) - Date.now();
          if (wait > 0) await new Promise((r) => setTimeout(r, wait));
          taken = [lane.queue.shift()];
          // Gather the lines behind it that may join (stop at the first the door takes itself, or a command).
          while (lane.queue.length) {
            let next;
            try { next = prepare(lane.queue[0].entry); } catch { break; }
            if (typeof next?.own === 'function' || !next?.collect) break;
            taken.push(lane.queue.shift());
          }
        } else {
          taken = [lane.queue.shift()];
        }
        const turn = { key, entries: taken.map((q) => q.entry), own: false };
        await settle(taken, () => around(turn, () => runTurn(turn)));
      }
    } finally {
      lane.busy = false;
      lanes.delete(key);
      for (const done of lane.idle.splice(0)) done();
    }
  }

  /** Run a turn; every line in it gets the turn's result (or its error). A failed turn never stops the lane. */
  async function settle(taken, fn) {
    try {
      const r = await fn();
      for (const q of taken) q.resolve(r);
    } catch (err) {
      for (const q of taken) q.reject(err);
    }
  }

  return {
    /** Queue a line on its thread's lane; resolves with the result of the turn it became part of. */
    push(key, entry) {
      return new Promise((resolve, reject) => {
        const lane = laneFor(key);
        lane.queue.push({ entry, at: Date.now(), resolve, reject });
        if (!lane.busy) drain(key, lane);
      });
    },
    /** Resolves when the thread's lane has nothing queued or running (all lanes when `key` is omitted). */
    idle(key) {
      const keys = key === undefined ? [...lanes.keys()] : [key];
      return Promise.all(keys.map((k) => {
        const lane = lanes.get(k);
        return lane ? new Promise((r) => lane.idle.push(r)) : undefined;
      })).then(() => undefined);
    },
  };
}
