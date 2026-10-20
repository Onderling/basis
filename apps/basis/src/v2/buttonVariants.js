/**
 * The button family's variants, the same on both shells: web paints them as `.cc-btn--<variant>`
 * (web/v2/circle.css), mobile as `<Btn variant>` (basis-mobile Btn.js). One list, so the two cannot drift.
 *   quiet   — the default: a pill with an ink border
 *   primary — ONE per screen: the act the screen is for
 *   danger  — an act that destroys (delete, revoke, remove)
 *   ghost   — a text button (a row's own act, "more")
 */
export const BUTTON_VARIANTS = Object.freeze(['quiet', 'primary', 'danger', 'ghost']);
