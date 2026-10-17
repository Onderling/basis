/**
 * createMemberProfileHook — factory that produces a `useMemberProfile`
 * hook over the active bundle's MemberMap.
 *
 * Lifted from apps/pinboard-mobile/src/lib/useMemberProfile.js 2026-05-09
 * (Phase 41.0.b A7; Tasks-mobile is the second consumer).
 *
 *   const useMemberProfile = createMemberProfileHook({ useService });
 *
 *   const { member, loading, error, refresh } =
 *     useMemberProfile({ pubKey });
 *
 * Resolves by pubKey → stableId → webid (the order MemberMap supports).
 * The bundle exposes `members` with `resolveByPubKey` / `resolveByStableId`
 * / `resolveByWebid` methods (the standard `@onderling/identity-resolver`
 * MemberMap surface).
 */

import { useCallback, useEffect, useState } from 'react';

/**
 * @param {object} args
 * @param {() => object} args.useService
 * @returns {(args: {pubKey?: string, stableId?: string, webid?: string}) =>
 *   { member: object | null, loading: boolean, error: Error | null, refresh: () => Promise<void> }
 * }
 */
export function createMemberProfileHook({ useService } = {}) {
  if (typeof useService !== 'function') {
    throw new TypeError('createMemberProfileHook: useService hook required');
  }

  return function useMemberProfile({ pubKey, stableId, webid } = {}) {
    const svc = useService();
    const [member,  setMember]  = useState(null);
    const [loading, setLoading] = useState(false);
    const [error,   setError]   = useState(null);

    const refresh = useCallback(async () => {
      const map = svc?.activeBundle?.members;
      if (!map) {
        setMember(null);
        return;
      }
      setLoading(true);
      setError(null);
      try {
        let m = null;
        if (pubKey   && typeof map.resolveByPubKey  === 'function') m = await map.resolveByPubKey(pubKey);
        if (!m && stableId && typeof map.resolveByStableId === 'function') m = await map.resolveByStableId(stableId);
        if (!m && webid    && typeof map.resolveByWebid    === 'function') m = await map.resolveByWebid(webid);
        if (!m) {
          const err = new Error('Unknown member');
          err.code = 'UNKNOWN_MEMBER';
          setError(err);
        } else {
          setMember(m);
        }
      } catch (err) {
        setError(err);
      } finally {
        setLoading(false);
      }
    }, [svc, pubKey, stableId, webid]);

    useEffect(() => { refresh().catch(() => {}); }, [refresh]);

    return { member, loading, error, refresh };
  };
}
