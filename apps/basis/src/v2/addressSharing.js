/**
 * addressSharing — "never share my global (NKN) address with anyone."
 *
 * ── Why this is its OWN setting, not the fallback ────────────────────────────────────────────────────
 * The address-fallback setting governs **routing**: may a send fall back to my global key when no
 * per-circle address is known? This governs **publication**: may my global address leave this device at
 * all — into an invite, a contact card, a pod triple, a roster row?
 *
 * They are different questions with different blast radii. Fallback OFF still lets my address sit in
 * places others can read; and the concern here (Frits, 2026-07-29) is precisely that:
 *
 *   > A global address is the thing that collapses personas into one person. Anyone who sees it in two
 *   > contexts learns those two contexts are the same human — no matter how careful the routing was.
 *
 * So a user must be able to refuse to publish it at all, and that refusal has to hold at every point of
 * escape, not just the one they were looking at.
 *
 * ── What it costs, stated plainly ────────────────────────────────────────────────────────────────────
 * With sharing off, nobody can reach this device over NKN: no contact DM over the mesh, no NKN-carried
 * join handshake, no NKN circle. That is the point rather than a side effect — but it is a real loss,
 * so a surface offering this must say it, the same way the fallback offer states its cost.
 *
 * Default is ON (share), because the alternative is an app that silently cannot be contacted. Turning it
 * off is a deliberate act, and it is the strictest privacy position the product offers.
 */

/** The default: sharing allowed. Off is a deliberate, informed choice. */
export const DEFAULT_SHARE_NKN_ADDRESS = true;

/**
 * Normalise the stored value. Anything unrecognised reads as the DEFAULT rather than as "off": a
 * corrupt setting that silently made someone unreachable would look exactly like a broken app, and the
 * user never chose it.
 *
 * @param {*} stored
 * @returns {boolean}
 */
export function normalizeShareNknAddress(stored) {
  if (stored === false || stored === 'false') return false;
  return DEFAULT_SHARE_NKN_ADDRESS;
}

/**
 * The one gate every publication site calls: the address to publish, or `null` when the user has
 * refused. Returning null (rather than the caller checking a boolean) is deliberate — a site that
 * forgets to check reads as "no address available", which is the safe direction.
 *
 * @param {string|null|undefined} address   this device's global address
 * @param {boolean|(() => boolean)} [allowed]  the live setting (value or thunk; read per call so a flip
 *   takes effect immediately rather than at the next boot)
 * @returns {string|null}
 */
export function shareableAddress(address, allowed = DEFAULT_SHARE_NKN_ADDRESS) {
  const ok = typeof allowed === 'function' ? allowed() !== false : allowed !== false;
  if (!ok) return null;
  return typeof address === 'string' && address ? address : null;
}

/** localStorage-backed store (web). Absent key ⇒ the default. */
export function localStorageAddressSharingIo(storage = globalThis.localStorage) {
  const KEY = 'cc.shareNknAddress';
  return {
    load: () => { try { return normalizeShareNknAddress(storage?.getItem(KEY)); } catch { return DEFAULT_SHARE_NKN_ADDRESS; } },
    save: (allowed) => {
      try {
        // Only the non-default is persisted — no key means "I never changed this".
        if (allowed === false) storage?.setItem(KEY, 'false');
        else storage?.removeItem(KEY);
      } catch { /* ignore */ }
    },
  };
}

/** AsyncStorage-backed store (mobile). Same key, same defaulting. */
export function asyncStorageAddressSharingIo(AsyncStorage) {
  const KEY = 'cc.shareNknAddress';
  return {
    load: async () => {
      try { return normalizeShareNknAddress(await AsyncStorage?.getItem(KEY)); }
      catch { return DEFAULT_SHARE_NKN_ADDRESS; }
    },
    save: async (allowed) => {
      try {
        if (allowed === false) await AsyncStorage?.setItem(KEY, 'false');
        else await AsyncStorage?.removeItem(KEY);
      } catch { /* ignore */ }
    },
  };
}
