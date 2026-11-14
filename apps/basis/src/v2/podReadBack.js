/**
 * WHEN A DEVICE READS ITS CIRCLES' POD BACK. A pod-only or pod-signal circle's messages wait on the circle's pod; the
 * pod chat catch-up reads them back. It ran once per start (web: 1.5 s after the agent was up; mobile: once per process,
 * plus the OS background slot), so a device whose relay was out of reach at that one moment read nothing until the next
 * start. The read-back now also runs:
 *   - when a circle is OPENED (the shared active circle changes to it): that circle;
 *   - when the page or app comes back to the FRONT: every live circle.
 * No timer: those are the moments a person looks. One read per circle at a time (a second ask while one runs joins it).
 * Both shells compose it (seam `pod-read-back`); each supplies only how "back to the front" is heard.
 */
import { subscribeActiveCircle } from './activeCircle.js';

/**
 * @param {object} a
 * @param {{ catchUpCircle: (circleId: string) => Promise<{ingested: number}> }|null} a.catchUp  the pod chat catch-up
 * @param {() => Promise<string[]>} a.listCircleIds   the device's live circles
 * @param {(fn: (circleId: string|null) => void) => (() => void)} [a.subscribeOpened]  defaults to the shared active circle
 * @returns {{ onCircleOpened: Function, onForeground: Function, stop: Function }}
 */
export function createPodReadBack({ catchUp, listCircleIds, subscribeOpened = subscribeActiveCircle } = {}) {
  const running = new Map();   // circleId → the read in flight
  const one = (circleId) => {
    if (!catchUp || typeof catchUp.catchUpCircle !== 'function' || typeof circleId !== 'string' || !circleId) return Promise.resolve({ ingested: 0 });
    if (running.has(circleId)) return running.get(circleId);
    const p = Promise.resolve().then(() => catchUp.catchUpCircle(circleId))
      .catch(() => ({ ingested: 0 }))
      .finally(() => { running.delete(circleId); });
    running.set(circleId, p);
    return p;
  };
  const onCircleOpened = (circleId) => one(circleId);
  async function onForeground() {
    let ids = [];
    try { ids = (await listCircleIds?.()) ?? []; } catch { ids = []; }
    let ingested = 0;
    for (const id of ids) ingested += (await one(id))?.ingested ?? 0;
    return { ingested };
  }
  const unsubscribe = typeof subscribeOpened === 'function' ? subscribeOpened((cid) => { if (cid) one(cid); }) : null;
  return { onCircleOpened, onForeground, stop: () => { try { unsubscribe?.(); } catch { /* */ } } };
}
