/**
 * wireCalendarEmission — Tasks.
 *
 * Subscribes a per-member calendar-emission listener to the circle's
 * itemStore. On every relevant event, debounce 60 s, then rebuild the
 * `.ics` for that member and write it to a configurable pod path.
 *
 * Path convention:
 *   <member-pod>/tasks/calendars/<circleId>.ics
 *
 * In local-only mode (no pod attached) the path is still meaningful —
 * the local-store cache stores it under the same key, and a future
 * pod-attach pushes the latest snapshot upstream.
 *
 * `getCalendarEmissionUrl()` (skill) hands the user the URL they
 * paste into their phone calendar app. URL resolution is the caller's
 * responsibility — returns the `mem://` path; the agent-ui's
 * static-file overlay translates that to a `https://` URL when the
 * UI is reachable.
 */

import { buildIcsFor, buildCancellationIcs, diffRemoved } from './emitter.js';
import { param, PARAM_SCOPE, PARAM_KIND } from '@onderling/core';

// Parameter register (#36) — emission debounce window (scope:device, kind:internal).
const DEFAULT_DEBOUNCE_MS = param({ key: 'calendarEmission.debounceMs', scope: PARAM_SCOPE.DEVICE, kind: PARAM_KIND.INTERNAL, default: 60_000 });
const RELEVANT_EVENTS = [
  'item-added', 'item-completed', 'item-removed',
  'item-submitted', 'item-rejected', 'item-revoked',
];

/**
 * @param {object} args
 * @param {object} args.itemStore             — emits the events above
 * @param {object} args.dataSource            — local-store cache
 * @param {object} args.circle                  — live circle config
 * @param {string} args.member                — webid of the calendar's owner
 * @param {string} [args.path]                — defaults to per-circle mem:// path
 * @param {number} [args.debounceMs=60000]
 * @param {() => number} [args.now]
 * @returns {{ detach: () => void, flushNow: () => Promise<void> }}
 *   `flushNow` forces an immediate write — useful for tests.
 */
export function wireCalendarEmission({
  itemStore,
  dataSource,
  circle,
  member,
  path,
  debounceMs = DEFAULT_DEBOUNCE_MS,
  now = () => Date.now(),
}) {
  if (!itemStore?.on)        throw new TypeError('wireCalendarEmission: itemStore (emitter) required');
  if (!dataSource?.write)    throw new TypeError('wireCalendarEmission: dataSource required');
  if (typeof member !== 'string' || !member) {
    throw new TypeError('wireCalendarEmission: member (webid) required');
  }
  const circleId = circle?.circleId ?? 'unknown';
  const fullPath = path ?? defaultEmissionPath(circleId);

  let timer = null;
  let lastIcs = null;
  let prevTasks = [];

  async function rebuild() {
    timer = null;
    const open   = await itemStore.listOpen();
    const closed = await itemStore.listClosed();
    const tasks  = [...open, ...closed];

    // Diff for cancellations BEFORE writing the main ics.
    const removed = diffRemoved(prevTasks, tasks);
    if (removed.length > 0) {
      try {
        const cancelIcs = buildCancellationIcs(removed, { circleId });
        if (cancelIcs) {
          // Cancellation goes into the same file (clients de-dup by UID
          // + STATUS:CANCELLED). Keeps the URL stable.
          const merged = mergeCancellationsInto(cancelIcs, lastIcs ?? '');
          if (merged && merged !== lastIcs) {
            await dataSource.write(fullPath, merged);
            lastIcs = merged;
          }
        }
      } catch { /* non-fatal */ }
    }

    const ics = buildIcsFor({
      circleId, circleName: circle?.name ?? circleId, member, tasks, now: now(),
    });
    prevTasks = tasks;
    if (ics === lastIcs) return;     // diff-before-write
    lastIcs = ics;
    try { await dataSource.write(fullPath, ics); }
    catch { /* persistence failure is non-fatal */ }
  }

  function schedule() {
    if (timer) return;
    timer = setTimeout(() => { rebuild().catch(() => {}); }, debounceMs);
  }

  const handler = () => schedule();
  for (const ev of RELEVANT_EVENTS) itemStore.on(ev, handler);

  // First rebuild on attach so the file exists immediately.
  rebuild().catch(() => {});

  return {
    detach() {
      if (timer) { clearTimeout(timer); timer = null; }
      for (const ev of RELEVANT_EVENTS) itemStore.off?.(ev, handler);
    },
    /** Skip the debounce — write immediately. Useful for tests. */
    async flushNow() {
      if (timer) { clearTimeout(timer); timer = null; }
      await rebuild();
    },
  };
}

/**
 * Convention path the calendar is written to. Apps wanting to expose
 * a `https://`-shaped URL translate this in the UI layer.
 */
export function defaultEmissionPath(circleId) {
  return `mem://user/tasks/calendars/${encodeURIComponent(circleId)}.ics`;
}

// Append cancellations to the existing ICS string. Calendar clients
// honour both the original VEVENT and the CANCELLATION marker on the
// same UID; the cancellation wins (drops the event from the user's
// view).
function mergeCancellationsInto(cancellationIcs, existingIcs) {
  if (!cancellationIcs) return existingIcs;
  if (!existingIcs)     return cancellationIcs;
  // Naive merge: both are full VCALENDARs. Concatenate the second's
  // VEVENTS into the first by inserting before END:VCALENDAR.
  const idx = existingIcs.lastIndexOf('END:VCALENDAR');
  if (idx < 0) return cancellationIcs;
  // Pull the VEVENT bodies from the cancellation calendar.
  const m = cancellationIcs.match(/BEGIN:VEVENT[\s\S]*?END:VEVENT/g);
  if (!m) return existingIcs;
  return existingIcs.slice(0, idx) + m.join('\n') + '\n' + existingIcs.slice(idx);
}
