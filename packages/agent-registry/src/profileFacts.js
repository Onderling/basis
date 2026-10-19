/**
 * A PROFILE'S FACTS — what a person curates on a profile: its properties (a name, a place, a picture, drivers…), the
 * inheritance markers (`_inherit.*`, a persona taking a value from the general one) and its disclosure policy. One
 * unit, stamped with WHEN it last changed (`factsAt`), so a person's devices can keep it the same without a pod:
 * the newer facts win, whole.
 *
 * NOT facts: the registry's MACHINE keys — device records, circle memberships, owned nodes. Each is this device's
 * state with its own lane (the enrol and revoke ceremonies, the circle follow, the companion claim); landed facts never
 * touch them, and they never ride with the facts.
 */
import { DEVICE_DELEGATIONS_KEY } from './deviceDelegations.js';
import { CIRCLE_MEMBERSHIPS_KEY } from './circleMembership.js';
import { OWNED_NODES_KEY } from './ownedNodes.js';
import { own } from './profileProperties.js';

/** When a profile's facts last changed (ms, as an own property) — the registry's own key, refused by the person-facing ops. */
export const FACTS_AT_KEY = '_factsAt';

const MACHINE_KEYS = Object.freeze([DEVICE_DELEGATIONS_KEY, CIRCLE_MEMBERSHIPS_KEY, OWNED_NODES_KEY]);
const notFact = (k) => MACHINE_KEYS.includes(k) || k === FACTS_AT_KEY;

/**
 * The facts of a registry entry.
 * @param {object} entry
 * @returns {{ properties: object, disclosure: object, factsAt: number|null }}
 */
export function profileFactsOf(entry) {
  const props = entry?.properties && typeof entry.properties === 'object' ? entry.properties : {};
  const properties = {};
  for (const [k, v] of Object.entries(props)) if (!notFact(k)) properties[k] = v;
  // stored as an own property (`{mode:'own', value}`), like every key on a profile — the registry drops a bare value
  const at = props[FACTS_AT_KEY]?.value;
  return { properties, disclosure: entry?.disclosure ?? { perContext: {} }, factsAt: Number.isFinite(at) ? at : null };
}

/**
 * The entry with `facts` landed: its curated properties and disclosure replaced by the facts', its machine keys kept,
 * stamped with the facts' time. A machine key inside `facts` is ignored.
 * @param {object} entry
 * @param {{ properties?: object, disclosure?: object, factsAt: number }} facts
 */
export function withProfileFacts(entry, facts) {
  const cur = entry?.properties && typeof entry.properties === 'object' ? entry.properties : {};
  const properties = {};
  for (const k of MACHINE_KEYS) if (cur[k] !== undefined) properties[k] = cur[k];
  for (const [k, v] of Object.entries(facts?.properties ?? {})) if (!notFact(k)) properties[k] = v;
  if (Number.isFinite(facts?.factsAt)) properties[FACTS_AT_KEY] = own(facts.factsAt);
  return { ...entry, properties, disclosure: facts?.disclosure ?? { perContext: {} } };
}

/** Do two entries hold different facts (the stamp left out)? */
export function factsDiffer(a, b) {
  const fa = profileFactsOf(a); const fb = profileFactsOf(b);
  return JSON.stringify([fa.properties, fa.disclosure]) !== JSON.stringify([fb.properties, fb.disclosure]);
}

/** The stamp as the registry stores it — for the write seam that marks a change of the facts. */
export function factsStamp(at) { return own(at); }

/**
 * The next stamp for a change made HERE: now, but never at or before the previous stamp — so a device whose clock lags
 * a sibling's (whose newer stamp it landed) still gets its edit through instead of losing to that stamp until the
 * clocks cross. (A clock far AHEAD still wins until it is passed: newest-wins by a wall clock, monotonic per profile.)
 * @param {number|null} previousAt  the profile's stamp before this change
 * @param {number} now
 */
export function nextFactsAt(previousAt, now) {
  return Number.isFinite(previousAt) ? Math.max(now, previousAt + 1) : now;
}

