/**
 * The wizard kit's palette — pure data + one mapping function, deliberately NOT in `_kit.js`.
 *
 * `_kit.js` is JSX, which vitest cannot import from a `.js` file, so anything living there is untestable
 * except through a parse guard. This is the part worth testing: which app colour becomes which kit slot,
 * and the invariant that ink never equals card. Extracted 2026-07-30 when the join sheet turned out to be
 * dark with dark text on it — theming a container and not its contents looks broken rather than plain.
 */

export const LIGHT = Object.freeze({
  ink: '#222', inkStrong: '#333', inkSoft: '#666', inkMuted: '#555', inkFaint: '#888',
  card: '#fff', field: '#fff', rail: '#e8e8e8', railSoft: '#f0f0f0', quote: '#f7f7f7', hair: '#eee',
  accent: '#1e88e5', accentStrong: '#1565c0', accentSoft: '#e3f2fd',
  done: '#43a047', onAccent: '#fff',
  info: '#b5651d', infoInk: '#5d4037',
  warnSurface: '#fff8e1', warnEdge: '#ffd54f',
  danger: '#b00', dangerSurface: '#fde8e8', dangerEdge: '#f5b5b5',
});

/** Map an app theme (`{color:{…}}`) onto the kit's palette. Absent/partial ⇒ the light default. */
export function wizardPalette(theme) {
  const c = theme?.color;
  if (!c) return LIGHT;
  return Object.freeze({
    ...LIGHT,
    ink:      c.ink      ?? LIGHT.ink,
    inkSoft:  c.inkSoft  ?? LIGHT.inkSoft,
    inkMuted: c.inkSoft  ?? LIGHT.inkMuted,
    inkStrong: c.ink     ?? LIGHT.inkStrong,
    inkFaint:  c.inkSoft ?? LIGHT.inkFaint,
    card:     c.card     ?? LIGHT.card,
    field:    c.card     ?? LIGHT.field,
    // Surfaces that sit ON the card: in a dark theme a lighter grey reads as raised, which is what these
    // were doing in light. `consentBg` is the app's own warm raised fill, so reuse it where it exists.
    railSoft: c.consentBg ?? c.card ?? LIGHT.railSoft,
    quote:    c.consentBg ?? c.card ?? LIGHT.quote,
    infoInk:  c.ink      ?? LIGHT.infoInk,
    rail:     c.line     ?? c.card ?? LIGHT.rail,
    hair:     c.line     ?? LIGHT.hair,
  });
}
