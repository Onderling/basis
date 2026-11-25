/**
 * notReadableStores — the stores on this device that hold data this build could not read, so a shell can SAY so.
 *
 * A store that could not read what it holds keeps it as it is and refuses every save over it (`mapSnapshotGate`,
 * the settings saves). Kept quietly, that is a loss the person only finds later: what they change meanwhile is not
 * saved. So each such store reports here — its name (for the log, never shown), its KIND (the plain word a person
 * reads: messages, settings, lists…) and the reason — and every shell reads this one register through the shared
 * notice (`apps/basis/src/v2/storeNotice.js`): a bar on the web, a banner on the phone, a log line on the box.
 *
 * Module-level on purpose, like `pendingSaves`: the stores are built in many places, deep in a composition, and
 * none of them knows the screen.
 */

/** The kinds a store can be, as the person names them. `data` is the fallback for a store nobody classed. */
export const STORE_KINDS = Object.freeze(['messages', 'lists', 'tasks', 'posts', 'settings', 'data']);

const entries = new Map();   // name → { name, kind, reason }
const listeners = new Set();

function changed() {
  for (const fn of [...listeners]) { try { fn(notReadableStores()); } catch { /* a listener never breaks a store */ } }
}

/** A store could not read what it holds. Idempotent per name. */
export function reportNotReadable({ name, kind = 'data', reason }) {
  const k = STORE_KINDS.includes(kind) ? kind : 'data';
  const had = entries.get(name);
  if (had && had.kind === k && had.reason === reason) return;
  entries.set(name, { name, kind: k, reason });
  changed();
}

/** The store reads again (a later load found readable data): no longer reported. */
export function clearNotReadable(name) {
  if (entries.delete(name)) changed();
}

/** Every store reported now. */
export function notReadableStores() { return [...entries.values()]; }

/** Be told when the list changes. @returns the unsubscribe */
export function onNotReadableChange(fn) {
  listeners.add(fn);
  return () => { listeners.delete(fn); };
}

/** Tests only: forget every report. */
export function resetNotReadableStores() { entries.clear(); }
