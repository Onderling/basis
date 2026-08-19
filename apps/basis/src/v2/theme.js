/**
 * basis v2 — Onderling design tokens (canonical, portable).
 *
 * The "bulletin" design language (2026-07): one identity shared with
 * onderling.org — warm paper ground, near-black ink, hard ink borders,
 * bold sans headings, mono accents, green for links/status. Canonical CSS
 * reference: the onderling-site repo, src/site.css. The previous
 * "linen + serif + terracotta" tokens are preserved in ./theme-linen.js.
 *
 * This object is the single token source:
 *  - web/v2/theme.css is GENERATED from this file — run
 *    `node scripts/theme-css.mjs` after editing (checked by theme-fitness);
 *  - the mobile theme (basis-mobile/src/screens/v2/theme.js) imports
 *    THEME/THEME_DARK from here via '@onderling-app/basis'.
 *
 * THEME and THEME_DARK have the identical shape; consumers pick one.
 * `accent` is the ACTION color (ink — the bulletin's black button) and
 * `accentContrast` its text; `accentInk` is accent-colored TEXT (green).
 */

export const THEME = {
  color: {
    ink:       '#17181a', // primary text
    inkSoft:   '#5b5d55', // muted text, section labels
    paper:     '#f7f7f4', // app background (warm paper)
    paper2:    '#ebeae4', // card header strip / inset
    line:      '#d8d8cf', // borders / hairlines
    accent:    '#17181a', // primary buttons, active state — ink
    accentContrast: '#f7f7f4', // text/icons on accent
    accentInk: '#a3402f', // accent-colored text, links, active tab — THE rust (A+C decision 2026-07-17)
    card:      '#ffffff', // framed-card inner / bot card container
    meBg:      '#e8e6da', // "me" chat bubble — warm light grey (right-aligned)
    botBg:     '#f1f4ee', // bot/other chat bubble fill (left-aligned)
    botLine:   '#dfe6da', // bot bubble hairline border (soft green-grey)
    consentBg: '#faf1ea', // consent/handoff card fill (light peach; border = accentInk dashed)
    green:   '#2e7d4f', greenBg: '#e9efe6', // STATUS only: delivered / lokaal / OFFER
    blue:    '#3f4f76', blueBg:  '#e0e4ee', // betaald / ASK / "via hop"
    amber:   '#7a5a1f', amberBg: '#ede5cf', // LEND
    danger:  '#963528', dangerBg:'#f5e7e2', // blocked / warning — deeper than accentInk rust
    trackOff:'#c9c8c0', // pill-toggle off track
    white:   '#ffffff',
  },
  font: {
    // Bold sans carries the identity; serif is a small accent (stats-strip
    // style), system-local — no webfont download. On mobile these names are
    // remapped in basis-mobile/src/screens/v2/theme.js.
    serif: 'Georgia, "Iowan Old Style", "Times New Roman", serif',
    sans:  '"Helvetica Neue", Helvetica, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Arial, sans-serif',
    mono:  'ui-monospace, SFMono-Regular, Menlo, "Roboto Mono", monospace',
  },
  radius: { sm: 4, md: 8, lg: 10, pill: 999 },
  space:  { xs: 4, sm: 8, md: 12, lg: 16, xl: 24 },
};

// Same structure on a dark ground (the site's dark variant): the action
// color inverts to light ink, links/status lift to the lighter green.
export const THEME_DARK = {
  color: {
    ink:       '#eceade',
    inkSoft:   '#9a9d90',
    paper:     '#161713',
    paper2:    '#22231e',
    line:      '#34362e',
    accent:    '#eceade',
    accentContrast: '#161713',
    accentInk: '#d98a70',
    card:      '#1e1f1a',
    meBg:      '#2b2d25',
    botBg:     '#22291f', // bot/other chat bubble fill (dark)
    botLine:   '#33402f', // bot bubble hairline (dark)
    consentBg: '#2a221c', // consent/handoff card fill (dark warm)
    green:   '#82c298', greenBg: '#22291f',
    blue:    '#9fb0d8', blueBg:  '#232837',
    amber:   '#d0b070', amberBg: '#2e2921',
    danger:  '#e06749', dangerBg:'#332420',
    trackOff:'#3a3c34',
    white:   '#1e1f1a', // "white" surfaces follow the card surface in dark
  },
  font:   THEME.font,
  radius: THEME.radius,
  space:  THEME.space,
};

// Soft per-circle avatar tints (each circle gets its own shade),
// retuned to the bulletin palette. Assigned by a stable hash of the circle
// id so a circle keeps its colour across renders.
export const AVATAR_TINTS = ['#e0e4ee', '#e9efe6', '#ede5cf', '#ebeae4', '#f5e7e2'];

export function circleTint(seed) {
  const s = String(seed || '');
  let h = 0;
  for (let i = 0; i < s.length; i += 1) h = (h * 31 + s.charCodeAt(i)) >>> 0;
  return AVATAR_TINTS[h % AVATAR_TINTS.length];
}

/**
 * Tag-chip palette keyed by the stream item kind. Returns
 * `{ fg, bg }`; unknown kinds fall back to the neutral ink-soft/line pair.
 * Pass `THEME_DARK.color` as `palette` when rendering on the dark theme.
 */
export function tagColors(kind, palette = THEME.color) {
  const c = palette;
  switch (String(kind || '').toLowerCase()) {
    case 'ask':
    case 'hop':       return { fg: c.blue,  bg: c.blueBg };
    case 'offer':     return { fg: c.green, bg: c.greenBg };
    case 'lend':
    case 'borrow':
    case 'loan':      return { fg: c.amber, bg: c.amberBg };
    case 'agent':     return { fg: c.inkSoft, bg: c.paper2 };
    default:          return { fg: c.inkSoft, bg: c.paper2 };
  }
}
