/**
 * The "Blocked" list — one projection, both shells.
 *
 * A block is made in one tap on a post, and the only identifier that tap has is a key. That is
 * fine for the machinery and useless on a screen: a list of base64 is a list you cannot audit, and
 * "who have I blocked" is exactly the question this surface exists to answer. So the projection
 * resolves each key back to the person through whatever roster the caller can see, and falls back
 * to a shortened key when nobody can name them (someone blocked outside any shared circle — the
 * common case for a stranger, and still worth showing).
 *
 * The rows carry the ORIGINAL key as `key`: unblocking must pass back exactly what was blocked, or
 * it silently removes nothing.
 */

/** @typedef {{key: string, label: string, resolved: boolean}} BlockedRow */

const shorten = (k) => (k.length > 22 ? `${k.slice(0, 10)}…${k.slice(-6)}` : k);

/**
 * @param {object} a
 * @param {string[]} [a.peers]    the block set, as `basis:muted` returns it
 * @param {object[]} [a.members]  roster rows ({pubKey, webid, stableId, handle, displayName})
 * @returns {BlockedRow[]}  newest-first is meaningless here (the set is unordered), so: by label
 */
export function buildBlockedList({ peers = [], members = [] } = {}) {
  const rows = [];
  for (const raw of Array.isArray(peers) ? peers : []) {
    if (typeof raw !== 'string' || !raw) continue;
    const key = raw;
    // `webid:`-prefixed entries are how an older block recorded a webid; strip it for matching only.
    const bare = key.startsWith('webid:') ? key.slice(6) : key;
    const m = (Array.isArray(members) ? members : []).find(
      (mm) => mm?.pubKey === bare || mm?.webid === bare || mm?.stableId === bare,
    );
    const name = m?.displayName || m?.handle || null;
    rows.push({ key, label: name ?? shorten(bare), resolved: !!name });
  }
  rows.sort((a, b) => a.label.localeCompare(b.label));
  return rows;
}
