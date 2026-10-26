/**
 * The REGISTRY'S OWN KEYS on a profile's properties — written by the registry's helpers (device records, circle
 * memberships, owned nodes, the inheritance markers), never by a person through the property ops. A person curates
 * their coarse properties (place, availability, a picture); these are machine state, and one write through the
 * person-facing op could drop a device's records or mark them revoked. The ops refuse them (`reserved-key`).
 *
 * One list, here: the next machine key joins it, and a fitness test holds every `*_KEY` constant in this package to be
 * either reserved or listed as person-settable below.
 */
import { DEVICE_DELEGATIONS_KEY } from './deviceDelegations.js';
import { CIRCLE_MEMBERSHIPS_KEY } from './circleMembership.js';
import { OWNED_NODES_KEY } from './ownedNodes.js';
import { PROFILE_PICTURE_KEY } from './mediaProperty.js';
import { FACTS_AT_KEY, FACTS_KEYS_KEY } from './profileFacts.js';
import { MODEL_CONSENT_KEY } from './modelConsent.js';

/** The registry's machine keys on a profile — refused by the person-facing property ops. */
export const RESERVED_PROPERTY_KEYS = Object.freeze([DEVICE_DELEGATIONS_KEY, CIRCLE_MEMBERSHIPS_KEY, OWNED_NODES_KEY, FACTS_AT_KEY, FACTS_KEYS_KEY]);
/** The registry's marker namespace (`_inherit.offering`, …): every key under it is the registry's. */
export const RESERVED_PROPERTY_PREFIXES = Object.freeze(['_inherit.']);
/** The keys a person may set through the property ops although this package defines them (their picture, their word on a model). */
export const PERSON_SETTABLE_KEYS = Object.freeze([PROFILE_PICTURE_KEY, MODEL_CONSENT_KEY]);

/** Is this key the registry's own (refused by the person-facing property ops)? */
export function isReservedPropertyKey(key) {
  if (typeof key !== 'string') return false;
  return RESERVED_PROPERTY_KEYS.includes(key) || RESERVED_PROPERTY_PREFIXES.some((p) => key.startsWith(p));
}
