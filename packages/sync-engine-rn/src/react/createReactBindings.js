/**
 * createReactBindings — substrate factory that produces React hooks
 * for invoking skills on the active agent bundle.
 *
 * Lifted from apps/pinboard-mobile/src/lib/{useSkill,useAgentEvent,useSkillResult}.js
 * 2026-05-09 (Tasks-mobile is the second consumer).
 *
 * Why a factory: the substrate-level hooks need to read the active
 * bundle from a React context, but the *shape* of that context is
 * app-specific (each app names its provider differently and may carry
 * extra state alongside `activeBundle`). We accept a `useService` hook
 * as a parameter and produce hooks that read through it. Apps wire it
 * at boot:
 *
 *   // apps/<app>-mobile/src/lib/useSkill.js
 *   import { createReactBindings } from '@onderling/sync-engine-rn/react';
 *   import { useService } from '../ServiceContext.js';
 *   export const { useSkill, useAgentEvent, useSkillResult } =
 *     createReactBindings({ useService });
 *
 * The expected `useService` return shape:
 *   {
 *     activeBundle?:       { agent, groupId?, offeringMatch?, ... } | null,
 *     activeGroupId?:      string | null,
 *     ensureActiveBundle?: () => Promise<bundle>,  // optional; lazy bring-up
 *   }
 *
 * Both `useSkill().call(args)` and `useSkillResult(skill, args, deps)`
 * inject `_scope: bundle.groupId ?? svc.activeGroupId ?? null` into
 * the args object so a single agent shared across N groups/circles can
 * resolve the right bundle at dispatch time. The Pinboard V3 +
 * Tasks single-agent refactors both rely on this. (Plain arrays
 * pass through unchanged.)
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { toParts, unwrapParts } from './skillParts.js';

/**
 * @param {object} args
 * @param {() => object} args.useService   App-supplied React hook that
 *   returns `{activeBundle, activeGroupId?, ensureActiveBundle?}`.
 * @returns {{
 *   useSkill:       (skillId: string) => { call, loading, error, result, reset },
 *   useAgentEvent:  (eventName: string) => unknown,
 *   useSkillResult: (skillId: string, args?: object, deps?: unknown[]) =>
 *                     { data, loading, error, refresh },
 * }}
 */
export function createReactBindings({ useService } = {}) {
  if (typeof useService !== 'function') {
    throw new TypeError('createReactBindings: useService hook required');
  }

  function useSkill(skillId) {
    const svc = useService();
    const [loading, setLoading] = useState(false);
    const [error,   setError]   = useState(null);
    const [result,  setResult]  = useState(undefined);

    const cancelledRef = useRef(false);
    useEffect(() => () => { cancelledRef.current = true; }, []);

    const call = useCallback(async (args) => {
      if (typeof skillId !== 'string' || !skillId) {
        throw new Error('useSkill: skillId required');
      }
      let bundle = svc?.activeBundle;
      if (!bundle?.agent?.invoke) {
        if (typeof svc?.ensureActiveBundle !== 'function') {
          const e = new Error('No active agent yet — please reload the app (the JS bundle is stale).');
          e.code = 'STALE_BUNDLE';
          throw e;
        }
        try {
          bundle = await svc.ensureActiveBundle();
        } catch (err) {
          const e = new Error(`Could not initialise agent: ${err?.message ?? err}`);
          e.code  = err?.code ?? 'NO_AGENT';
          e.cause = err;
          throw e;
        }
        if (!bundle?.agent?.invoke) {
          const e = new Error('No active agent — bootstrap returned an invalid bundle.');
          e.code = 'NO_AGENT';
          throw e;
        }
      }

      setLoading(true);
      setError(null);
      try {
        const baseArgs = (args && typeof args === 'object' && !Array.isArray(args)) ? args : {};
        const enrichedArgs = Array.isArray(args)
          ? args
          : { ...baseArgs, _scope: bundle.groupId ?? svc?.activeGroupId ?? null };
        const parts = toParts(enrichedArgs);
        const localPeer = bundle.agent.address ?? bundle.agent.identity?.pubKey ?? null;
        const rawParts = await bundle.agent.invoke(localPeer, skillId, parts);
        const r = unwrapParts(rawParts);
        if (cancelledRef.current) return r;
        setResult(r);
        return r;
      } catch (err) {
        if (!cancelledRef.current) setError(err);
        throw err;
      } finally {
        if (!cancelledRef.current) setLoading(false);
      }
    }, [skillId, svc]);

    const reset = useCallback(() => {
      setLoading(false);
      setError(null);
      setResult(undefined);
    }, []);

    return { call, loading, error, result, reset };
  }

  function useAgentEvent(eventName) {
    const svc = useService();
    const [payload, setPayload] = useState(undefined);

    useEffect(() => {
      const agent = svc?.activeBundle?.agent;
      if (!agent || typeof agent.on !== 'function') return undefined;

      const handler = (next) => setPayload(next);
      agent.on(eventName, handler);
      return () => {
        try {
          if (typeof agent.off === 'function') agent.off(eventName, handler);
          else if (typeof agent.removeListener === 'function') agent.removeListener(eventName, handler);
        } catch { /* swallow — agent may already be torn down */ }
      };
    }, [svc, eventName, svc?.activeBundle]);

    return payload;
  }

  function useSkillResult(skillId, args, deps = []) {
    const svc = useService();
    const [data, setData]       = useState(null);
    const [loading, setLoading] = useState(false);
    const [error, setError]     = useState(null);

    const cancelledRef = useRef(false);
    useEffect(() => () => { cancelledRef.current = true; }, []);

    const refresh = useCallback(async () => {
      const bundle = svc?.activeBundle;
      if (!bundle?.agent?.invoke) {
        setData(null);
        return null;
      }
      setLoading(true);
      setError(null);
      try {
        const localPeer = bundle.agent.address ?? bundle.agent.identity?.pubKey ?? null;
        const baseArgs = (args && typeof args === 'object' && !Array.isArray(args)) ? args : {};
        const enriched = Array.isArray(args) ? args : {
          ...baseArgs,
          _scope: bundle.groupId ?? svc?.activeGroupId ?? null,
        };
        const rawParts = await bundle.agent.invoke(localPeer, skillId, toParts(enriched));
        const r = unwrapParts(rawParts);
        if (cancelledRef.current) return r;
        setData(r);
        return r;
      } catch (err) {
        if (!cancelledRef.current) setError(err);
        return null;
      } finally {
        if (!cancelledRef.current) setLoading(false);
      }
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [svc, skillId, ...deps]);

    useEffect(() => { refresh().catch(() => { /* swallow */ }); }, [refresh]);

    return { data, loading, error, refresh };
  }

  return { useSkill, useAgentEvent, useSkillResult };
}
