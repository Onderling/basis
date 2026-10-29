/**
 * A PROFILE'S FACTS — what a person curates on a profile: its properties (a name, a place, a picture, drivers…), the
 * inheritance markers (`_inherit.*`, a persona taking a value from the general one) and its disclosure policy, kept the
 * same on a person's devices without a pod.
 *
 * They merge PER KEY: every property key and every (context, key) disclosure entry carries its own write time
 * (`keyTimes`), a landing takes the newer side of each, and a key that was removed keeps its time as a tombstone so a
 * stale copy cannot bring it back. `factsAt` is the newest of them. Until 2026-10-26 the rule was "the newer facts win,
 * whole": a rename on one device and a place + disclosure set on another at the same moment then lost one of the two
 * (the two-devices walk). The times are wall clocks, which is acceptable only because every writer is the person's own
 * device: this merge runs between a self's own devices and nowhere else.
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
/** When EACH fact last changed (`{ 'p:<key>' | 'd:<context>\u001f<key>': ms }`) — the registry's own key too. */
export const FACTS_KEYS_KEY = '_factsKeys';

const MACHINE_KEYS = Object.freeze([DEVICE_DELEGATIONS_KEY, CIRCLE_MEMBERSHIPS_KEY, OWNED_NODES_KEY]);
const notFact = (k) => MACHINE_KEYS.includes(k) || k === FACTS_AT_KEY || k === FACTS_KEYS_KEY;

const SEP = '\u001f';
const propSlot = (k) => `p:${k}`;
const discSlot = (ctx, k) => `d:${ctx}${SEP}${k}`;
const same = (a, b) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);

/** Every fact slot an entry's facts hold, with its value (`undefined` for none). */
function slotsOf(facts) {
  const out = new Map();
  for (const [k, v] of Object.entries(facts?.properties ?? {})) out.set(propSlot(k), v);
  for (const [ctx, keys] of Object.entries(facts?.disclosure?.perContext ?? {})) {
    for (const [k, v] of Object.entries(keys ?? {})) out.set(discSlot(ctx, k), v);
  }
  return out;
}

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
  const times = props[FACTS_KEYS_KEY]?.value;
  return {
    properties, disclosure: entry?.disclosure ?? { perContext: {} }, factsAt: Number.isFinite(at) ? at : null,
    keyTimes: times && typeof times === 'object' ? { ...times } : {},
  };
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
  if (facts?.keyTimes && typeof facts.keyTimes === 'object' && Object.keys(facts.keyTimes).length) properties[FACTS_KEYS_KEY] = own({ ...facts.keyTimes });
  return { ...entry, properties, disclosure: facts?.disclosure ?? { perContext: {} } };
}

/**
 * The per-key times after a change made HERE at `at`: every fact slot whose value differs between `before` and `after`
 * (added, edited or removed) takes `at`; the others keep the time they had. A removed slot keeps its time (a tombstone).
 * @param {object} before  the entry before the change (`{}` for none)
 * @param {object} after   the entry after it
 * @param {number} at
 * @returns {Object<string, number>}
 */
export function stampChangedFacts(before, after, at) {
  const fb = profileFactsOf(before ?? {}); const fa = profileFactsOf(after ?? {});
  const times = { ...fb.keyTimes };
  const b = slotsOf(fb); const a = slotsOf(fa);
  for (const slot of new Set([...b.keys(), ...a.keys()])) if (!same(b.get(slot), a.get(slot))) times[slot] = at;
  return times;
}

/**
 * Merge two copies of one profile's facts, per key: each slot from the side whose time for it is newer (a slot without
 * a time counts at its copy's whole `factsAt`, which is how a copy from before the per-key times reads); on a tie the
 * first argument's value stands. A slot the winner does not hold is absent from the result (its time stays).
 * @param {{properties, disclosure, factsAt, keyTimes}} here
 * @param {{properties, disclosure, factsAt, keyTimes}} there
 * @returns {{properties: object, disclosure: object, factsAt: number|null, keyTimes: Object<string, number>}}
 */
export function mergeProfileFacts(here, there) {
  const sh = slotsOf(here); const st = slotsOf(there);
  const timeOf = (f, slot) => {
    const t = f?.keyTimes?.[slot];
    if (Number.isFinite(t)) return t;
    return slotsOf(f).has(slot) && Number.isFinite(f?.factsAt) ? f.factsAt : -Infinity;
  };
  const properties = {}; const perContext = {}; const keyTimes = {};
  const slots = new Set([...sh.keys(), ...st.keys(), ...Object.keys(here?.keyTimes ?? {}), ...Object.keys(there?.keyTimes ?? {})]);
  for (const slot of slots) {
    const th = timeOf(here, slot); const tt = timeOf(there, slot);
    const fromThere = tt > th;
    const value = fromThere ? st.get(slot) : sh.get(slot);
    // only a time that was actually stamped is kept: a copy's whole stamp stands in for a missing one in the
    // comparison above, never as a new per-key time (two old copies merged would otherwise look changed)
    const stamped = [here?.keyTimes?.[slot], there?.keyTimes?.[slot]].filter(Number.isFinite);
    if (stamped.length) keyTimes[slot] = Math.max(...stamped);
    if (value === undefined) continue;
    if (slot.startsWith('p:')) properties[slot.slice(2)] = value;
    else {
      const [ctx, k] = slot.slice(2).split(SEP);
      (perContext[ctx] ??= {})[k] = value;
    }
  }
  const ats = [here?.factsAt, there?.factsAt].filter(Number.isFinite);
  return {
    properties,
    disclosure: { ...(here?.disclosure ?? {}), perContext },
    factsAt: ats.length ? Math.max(...ats) : null,
    keyTimes,
  };
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

