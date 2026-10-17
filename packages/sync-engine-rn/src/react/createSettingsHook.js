/**
 * createSettingsHook — factory that produces a `useSettings` hook over
 * the consumer's `getSettings` / `updateSettings` skills.
 *
 * Lifted from apps/pinboard-mobile/src/lib/useSettings.js 2026-05-09
 * (Phase 41.0.b A7; Tasks-mobile is the second consumer).
 *
 *   const useSettings = createSettingsHook({
 *     useService,
 *     getSkill:    'getSettings',     // default
 *     updateSkill: 'updateSettings',  // default
 *   });
 *
 *   const s = useSettings();
 *   s.settings.pollIntervalMs
 *   await s.update({ pollIntervalMs: 10000 }, 'device');
 *
 * Uses the same `_scope` injection pattern as `useSkill` so a
 * single-agent topology resolves the right bundle on dispatch.
 */

import { useCallback, useEffect, useState } from 'react';
import { toParts, unwrapParts } from './skillParts.js';

/**
 * @param {object} args
 * @param {() => object} args.useService
 * @param {string} [args.getSkill='getSettings']
 * @param {string} [args.updateSkill='updateSettings']
 * @returns {() => {
 *   settings: object | null,
 *   loading:  boolean,
 *   error:    Error | null,
 *   refresh:  () => Promise<void>,
 *   update:   (patch: object, scope?: 'device'|'shared'|null) => Promise<object|null>,
 * }}
 */
export function createSettingsHook({
  useService,
  getSkill    = 'getSettings',
  updateSkill = 'updateSettings',
} = {}) {
  if (typeof useService !== 'function') {
    throw new TypeError('createSettingsHook: useService hook required');
  }

  return function useSettings() {
    const svc = useService();
    const [settings, setSettings] = useState(null);
    const [loading,  setLoading]  = useState(false);
    const [error,    setError]    = useState(null);

    const _invoke = useCallback(async (skillId, args) => {
      const bundle = svc?.activeBundle;
      if (!bundle?.agent?.invoke) {
        const err = new Error('No active agent.');
        err.code = 'NO_AGENT';
        throw err;
      }
      const localPeer = bundle.agent.address ?? bundle.agent.identity?.pubKey ?? null;
      const baseArgs = (args && typeof args === 'object' && !Array.isArray(args)) ? args : {};
      const enriched = Array.isArray(args) ? args : {
        ...baseArgs,
        _scope: bundle.groupId ?? svc?.activeGroupId ?? null,
      };
      const rawParts = await bundle.agent.invoke(localPeer, skillId, toParts(enriched));
      return unwrapParts(rawParts);
    }, [svc]);

    const refresh = useCallback(async () => {
      if (!svc?.activeBundle) { setSettings(null); return; }
      setLoading(true);
      setError(null);
      try {
        const r = await _invoke(getSkill, {});
        setSettings(r?.settings ?? null);
      } catch (err) {
        if (err?.code !== 'NO_AGENT') setError(err);
      } finally {
        setLoading(false);
      }
    }, [_invoke, svc]);

    useEffect(() => { refresh().catch(() => {}); }, [refresh, svc?.activeGroupId]);

    const update = useCallback(async (patch, scope = null) => {
      setSettings((prev) => {
        if (!prev) return prev;
        const next = { ...prev, ...patch };
        if (patch?.onlineWindow) {
          next.onlineWindow = { ...(prev.onlineWindow ?? {}), ...patch.onlineWindow };
        }
        return next;
      });
      const r = await _invoke(updateSkill, { patch, scope });
      if (r?.error) throw new Error(r.error);
      if (r?.settings) setSettings(r.settings);
      return r?.settings ?? null;
    }, [_invoke]);

    return { settings, loading, error, refresh, update };
  };
}
