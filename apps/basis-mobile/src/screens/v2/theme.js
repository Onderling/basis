/**
 * basis-mobile v2 — Onderling theme (RN).
 *
 * Derives from the canonical token object (apps/basis/src/v2/theme.js,
 * re-exported as THEME/THEME_DARK) so web + mobile share one source of truth.
 * The mobile theme IMPORTS the shared colour tokens (it does NOT duplicate the
 * hex values), so bot-bubble / consent tokens added to the shared source
 * (botBg / botLine / consentBg, light + dark) are available here for free.
 *
 * Reactive theme (2026-07-18): the display theme is now driven by a stored
 * preference (systeem / licht / donker) through the theme context
 * (./themeContext.js). This module keeps a LIVE `theme` singleton that
 * `applyTheme(pref, osScheme)` reassigns, plus `subscribeTheme` — mirroring the
 * subscribeLang idiom. `resolveTheme` is the pure pref→theme map (the decision
 * itself is the shared, off-platform-testable `resolveThemeName`).
 *
 * Every v2 screen reads the theme through `useTheme()` at render and builds its
 * styles with `makeStyles(theme)`, so a systeem/licht/donker flip repaints at once.
 * What stays light are NATIVE pieces the theme does not reach (`Alert`, the date
 * picker, a `Modal` without a themed backdrop) and the three pre-v2 onboarding
 * screens (docs/conventions/web-mobile-exceptions.md).
 *
 * Bulletin design: headings are bold SYSTEM sans (undefined fontFamily =
 * RN system default); Source Serif is gone with the linen theme.
 */
import { Appearance } from 'react-native';
import { THEME, THEME_DARK, resolveThemeName } from '@onderling-app/basis';

const FONT = {
  serif:     undefined, // system sans — bulletin headings are bold sans
  serifBody: undefined,
  mono:      'monospace',
};

const wrap = (tokens) => ({
  color:  tokens.color,
  radius: tokens.radius,
  space:  tokens.space,
  font:   FONT,
});

export const themeLight = wrap(THEME);
export const themeDark = wrap(THEME_DARK);

/** Pure: preference ('system'|'light'|'dark') + OS scheme → the wrapped theme. */
export function resolveTheme(pref, osScheme) {
  return resolveThemeName(pref, osScheme) === 'dark' ? themeDark : themeLight;
}

// Live singleton — reassigned by `applyTheme` so render-time readers and the
// theme context share one source. Boot value follows the OS scheme (Appearance
// is synchronous) until the stored preference hydrates.
const bootScheme = typeof Appearance?.getColorScheme === 'function' ? Appearance.getColorScheme() : 'light';
export let theme = resolveTheme('system', bootScheme);

const _themeListeners = new Set();
/** Subscribe to live theme changes. Returns an unsubscribe fn (mirrors subscribeLang). */
export function subscribeTheme(cb) { _themeListeners.add(cb); return () => _themeListeners.delete(cb); }

/** Reassign the live `theme` singleton from a preference + OS scheme; notify subscribers. */
export function applyTheme(pref, osScheme) {
  theme = resolveTheme(pref, osScheme);
  for (const cb of _themeListeners) { try { cb(theme); } catch { /* ignore */ } }
  return theme;
}

export default theme;
