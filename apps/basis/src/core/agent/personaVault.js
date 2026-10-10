/**
 * A persona's SLOTS in the device's chat vault — its chat seed, its person key, its delegation blob — seen through one
 * view per persona.
 *
 * The default persona keeps the names every shell already reads (mobile's first-run check looks for the bare chat
 * seed; the forget sweep and the restore path name the bare blob), so nothing migrates. Another persona's slots are
 * `<key>:<id>`: those never existed, so they need no adoption either. Every other entry in the vault is the DEVICE's
 * (its peer bindings, its primary-device choice, …) and passes through unchanged for every persona.
 *
 * THE DEFAULT'S SLOTS ARE THE BARE NAMES ON PURPOSE (first-run detection and the forget-list name them); every other
 * persona is namespaced. That asymmetry is the design, not drift.
 *
 * The same remapping shape as the household bot's identity vault (`BotIdentity._namespaceVault`).
 */
import { PERSON_KEY_VAULT_KEY } from '@onderling/core';

/** Where a device keeps its delegation blob (the seed it derives per-circle keys from, its record, its label). */
export const DEVICE_DELEGATION_VAULT_KEY = 'device-delegation-seed';

/** The chat vault entries that belong to ONE persona. */
export const PERSONA_SLOT_KEYS = Object.freeze(new Set(['agent-privkey', PERSON_KEY_VAULT_KEY, DEVICE_DELEGATION_VAULT_KEY]));

/**
 * The vault as one persona sees it.
 * @param {{get: Function, set: Function, delete?: Function, has?: Function, list?: Function}} vault
 * @param {string} profileId
 * @returns {{get: Function, set: Function, delete: Function, has: Function, list: Function}}
 */
export function personaVault(vault, profileId) {
  if (profileId === 'default') return vault;
  const suffix = `:${profileId}`;
  const slot = (key) => (PERSONA_SLOT_KEYS.has(key) ? `${key}${suffix}` : key);
  return {
    async get(key) { return vault.get(slot(key)); },
    async set(key, value) { return vault.set(slot(key), value); },
    async delete(key) { return vault.delete?.(slot(key)); },
    async has(key) {
      if (typeof vault.has === 'function') return vault.has(slot(key));
      return (await vault.get(slot(key))) != null;
    },
    async list() {
      // this persona's slots (unsuffixed, as it sees them) and the device's entries; never another persona's slots
      const isSlotOfSomeone = (k) => PERSONA_SLOT_KEYS.has(k) || [...PERSONA_SLOT_KEYS].some((s) => k.startsWith(`${s}:`));
      const out = [];
      for (const k of (await vault.list?.()) ?? []) {
        if (k.endsWith(suffix) && PERSONA_SLOT_KEYS.has(k.slice(0, -suffix.length))) out.push(k.slice(0, -suffix.length));
        else if (!isSlotOfSomeone(k)) out.push(k);
      }
      return out;
    },
  };
}
