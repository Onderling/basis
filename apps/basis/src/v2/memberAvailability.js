/**
 * basis v2 — member availability (shared).
 *
 * A cross-circle (per-user, not per-circle) record: holiday mode (away
 * until a date) + quiet hours (defer pushes in a daily window, optionally
 * weekends-all-day). Pure model — the host persists it and (1.5b) wires
 * the actual push-suppression into the notifier. Extends the existing
 * holiday-mode skill conceptually; here it's the v2 settings record.
 */

export const DEFAULT_AVAILABILITY = {
  holiday:    { active: false, until: null },           // until: ISO date string | null
  quietHours: { enabled: false, from: '22:00', to: '07:30', weekends: false },
};

const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;

function pickTime(v, fallback) {
  return typeof v === 'string' && TIME_RE.test(v) ? v : fallback;
}

export function normalizeAvailability(stored = {}) {
  const a = stored && typeof stored === 'object' ? stored : {};
  const h = a.holiday && typeof a.holiday === 'object' ? a.holiday : {};
  const q = a.quietHours && typeof a.quietHours === 'object' ? a.quietHours : {};
  return {
    holiday: {
      active: !!h.active,
      until: typeof h.until === 'string' && h.until ? h.until : null,
    },
    quietHours: {
      enabled:  !!q.enabled,
      from:     pickTime(q.from, DEFAULT_AVAILABILITY.quietHours.from),
      to:       pickTime(q.to, DEFAULT_AVAILABILITY.quietHours.to),
      weekends: !!q.weekends,
    },
  };
}

export function mergeAvailability(base, patch = {}) {
  const b = normalizeAvailability(base);
  return normalizeAvailability({
    holiday:    { ...b.holiday, ...(patch.holiday || {}) },
    quietHours: { ...b.quietHours, ...(patch.quietHours || {}) },
  });
}

/**
 * Is a push currently suppressed for this availability? Pure helper for the
 * notifier hookup (1.5b). `now` injectable for testing.
 */
export function isPushSuppressed(availability, now = new Date()) {
  const a = normalizeAvailability(availability);
  if (a.holiday.active) {
    if (!a.holiday.until) return true;                              // away, no end date
    if (now <= new Date(`${a.holiday.until}T23:59:59`)) return true; // within holiday window
  }
  if (a.quietHours.enabled) {
    if (a.quietHours.weekends && (now.getDay() === 0 || now.getDay() === 6)) return true;
    if (inWindow(toMinutes(now), a.quietHours.from, a.quietHours.to)) return true;
  }
  return false;
}

function toMinutes(d) { return d.getHours() * 60 + d.getMinutes(); }
function hm(s) { const [h, m] = s.split(':').map(Number); return h * 60 + m; }
function inWindow(min, from, to) {
  const f = hm(from);
  const t = hm(to);
  // Overnight window (e.g. 22:00 → 07:30) wraps midnight.
  return f <= t ? (min >= f && min < t) : (min >= f || min < t);
}

/**
 * Cross-circle availability is per-user (one record), so the store is
 * keyless. Injectable load/save (web: localStorage; pod later).
 */
export function createAvailabilityStore({ load, save } = {}) {
  return {
    async get() {
      let raw = null;
      try { raw = load ? await load() : null; } catch { raw = null; }
      return normalizeAvailability(raw);
    },
    async update(patch) {
      const current = await this.get();
      const next = mergeAvailability(current, patch);
      if (save) await save(next);
      return next;
    },
  };
}

/** localStorage-backed load/save for availability. Key: `cc.availability`. */
export function localStorageAvailabilityIo(storage = globalThis.localStorage) {
  const KEY = 'cc.availability';
  return {
    load: async () => {
      try { const s = storage?.getItem(KEY); return s ? JSON.parse(s) : null; } catch { return null; }
    },
    save: async (a) => {
      try { storage?.setItem(KEY, JSON.stringify(a)); } catch { /* ignore */ }
    },
  };
}

/* ────────────────────────────────────────────────────────────────────
 * Making the availability pref SHAREABLE (Objective D — Surface 3a).
 *
 * Availability is a device-local *pref* (holiday + quiet hours), but its
 * value must be readable by OTHER agents (the planner, other members'
 * agents) — a device-local-only store hides it. We reuse the exact
 * shareable-substrate pattern the circle-policy store already uses
 * (`podPolicyIo`/`tieredPolicyIo`): mirror the local value to a pod
 * resource that peers read.
 *
 * DESIGN DECISION — where the shared copy lives: a PER-USER pod resource
 * (`onderling/cc-availability/availability.json`), NOT a per-circle item.
 * Rationale: the pref is cross-circle + per-user by definition (see the
 * module header), so a single per-user home is the one truth; publishing
 * it under each circle would duplicate it N times. This deliberately does
 * NOT route through tasks-v0's `setMyAvailability` — that op is a DIFFERENT
 * feature (a per-circle weekly AM/PM *grid* at
 * `mem://tasks/circles/<circleId>/availability/<webid>.json`), not the
 * holiday/quiet-hours pref. The two are distinct substrates by design.
 * ──────────────────────────────────────────────────────────────────── */

/** Per-user pod resource for the cross-circle availability pref. */
const AVAILABILITY_RESOURCE = 'availability.json';

/**
 * JSON IO over a `createPodWriter`-shaped writer, keyless (the pref is
 * per-user, one record). `getWriter` is a thunk so the host can wire the
 * store before a Solid session has restored (returns `null` while no
 * writer is configured → load/save are no-ops and the composite falls
 * through to the local side). Mirrors `podPolicyIo`, minus the circleId.
 *
 * @param {object} opts
 * @param {() => object|null} opts.getWriter — thunk returning a podWriter or null
 * @param {string} [opts.app='cc-availability']
 */
export function podAvailabilityIo({ getWriter, app = 'cc-availability' } = {}) {
  if (typeof getWriter !== 'function') {
    throw new TypeError('podAvailabilityIo: getWriter thunk required');
  }
  return {
    load: async () => {
      const w = getWriter();
      if (!w || typeof w.read !== 'function') return null;
      try {
        const res = await w.read(app, AVAILABILITY_RESOURCE);
        if (!res?.ok || typeof res.body !== 'string') return null;
        return JSON.parse(res.body);
      } catch {
        return null;
      }
    },
    save: async (value) => {
      const w = getWriter();
      if (!w || typeof w.write !== 'function') return;
      try {
        await w.write(app, AVAILABILITY_RESOURCE, JSON.stringify(value), 'application/json');
      } catch {
        /* a pod-write failure must not break the local-canonical write */
      }
    },
  };
}

/**
 * Compose a local (canonical) IO with a pod (mirror) IO for the keyless
 * availability pref. Unlike circle policy there is no `pod` axis to gate
 * on — the pref is inherently meant to be shared, so writes ALWAYS mirror
 * to the pod (a no-op when no writer is wired). Reads prefer the local
 * value; when local is empty they fall through to the pod and seed local,
 * so another device — or another member's agent — picks up the shared
 * value on first read.
 *
 * @param {{load, save}} localIo
 * @param {{load, save}} podIo
 * @returns {{load, save}}
 */
export function tieredAvailabilityIo(localIo, podIo) {
  return {
    load: async () => {
      const localValue = await localIo.load();
      if (localValue != null) return localValue;
      const podValue = await podIo.load();
      if (podValue != null) {
        try { await localIo.save(podValue); } catch { /* mirror-down best-effort */ }
        return podValue;
      }
      return null;
    },
    save: async (value) => {
      await localIo.save(value);
      await podIo.save(value);
    },
  };
}
