/**
 * THE PERSON'S OWN PROFILE over the persona record: the seam pinboard's own-profile ops read and write
 * (`apps/pinboard/src/lib/selfProfile.js` is its contract). One record per self — the general persona's, or a
 * persona's — so whoAmI, getMyProfile and the handle a join presents all read the same place.
 *
 * Where each field lives on the profile:
 *   - handle        → the `handle` ATTRIBUTE (`HANDLE_KEY`): presented by the self's own statements, never released
 *   - displayName   → the `name` property, under the persona's disclosure like any property
 *   - availability  → the `availability` property ('open' · 'away')
 *   - location      → the `location` property: a coarse label, never a coordinate
 *
 * Written as the self's OWN value. Read: the handle and the name are the self's own only — a persona that took the
 * general persona's name or handle would be linked to it by every circle that sees both — while availability and
 * place inherit like any property (a persona that said nothing takes the general persona's). A webid that is not one
 * of this device's selves has no profile here: `get` and `set` answer null.
 */
import { setOwn, resolveProperty, HANDLE_KEY } from '@onderling/agent-registry';

/** The fields a self keeps for itself alone: never inherited from the general persona. */
const OWN_ONLY = new Set(['handle', 'displayName']);

/** The profile key each own-profile field is kept under. */
export const SELF_PROFILE_KEYS = Object.freeze({
  handle:       HANDLE_KEY,
  displayName:  'name',
  availability: 'availability',
  location:     'location',
});

/**
 * @param {object} a
 * @param {() => ({lookup: Function, register: Function, list?: Function}|null)} a.registry  the agents registry
 * @param {(webid: string) => (string|null)} a.profileIdOf  which profile a webid of this device is (null: not ours)
 * @param {string} [a.defaultProfileId]  the general persona's profile id, the one a persona inherits from
 * @param {(profileId: string, fn: () => Promise<any>) => Promise<any>} [a.turn]  the host's one-writer-per-profile turn:
 *   a profile is written whole, so this write waits for any other writer of the same profile (and they for it)
 */
export function createRegistrySelfProfile({ registry, profileIdOf, defaultProfileId = 'default', turn = (_id, fn) => fn() } = {}) {
  const reg = () => (typeof registry === 'function' ? registry() : registry) ?? null;
  const read = async (profileId) => {
    const r = reg();
    if (!r) return null;
    const [self, dflt] = await Promise.all([r.lookup(profileId), profileId === defaultProfileId ? null : r.lookup(defaultProfileId)]);
    if (!self) return null;
    const byId = { [profileId]: self, ...(dflt ? { [defaultProfileId]: dflt } : {}) };
    const getProfile = (id) => byId[id] ?? null;
    const out = {};
    for (const [field, key] of Object.entries(SELF_PROFILE_KEYS)) {
      const v = OWN_ONLY.has(field)
        ? (self.properties?.[key]?.mode === 'own' ? self.properties[key].value : undefined)
        : resolveProperty(getProfile, profileId, key, { defaultProfileId });
      out[field] = v === undefined ? null : v;
    }
    return out;
  };
  return {
    async get(webid) {
      const profileId = typeof profileIdOf === 'function' ? profileIdOf(webid) : null;
      return profileId ? read(profileId) : null;
    },
    async set(webid, patch = {}) {
      const profileId = typeof profileIdOf === 'function' ? profileIdOf(webid) : null;
      const r = reg();
      if (!profileId || !r) return null;
      const written = await turn(profileId, async () => {
        const cur = await r.lookup(profileId);
        if (!cur) return false;
        let properties = cur.properties ?? {};
        for (const [field, key] of Object.entries(SELF_PROFILE_KEYS)) {
          if (Object.prototype.hasOwnProperty.call(patch, field)) properties = setOwn(properties, key, patch[field] ?? null);
        }
        await r.register({ ...cur, properties });
        return true;
      });
      return written ? read(profileId) : null;
    },
  };
}
