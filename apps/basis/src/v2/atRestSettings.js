/**
 * The one setting that governs whether this device seals what it stores.
 *
 * Frits, 2026-09-10: *everything is encrypted at rest by default; a user can choose not to, and that must
 * never be the default.* So the setting exists, and it is a single boolean whose absence means SEALED —
 * the private behaviour is what you get without choosing, the same rule the address-fallback toggle
 * follows.
 *
 * ── Why it is per DEVICE and not per circle ─────────────────────────────────────────────────────────
 * The obvious home looked like the per-circle storage posture, which already says how a circle's POD-side
 * content is sealed. It does not fit: the stores this governs are mostly not circle-scoped. The agent
 * registry holds who this device belongs to, the household list and the search index span circles, and a
 * per-circle switch has nothing to say about any of them. At rest is a property of the DISK, and the disk
 * belongs to the device.
 *
 * ── What turning it off does, and does not do ───────────────────────────────────────────────────────
 * Off, new writes are stored as they are. What was already sealed STAYS sealed and still opens, because
 * the key is still there — so the choice is reversible in both directions and neither direction strands
 * anything. It does not touch the pod side (a circle's posture still governs that), and it does not touch
 * key material, which is sealed under the vault-at-rest key and is not negotiable.
 *
 * The IO helpers mirror `deliverySettings.js` exactly, so both shells wire this the way they already wire
 * that one, and there is one store of this fact rather than two views that come to disagree.
 */

/** The setting, with its default. Only an explicit `false` turns sealing off. */
export function atRestSettings(stored = {}) {
  return Object.freeze({
    // Default ON. An absent value, a corrupt value and an unreadable store all mean SEALED.
    sealAtRest: stored?.sealAtRest !== false,
  });
}

/** localStorage IO (web). */
export function localStorageAtRestIo(storage = globalThis.localStorage, key = 'cc.at-rest') {
  return {
    load: () => { try { return JSON.parse(storage?.getItem(key) ?? '{}'); } catch { return {}; } },
    save: (v) => { try { storage?.setItem(key, JSON.stringify(v ?? {})); } catch { /* ignore */ } },
  };
}

/** AsyncStorage IO (mobile). */
export function asyncStorageAtRestIo(AsyncStorage, key = 'cc.at-rest') {
  return {
    load: async () => { try { return JSON.parse((await AsyncStorage?.getItem(key)) ?? '{}'); } catch { return {}; } },
    save: async (v) => { try { await AsyncStorage?.setItem(key, JSON.stringify(v ?? {})); } catch { /* ignore */ } },
  };
}

/**
 * Read the setting from a shell's IO, fail-safe.
 *
 * Every failure path returns SEALED. A store that will not load must not be the reason a person's disk
 * goes readable — the failure that silently removes protection is the one worth designing against.
 *
 * @param {{load:Function}|null} io
 * @returns {Promise<boolean>} whether this device seals what it stores
 */
export async function sealsAtRest(io) {
  if (!io || typeof io.load !== 'function') return true;
  try { return atRestSettings(await io.load()).sealAtRest; }
  catch { return true; }
}
