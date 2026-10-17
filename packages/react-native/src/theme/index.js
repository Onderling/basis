/**
 * @onderling/react-native/theme — minimal theme infrastructure for the
 * lifted UI primitives.
 *
 * The substrate's UI components (`AvatarCircle`, `ChipRow`,
 * `ConfirmModal`, `OfferingPicker`) consume tokens via `useTheme()`.
 * Apps wrap their tree in `<ThemeProvider value={tokens}>` to inject
 * their own COLORS / SPACING / RADII / FONT_SIZES — the substrate
 * itself only ships shape + a neutral default.
 *
 * Lifted alongside Phase 41.0.b B0 (2026-05-09; Tasks-mobile is the
 * second consumer of the components, the first to need a non-Pinboard
 * palette).
 */

import { createContext, createElement, useContext } from 'react';

/**
 * @typedef {object} ThemeTokens
 * @property {object} COLORS
 * @property {object} SPACING
 * @property {object} RADII
 * @property {object} FONT_SIZES
 */

/** Neutral defaults so unwrapped components don't crash. Apps override. */
export const DEFAULT_TOKENS = Object.freeze({
  COLORS: Object.freeze({
    primary:      '#2563eb',
    primaryDark:  '#1d4ed8',
    primaryLight: '#bfdbfe',
    background:   '#ffffff',
    surface:      '#ffffff',
    surfaceMuted: '#f3f4f6',
    text:         '#111827',
    textMuted:    '#6b7280',
    textInverse:  '#ffffff',
    border:       '#e5e7eb',
    danger:       '#b91c1c',
    warning:      '#b45309',
    success:      '#16a34a',
    info:         '#0369a1',
    shadow:       'rgba(0, 0, 0, 0.08)',
    overlay:      'rgba(0, 0, 0, 0.55)',
  }),
  SPACING: Object.freeze({ xs: 4,  sm: 8, md: 12, lg: 16, xl: 24, xxl: 32 }),
  RADII:   Object.freeze({ sm: 4,  md: 8, lg: 16, pill: 999 }),
  FONT_SIZES: Object.freeze({ xs: 12, sm: 14, md: 16, lg: 18, xl: 22, xxl: 28 }),
});

const ThemeContext = createContext(DEFAULT_TOKENS);

/**
 * Wrap your app: `<ThemeProvider value={myTokens}>`.
 * `value` must contain at minimum the shape `{COLORS, SPACING, RADII, FONT_SIZES}`.
 * Missing groups fall back to the substrate defaults so apps can
 * override only what they need.
 */
export function ThemeProvider({ value, children }) {
  const merged = {
    COLORS:     { ...DEFAULT_TOKENS.COLORS,     ...(value?.COLORS     ?? {}) },
    SPACING:    { ...DEFAULT_TOKENS.SPACING,    ...(value?.SPACING    ?? {}) },
    RADII:      { ...DEFAULT_TOKENS.RADII,      ...(value?.RADII      ?? {}) },
    FONT_SIZES: { ...DEFAULT_TOKENS.FONT_SIZES, ...(value?.FONT_SIZES ?? {}) },
  };
  return createElement(ThemeContext.Provider, { value: merged }, children);
}

/** @returns {ThemeTokens} */
export function useTheme() {
  return useContext(ThemeContext);
}
