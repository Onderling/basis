/**
 * usePushOptIn — hook that handles the permission-rationale → request
 * → registration flow, surfacing `{status, token, error, request,
 * teardown}` for the consumer's Settings screen.
 *
 * Plan (Phase 41.0 L6): Tasks-mobile + Pinboard-mobile both consume.
 * The hook stays agent-agnostic — the consumer passes the live agent
 * (after bootstrap) and a token-change callback.
 *
 *   const push = usePushOptIn({
 *     agent: bundle.agent,
 *     projectId,
 *     onTokenChange: (token, platform) => relayClient.register({...}),
 *   });
 *   // push.status: 'idle' | 'requesting' | 'granted' | 'denied' | 'error'
 *   // push.request() — kick the OS prompt + bridge bring-up
 *   // push.teardown() — unregister on sign-out
 */

import { useCallback, useRef, useState } from 'react';
import { setupPush, requestPushPermission } from './setupPush.js';

/**
 * @param {object} args
 * @param {object} args.agent
 * @param {string} [args.projectId]
 * @param {(token: string, platform: string) => void} [args.onTokenChange]
 * @param {(err: unknown) => void} [args.onError]
 * @param {() => object | Promise<object>} [args.AdapterFactory]
 * @param {object} [args.NotificationsModule]   inject for tests
 * @returns {{
 *   status:   'idle' | 'requesting' | 'granted' | 'denied' | 'error',
 *   token:    string | null,
 *   platform: string | null,
 *   error:    Error | null,
 *   request:  () => Promise<void>,
 *   teardown: () => Promise<void>,
 * }}
 */
export function usePushOptIn({
  agent,
  projectId,
  onTokenChange,
  onError,
  AdapterFactory,
  NotificationsModule,
} = {}) {
  const [status,   setStatus]   = useState('idle');
  const [token,    setToken]    = useState(null);
  const [platform, setPlatform] = useState(null);
  const [error,    setError]    = useState(null);
  const teardownRef = useRef(async () => {});

  const request = useCallback(async () => {
    if (!agent) {
      const e = new Error('usePushOptIn: agent required');
      setStatus('error');
      setError(e);
      if (onError) onError(e);
      return;
    }
    setStatus('requesting');
    setError(null);
    try {
      const perm = await requestPushPermission({ NotificationsModule });
      if (!perm.granted) {
        setStatus('denied');
        return;
      }
      const r = await setupPush({
        agent,
        projectId,
        AdapterFactory,
        onError,
        onToken: (tok, plat) => {
          setToken(tok);
          setPlatform(plat);
          if (onTokenChange) onTokenChange(tok, plat);
        },
      });
      teardownRef.current = r.teardown;
      if (!r.token) {
        setStatus('error');
        setError(new Error('usePushOptIn: registration returned no token'));
        return;
      }
      setStatus('granted');
    } catch (err) {
      setStatus('error');
      setError(err);
      if (onError) onError(err);
    }
  }, [agent, projectId, onTokenChange, onError, AdapterFactory, NotificationsModule]);

  const teardown = useCallback(async () => {
    try { await teardownRef.current(); }
    catch (err) { if (onError) onError(err); }
    finally {
      teardownRef.current = async () => {};
      setToken(null);
      setPlatform(null);
      setStatus('idle');
    }
  }, [onError]);

  return { status, token, platform, error, request, teardown };
}
