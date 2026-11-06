/**
 * The "Blocked" list — one projection, both shells.
 *
 * A block is made in one tap on a post, and the only identifier that tap has is a key. That is
 * fine for the machinery and useless on a screen: a list of base64 is a list you cannot audit, and
 * "who have I blocked" is exactly the question this surface exists to answer. So the projection
 * resolves each key back to the person through whatever roster the caller can see, else through the name the
 * person saw WHEN they blocked (kept with the block: `basis:muted`'s `entries`), else "someone" — never the key,
 * shortened or whole (Frits 2026-11-06: a word where a key would be). Each row also says when it was blocked.
 *
 * The rows carry the ORIGINAL key as `key`: unblocking must pass back exactly what was blocked, or
 * it silently removes nothing.
 */

/** @typedef {{key: string, label: string|null, at: number|null, resolved: boolean}} BlockedRow */

/**
 * @param {object} a
 * @param {string[]} [a.peers]    the block set, as `basis:muted` returns it
 * @param {Array<{key: string, label?: string|null, at?: number|null}>} [a.entries]  the same set with the name and day
 *   each block was made under (`basis:muted`'s `entries`)
 * @param {object[]} [a.members]  roster rows ({pubKey, webid, stableId, handle, displayName})
 * @returns {BlockedRow[]}  by name; the unnamed last
 */
export function buildBlockedList({ peers = [], entries = [], members = [] } = {}) {
  const kept = new Map((Array.isArray(entries) ? entries : []).filter((e) => e && typeof e.key === 'string').map((e) => [e.key, e]));
  const keys = [...new Set([...(Array.isArray(peers) ? peers : []), ...kept.keys()])];
  const rows = [];
  for (const raw of keys) {
    if (typeof raw !== 'string' || !raw) continue;
    const key = raw;
    // `webid:`-prefixed entries are how an older block recorded a webid; strip it for matching only.
    const bare = key.startsWith('webid:') ? key.slice(6) : key;
    const m = (Array.isArray(members) ? members : []).find(
      (mm) => mm?.pubKey === bare || mm?.webid === bare || mm?.stableId === bare,
    );
    const said = kept.get(key);
    const name = m?.displayName || m?.handle || (typeof said?.label === 'string' && said.label ? said.label : null);
    rows.push({ key, label: name, at: typeof said?.at === 'number' ? said.at : null, resolved: !!name });
  }
  rows.sort((a, b) => (a.label == null) - (b.label == null) || String(a.label ?? '').localeCompare(String(b.label ?? '')));
  return rows;
}
