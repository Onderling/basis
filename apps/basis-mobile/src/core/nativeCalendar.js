/**
 * nativeCalendar — sync dated items into an app-owned calendar in the PHONE's
 * Calendar app via `expo-calendar` (salvaged from tasks-mobile at its retirement,
 * generalized off the tasks noun: rows are `{itemId, dueAt?/scheduledAt?, …}` —
 * calendar events, appointments, dated tasks alike).
 *
 * Owns:
 *   - diffEvents({prev, next, eventIdByItem}) — PURE: `{create[], update[], remove[]}`.
 *   - applyDiff({CalendarModule, calendarId, diff, eventIdByItem, storage}) — applies
 *     via Calendar.{create,update,delete}EventAsync, persists `itemId → eventId`.
 *   - getOrCreateAppCalendar({CalendarModule, name}) — the app-owned writable
 *     calendar (never writes into a user's own calendars), created if absent.
 *
 * Everything is injectable (CalendarModule/storage), so the whole module is
 * unit-testable headless. The LIVE half — the permission request
 * (Calendar.requestCalendarPermissionsAsync) + the watch loop over the calendar
 * source — is DEVICE-BOUND and lands with the parked device session (same bucket
 * as the attach menu); until then nothing constructs this on a phone.
 */

const STORAGE_KEY = 'cc.nativeCalendar.eventIdMap';

/**
 * Pure-fn diff. `prev` and `next` are arrays of `{itemId, dueAt?,
 * scheduledAt?, ...}`. Items without a date drop out.
 *
 * Returns:
 *   - create: [{itemId, ev}]   — new event payload to create
 *   - update: [{itemId, eventId, ev}]
 *   - remove: [{itemId, eventId}]
 *
 * The caller hands `eventIdByItem` (the persisted map) so update
 * decisions know which existing eventId to point at.
 *
 * @param {Array<object>} prev   items previously emitted
 * @param {Array<object>} next   current items to emit
 * @param {Object<string, string>} eventIdByItem
 * @returns {{ create: Array, update: Array, remove: Array }}
 */
export function diffEvents({ prev = [], next = [], eventIdByItem = {} } = {}) {
  const prevMap = new Map();
  for (const t of prev) {
    if (t?.itemId) prevMap.set(t.itemId, t);
  }
  const nextMap = new Map();
  for (const t of next) {
    if (!t?.itemId) continue;
    if (!_eventStart(t)) continue; // skip dateless tasks
    nextMap.set(t.itemId, t);
  }

  const create = [];
  const update = [];
  const remove = [];

  for (const [itemId, t] of nextMap) {
    const ev = _toEvent(t);
    if (eventIdByItem[itemId]) {
      // Update existing — only when the relevant fields changed.
      const before = prevMap.get(itemId);
      if (!before || _changed(before, t)) {
        update.push({ itemId, eventId: eventIdByItem[itemId], ev });
      }
    } else {
      create.push({ itemId, ev });
    }
  }
  for (const [itemId] of prevMap) {
    if (!nextMap.has(itemId) && eventIdByItem[itemId]) {
      remove.push({ itemId, eventId: eventIdByItem[itemId] });
    }
  }
  return { create, update, remove };
}

/**
 * Apply a diff: create/update/delete events + persist the new map.
 *
 * @param {object} args
 * @param {object} args.CalendarModule    expo-calendar — inject for tests
 * @param {string} args.calendarId        target calendar
 * @param {{create: Array, update: Array, remove: Array}} args.diff
 * @param {Object<string, string>} args.eventIdByItem
 * @param {object} args.storage           AsyncStorage-shaped {get,set,remove}
 * @returns {Promise<Object<string, string>>}   updated eventIdByItem map
 */
export async function applyDiff({
  CalendarModule, calendarId, diff, eventIdByItem = {}, storage,
} = {}) {
  if (!CalendarModule) throw new Error('applyDiff: CalendarModule required');
  if (!calendarId)     throw new Error('applyDiff: calendarId required');

  const next = { ...eventIdByItem };

  for (const { itemId, ev } of diff.create ?? []) {
    try {
      const id = await CalendarModule.createEventAsync(calendarId, ev);
      next[itemId] = String(id);
    } catch { /* swallow per-event */ }
  }
  for (const { itemId, eventId, ev } of diff.update ?? []) {
    try {
      await CalendarModule.updateEventAsync(eventId, ev);
    } catch { /* swallow */ }
  }
  for (const { itemId, eventId } of diff.remove ?? []) {
    try {
      await CalendarModule.deleteEventAsync(eventId);
    } catch { /* swallow */ }
    delete next[itemId];
  }

  if (storage?.setItem) {
    try { await storage.setItem(STORAGE_KEY, JSON.stringify(next)); }
    catch { /* swallow — next pass will recompute */ }
  }
  return next;
}

/**
 * Read the persisted map from AsyncStorage.
 */
export async function loadEventIdMap({ storage } = {}) {
  if (!storage?.getItem) return {};
  try {
    const raw = await storage.getItem(STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    return (parsed && typeof parsed === 'object') ? parsed : {};
  } catch {
    return {};
  }
}

/**
 * Find the app-owned writable calendar; create one if absent.
 *
 * @param {object} args
 * @param {object} args.CalendarModule
 * @param {string} [args.name='Tasks']
 * @returns {Promise<string>}   calendarId
 */
export async function getOrCreateAppCalendar({ CalendarModule, name = 'Onderling' } = {}) {
  if (!CalendarModule) throw new Error('getOrCreateAppCalendar: CalendarModule required');
  const cals = await CalendarModule.getCalendarsAsync(CalendarModule.EntityTypes?.EVENT ?? 'event');
  const existing = (cals ?? []).find(
    (c) => c?.title === name && c?.allowsModifications,
  );
  if (existing) return existing.id;

  const sources = await CalendarModule.getSourcesAsync?.() ?? [];
  const localSource = sources.find((s) => s.type === 'local')
                   ?? sources.find((s) => s.isLocalAccount)
                   ?? sources[0];

  const id = await CalendarModule.createCalendarAsync({
    title:        name,
    color:        '#0d9488',
    entityType:   CalendarModule.EntityTypes?.EVENT ?? 'event',
    sourceId:     localSource?.id,
    source:       localSource,
    name,
    ownerAccount: localSource?.name ?? name,
    accessLevel:  CalendarModule.CalendarAccessLevel?.OWNER ?? 'owner',
  });
  return String(id);
}

// ── Internals ──────────────────────────────────────────────────────

function _eventStart(t) {
  return Number.isFinite(t?.scheduledAt) ? t.scheduledAt
       : Number.isFinite(t?.dueAt)        ? t.dueAt
       : null;
}

function _toEvent(t) {
  const start = _eventStart(t);
  const end   = start + (Number.isFinite(t?.estimateMinutes)
    ? t.estimateMinutes * 60 * 1000
    : 30 * 60 * 1000);
  return {
    title:     t.title ?? t.text ?? '(afspraak)',
    notes:     t.notes ?? undefined,
    startDate: new Date(start),
    endDate:   new Date(end),
    timeZone:  t.timeZone ?? undefined,
    alarms:    Array.isArray(t.alarms) ? t.alarms : undefined,
  };
}

function _changed(a, b) {
  return _eventStart(a) !== _eventStart(b)
      || (a?.text ?? a?.title) !== (b?.text ?? b?.title)
      || (a?.estimateMinutes ?? null) !== (b?.estimateMinutes ?? null);
}

export const _internal = { _eventStart, _toEvent, _changed, STORAGE_KEY };
