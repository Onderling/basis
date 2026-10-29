/**
 * The person's OWN profile, as pinboard's skills read and write it: the handle they go by, the name they show, whether
 * they are away, and the coarse place they gave. Inside basis the host injects it over the persona record (the agents
 * registry), keyed by the caller's self, so one record answers whoAmI, getMyProfile and the join alike. Standalone
 * (pinboard's own tests, a host that injects none) it is held in memory here.
 *
 * The seam: `get(webid)` → `{ handle, displayName, availability, location }` (each `null` when unset), or `null` when
 * the webid is not one of this device's selves; `set(webid, patch)` merges `patch` (a `null` clears a field) and
 * returns the merged profile, or `null` for a webid that is not one of ours.
 */

/** The fields the own profile holds. */
export const SELF_PROFILE_FIELDS = Object.freeze(['handle', 'displayName', 'availability', 'location']);

const blank = () => Object.fromEntries(SELF_PROFILE_FIELDS.map((k) => [k, null]));

/** A self profile held in memory, one per webid — the standalone default. */
export function createMemorySelfProfile() {
  const byWebid = new Map();
  return {
    async get(webid) {
      if (typeof webid !== 'string' || !webid || !byWebid.has(webid)) return null;   // nothing said yet
      return { ...byWebid.get(webid) };
    },
    async set(webid, patch = {}) {
      if (typeof webid !== 'string' || !webid) return null;
      const next = { ...blank(), ...(byWebid.get(webid) ?? {}) };
      for (const k of SELF_PROFILE_FIELDS) if (Object.prototype.hasOwnProperty.call(patch, k)) next[k] = patch[k] ?? null;
      byWebid.set(webid, next);
      return { ...next };
    },
  };
}
