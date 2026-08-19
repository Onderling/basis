/**
 * Pure state-machine pieces lifted from src/web/threadSidebar.js
 * (2026-05-24).
 *
 * The web DOM renderer keeps living in src/web/threadSidebar.js and
 * imports these helpers; basis-mobile's eventual RN thread
 * sidebar will import them too.  Same functions, two surfaces.
 *
 * Conventions:
 *   - Zero DOM, zero RN, zero Node-only deps.  Pure value transforms.
 *   - The `state` object is plain mutable form-data — callers (web or
 *     RN) own the input bindings; these helpers operate on snapshots.
 */

/**
 * Event types known to the chat-shell.  Each app's notifier usually
 * fires a small fixed set; the form-chips offer them as click-to-
 * toggle without forcing the user to remember the names.  Adapters
 * extend this list via `mergeKnownEventTypes`.
 */
export const KNOWN_EVENT_TYPES = ['notification', 'item-changed', 'reminder', 'mention'];

/**
 * Merge the catalogue's contributed event types with the chat-shell's
 * built-in list, de-duped, declaration-order preserved (catalogue
 * entries first so apps can "promote" a type to the front of the UI
 * chip list by re-declaring it).
 *
 * @param {string[]} [extra]
 * @returns {string[]}
 */
export function mergeKnownEventTypes(extra) {
  const list = Array.isArray(extra) ? [...extra] : [];
  list.push(...KNOWN_EVENT_TYPES);
  return list.filter((v, i, arr) => arr.indexOf(v) === i);
}

/**
 * Parse a comma- or whitespace-separated string into a trimmed,
 * non-empty token list.  Used for the form's "actors" field where
 * peer/actor ids are too dynamic to render as a chip catalogue.
 *
 * @param {string} raw
 * @returns {string[]}
 */
export function parseList(raw) {
  if (typeof raw !== 'string') return [];
  return raw
    .split(/[,\s]+/)
    .map((s) => s.trim())
    .filter((s) => s !== '');
}

/**
 * Build a thread `filter` object from the form's mutable state.
 * Empty Sets / empty strings collapse to wildcard (= field omitted)
 * — this matches the convention that an absent filter slot accepts
 * everything.
 *
 * @param {{ apps: Set<string>, types: Set<string>, actors: string }} state
 * @returns {{ apps?: string[], eventTypes?: string[], actors?: string[] }}
 */
export function buildFilterFromFormState(state) {
  const apps   = [...(state.apps   ?? new Set())];
  const types  = [...(state.types  ?? new Set())];
  const actors = parseList(state.actors ?? '');
  return {
    ...(apps.length   > 0 ? { apps }              : {}),
    ...(types.length  > 0 ? { eventTypes: types } : {}),
    ...(actors.length > 0 ? { actors }            : {}),
  };
}

/**
 * Initial form state for create-new-thread.  Use as the default
 * when no `existingThread` is being edited.
 *
 * @returns {{ name: string, apps: Set, types: Set, actors: string, allowCommands: boolean }}
 */
export function emptyFormState() {
  return {
    name:          '',
    apps:          new Set(),
    types:         new Set(),
    actors:        '',
    allowCommands: true,
  };
}

/**
 * Build form state pre-populated from an existing thread (edit path).
 *
 * @param {object} existing
 * @returns {{ name: string, apps: Set, types: Set, actors: string, allowCommands: boolean }}
 */
export function formStateFromThread(existing) {
  return {
    name:          existing?.name ?? '',
    apps:          new Set(existing?.filter?.apps ?? []),
    types:         new Set(existing?.filter?.eventTypes ?? []),
    actors:        (existing?.filter?.actors ?? []).join(','),
    allowCommands: existing?.permissions?.allowCommands ?? true,
  };
}

/**
 * Submit-side: take a form state + the store, persist either a new
 * thread or update an existing one.  Returns `{ threadId, created }`
 * so the caller can drive the activate-thread step.
 *
 * Rejects with `{ ok: false, reason: 'name-required' }` when the
 * name is empty — adapters surface that to the user (a banner on
 * web, a Toast on RN); they don't need to duplicate the validation.
 *
 * @param {object} state                  form state (mutable; not mutated here)
 * @param {object} store                  ThreadStore (createThread / updateThread)
 * @param {object} [opts]
 * @param {object} [opts.existingThread]  when present, calls updateThread; otherwise createThread
 * @returns {{ ok: true, threadId: string, created: boolean } | { ok: false, reason: string }}
 */
export function submitThreadForm(state, store, opts = {}) {
  const name = String(state.name ?? '').trim();
  if (!name) return { ok: false, reason: 'name-required' };

  const filter      = buildFilterFromFormState(state);
  const permissions = { allowCommands: !!state.allowCommands };

  if (opts.existingThread) {
    store.updateThread(opts.existingThread.id, { name, filter, permissions });
    return { ok: true, threadId: opts.existingThread.id, created: false };
  }
  const t = store.createThread({ name, filter, permissions });
  return { ok: true, threadId: t.id, created: true };
}
