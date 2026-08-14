/**
 * basis-mobile v2 — reactive theme context.
 *
 * The mobile display theme used to be picked ONCE at module load from the OS
 * scheme, which is why the in-app light/dark toggle was web-only. This provider
 * makes it reactive:
 *
 *  - it reads the stored preference (systeem / licht / donker) from AsyncStorage
 *    through the SHARED themePref store (same 'basis.theme' key + vocabulary as
 *    web — web≡mobile by construction);
 *  - it resolves 'system' against the LIVE OS scheme via useColorScheme (so an
 *    OS light↔dark flip applies immediately while on 'system');
 *  - it exposes the resolved theme via useTheme() and the [pref, setPref] pair
 *    via useThemePref();
 *  - changing the preference re-renders the subtree and keeps the module `theme`
 *    singleton in sync (applyTheme) for module/render-time readers.
 *
 * Screens that read useTheme() at render time recolour live on toggle; the
 * remaining module-level-StyleSheet screens pick up the resolved palette on
 * their next mount. See ./theme.js for that seam.
 */
import React, { createContext, useContext, useState, useEffect, useCallback, useMemo } from 'react';
import { useColorScheme } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  DEFAULT_THEME_PREF, normalizeThemePref,
  createThemePrefStore, asyncStorageThemePrefIo,
} from '@onderling-app/basis';
import { resolveTheme, applyTheme, theme as singletonTheme } from './theme.js';

// One store per launch (cached synchronous get + async hydrate), mirroring
// surfacePrefStore. Persists to the shared 'basis.theme' key.
const store = createThemePrefStore(asyncStorageThemePrefIo(AsyncStorage));

const ThemeContext = createContext(null);

// The register is the AUTHORITY for the theme since the device-params consolidation; the shared
// 'basis.theme' AsyncStorage key stays the PRE-BOOT CACHE (the provider paints before the agent
// exists). App.js attaches the booted agent here: sets flow through the one kind-gated write, and
// the attach reconciles cache←register (register wins) through the provider's own state.
let _agent = null;
let _onAgentAttached = null;
export function attachThemeAgent(agent) {
  _agent = agent ?? null;
  if (_agent && typeof _onAgentAttached === 'function') _onAgentAttached(_agent);
}

export function ThemeProvider({ children }) {
  const osScheme = useColorScheme();                     // live OS scheme: 'light' | 'dark' | null
  const [pref, setPrefState] = useState(store.get());    // cached default ('system') until hydrate resolves

  // Hydrate the persisted preference once.
  useEffect(() => {
    let alive = true;
    store.hydrate().then((p) => { if (alive) setPrefState(p); }).catch(() => {});
    // Reconcile from the REGISTER once the agent attaches (register wins over the cache);
    // the cache follows via store.set so the next pre-boot paint agrees.
    _onAgentAttached = (agent) => {
      if (!alive) return;
      const v = agent.getParamValue?.('display.theme');
      const next = normalizeThemePref(v);
      if ((v === 'system' || v === 'light' || v === 'dark') && next !== store.get()) {
        setPrefState(next);
        store.set(next).catch(() => {});
      }
    };
    if (_agent) _onAgentAttached(_agent);
    return () => { alive = false; _onAgentAttached = null; };
  }, []);

  const resolved = useMemo(() => resolveTheme(pref, osScheme), [pref, osScheme]);

  // Keep the module singleton in step so screens that read `theme` (module-level
  // or at render) track the active choice on their next render/mount.
  useEffect(() => { applyTheme(pref, osScheme); }, [pref, osScheme]);

  const setPref = useCallback((v) => {
    const next = normalizeThemePref(v);
    setPrefState(next);
    store.set(next).catch(() => {});   // the pre-boot cache (clears the key on 'system')
    // …and the authority (same-value echoes from the reconcile are idempotent).
    _agent?.callSkill?.('params', 'set-param', { key: 'display.theme', value: next })
      .catch(() => { /* the cache stands */ });
  }, []);

  const value = useMemo(() => ({ theme: resolved, pref, setPref }), [resolved, pref, setPref]);
  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

/** The resolved theme object. Falls back to the module singleton outside a provider. */
export function useTheme() {
  const ctx = useContext(ThemeContext);
  return ctx ? ctx.theme : singletonTheme;
}

/** `[pref, setPref]` for the display-theme toggle. No-op setter outside a provider. */
export function useThemePref() {
  const ctx = useContext(ThemeContext);
  if (!ctx) return [DEFAULT_THEME_PREF, () => {}];
  return [ctx.pref, ctx.setPref];
}

export default ThemeProvider;
