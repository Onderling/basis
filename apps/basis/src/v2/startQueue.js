/**
 * basis v2 — THE START QUEUE (home: Agent · Connectivity). What a device pulls after it starts, in one order, one step
 * at a time.
 *
 * Before it, each shell fired its own dozen timers 2–4 s after the start (the web, the phone and the box each with a
 * hand-kept copy and its own timings), all at once and each walking every circle: every lane's catch-up asked every
 * circle's members, and every answer was checked as it landed, in the window where the person first taps. On a phone a
 * signature check is ~60 ms, so the circle the person opened waited behind every other circle's.
 *
 * The order:
 *   1. the circle ON SCREEN (if it is one of mine): every lane, so it can be read and written first;
 *   2. the person's OWN devices, one ask at a time, grants first (a revoke made elsewhere binds at this door before a
 *      stale view is served), then the rest in the order the shell lists them;
 *   3. every other circle, one at a time, every lane.
 * Each step is awaited, and the thread is given back between steps. A failing step stops nothing.
 */
import { createTimeSlice } from '@onderling/core';

/** The lanes pulled per circle, in this order: who is in it, what they decided, the keys, then the content. */
export const START_LANES = Object.freeze(['membership', 'gov', 'key', 'task', 'chat']);

const idOf = (c) => (typeof c === 'string' ? c : (c?.groupId ?? c?.id ?? null));

/**
 * @param {object} o
 * @param {Record<string, {requestCircle?: Function}>} o.catchUps   the lanes' catch-ups (`circleLanes(...).catchUps`)
 * @param {Array<[string, {requestFromSiblings?: Function}]>} [o.siblings]  the own-device asks, named; 'grants' goes first
 * @param {Function} o.callSkill
 * @param {() => (string|null)} [o.firstCircle]   the circle on screen when the queue starts (none on the box)
 * @param {(s: {lane?: string, sibling?: string, circleId?: string}) => void} [o.onStep]  told each step as it starts (the box logs it)
 * @param {(circleId: string) => void} [o.readFirst]  moves the on-screen circle's roster read to the front of the agent's line
 * @returns {Promise<{ circles: number, steps: number, failed: number }>}
 */
export async function runStartQueue({ catchUps = {}, siblings = [], callSkill, firstCircle = () => null, onStep = null, readFirst = null } = {}) {
  const slice = createTimeSlice();
  let steps = 0; let failed = 0;
  const step = async (fn, said) => {
    await slice();
    steps += 1;
    try { onStep?.(said); } catch { /* a report never stops the queue */ }
    try { await fn(); } catch { failed += 1; }
  };
  let circles = [];
  try { circles = ((await callSkill('pinboard', 'listMyCircles', {}))?.circles ?? []).map(idOf).filter((c) => typeof c === 'string' && c); } catch { circles = []; }
  const pullCircle = async (circleId) => {
    for (const lane of START_LANES) {
      const cu = catchUps?.[lane];
      if (typeof cu?.requestCircle !== 'function') continue;
      await step(() => cu.requestCircle(circleId, { callSkill }), { lane, circleId });
    }
  };
  let onScreen = null;
  try { onScreen = firstCircle?.() ?? null; } catch { onScreen = null; }
  if (onScreen && circles.includes(onScreen)) {
    try { readFirst?.(onScreen); } catch { /* the line reads it in its turn */ }
    await pullCircle(onScreen);
  }
  const ordered = [...siblings].sort(([a], [b]) => (a === 'grants' ? -1 : 0) - (b === 'grants' ? -1 : 0));
  for (const [name, s] of ordered) {
    if (typeof s?.requestFromSiblings === 'function') await step(() => s.requestFromSiblings(), { sibling: name });
  }
  for (const c of circles) if (c !== onScreen) await pullCircle(c);
  return { circles: circles.length, steps, failed };
}

/**
 * The person's OWN-device asks at a start, named, in one list every shell hands the queue (each was a hand-kept copy
 * per shell): grants (a revoke binds before a stale view is served), who my devices know, a rotated person key, each
 * profile's facts, my own store, which device is primary for direct messages.
 * @param {object} agent
 * @returns {Array<[string, object]>}
 */
export function startQueueSiblings(agent) {
  return [
    ['grants', agent?.grantsCatchUp],
    ['known-peers', agent?.knownPeersSync],
    ['person-key', agent?.personKeySync],
    ['profile-facts', agent?.profileFactsSync],
    ['own-store', agent?.ownStoreSync],
    ['primary-device', agent?.primaryDevice],
  ].filter(([, s]) => typeof s?.requestFromSiblings === 'function');
}
