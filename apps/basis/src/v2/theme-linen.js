/**
 * basis v2 — the RETIRED "linen + serif + terracotta" design tokens,
 * preserved verbatim (2026-07-17) when the app adopted the schets-2
 * "bulletin" identity shared with onderling.org (see ./theme.js).
 *
 * Kept on purpose — "it could come in handy later": a warm alternative
 * skin, or reference for the 36-page interface PDF this palette encoded.
 * Brand source: outreach/Onderling_v2/_chrome.css.
 *
 * Not exported from the package entry; import directly if ever needed.
 */

export const LINEN_THEME = {
  color: {
    ink:       '#1f1c14', // primary text
    inkSoft:   '#5a5240', // muted text, section labels
    paper:     '#f3efe2', // app background (linen)
    paper2:    '#ebe6d5', // card header strip / inset
    line:      '#d8d1bc', // borders / hairlines
    accent:    '#b04a30', // terracotta — primary buttons, active state
    accentInk: '#8a3a26', // terracotta text on light
    card:      '#fbf8ed', // framed-card inner / bot bubble
    meBg:      '#f6e6e0', // "me" chat bubble (warm)
    green:   '#4a6230', greenBg: '#e0e7d2', // lokaal / OFFER / "ongewijzigd"
    blue:    '#3f4f76', blueBg:  '#dde2ee', // betaald / ASK / "via hop"
    amber:   '#7a5a1f', amberBg: '#ede0c4', // LEND
    danger:  '#b04a30', dangerBg:'#f6e6e0', // blocked / warning (reuses terracotta)
    trackOff:'#cfc7b0', // pill-toggle off track
    white:   '#ffffff',
  },
  font: {
    serif: '"Source Serif 4", "Iowan Old Style", Georgia, "Times New Roman", serif',
    sans:  '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif',
    mono:  'ui-monospace, SFMono-Regular, Menlo, "Roboto Mono", monospace',
  },
  radius: { sm: 6, md: 10, lg: 14, pill: 999 },
  space:  { xs: 4, sm: 8, md: 12, lg: 16, xl: 24 },
};

// Soft per-circle avatar tints of the linen era (periwinkle / sage / tan /
// beige / rose).
export const LINEN_AVATAR_TINTS = ['#e0e3f2', '#e0e7d2', '#ece2cf', '#ece6d6', '#f3e3df'];
