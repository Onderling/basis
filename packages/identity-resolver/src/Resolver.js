/**
 * Resolver — pure resolution function over `MemberMap` + `Reveals`.
 *
 * Returns the right "how should I render this peer in the UI" answer
 * for a given (viewer, target, optional group) tuple.  Implements the
 * resolution order from `Project Files/Pinboard/advice-2026-05-05.md` §
 * "Handle / nickname design":
 *
 *   1. If viewer has a peer-reveal record for target with
 *      showDisplayName=true → return displayName.
 *   2. Else if viewer has a group-reveal for the supplied groupId
 *      with showDisplayName=true → return displayName.
 *   3. Else fall back to handle (with '@' prefix as a UI hint).
 *   4. Never return raw WebID as the rendered name (caller can still
 *      read `webid` from the result).
 *
 * No state.  No network I/O.  Composable with any MemberMap +
 * Reveals instance.
 */

/**
 * @param {object} args
 * @param {import('./MemberMap.js').MemberMap} args.memberMap
 *   Source of truth for member fields (handle, displayName, avatarUrl).
 * @param {import('./Reveals.js').Reveals} [args.reveals]
 *   Optional reveal store.  Without it, only handle is ever rendered.
 * @param {string} args.targetWebid
 *   Peer being rendered.
 * @param {string} [args.groupId]
 *   Group context for the group-default reveal lookup.
 * @returns {Promise<{
 *   webid: string,
 *   handle: string | null,
 *   displayName: string | null,
 *   avatarUrl:   string | null,
 *   isRevealed:  boolean,
 *   render:      string,
 *   revealSource: 'peer' | 'group' | 'default',
 * } | null>}
 *   `null` if the target is not in `memberMap`.  Otherwise:
 *   - `render` is the recommended UI label (`displayName` if revealed,
 *     `@<handle>` if not, `<webid-prefix>` as last-resort fallback).
 *   - `isRevealed` reflects whether displayName should be visible.
 */
export async function resolve({ memberMap, reveals, targetWebid, groupId } = {}) {
  if (!memberMap || typeof memberMap.resolveByWebid !== 'function') {
    throw new TypeError('resolve: memberMap (MemberMap) required');
  }
  if (typeof targetWebid !== 'string' || !targetWebid) {
    throw new TypeError('resolve: targetWebid required');
  }

  const member = await memberMap.resolveByWebid(targetWebid);
  if (!member) return null;

  const decision = reveals && typeof reveals.decide === 'function'
    ? reveals.decide({ peerWebid: targetWebid, groupId })
    : { showDisplayName: false, source: 'default' };

  const isRevealed = decision.showDisplayName && !!member.displayName;
  const render = isRevealed
    ? member.displayName
    : member.handle
      ? `@${member.handle}`
      : webidFallbackLabel(targetWebid);

  return {
    webid:        targetWebid,
    handle:       member.handle ?? null,
    displayName:  member.displayName ?? null,
    avatarUrl:    member.avatarUrl ?? null,
    isRevealed,
    render,
    revealSource: decision.source,
  };
}

/**
 * Last-resort label when neither displayName nor handle is set.
 * Renders the trailing path segment of the WebID (or the whole
 * thing if there's no path).  Apps should prompt the user to set a
 * handle rather than rely on this.
 */
function webidFallbackLabel(webid) {
  try {
    const u = new URL(webid);
    const tail = (u.hash || u.pathname || '').replace(/^[#/]+/, '').split('/').pop();
    return tail || u.host || webid;
  } catch {
    return webid;
  }
}
