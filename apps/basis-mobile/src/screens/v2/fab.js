/**
 * THE "+": docked in the tab bar now (manifest `plus`); `FAB.bottom` is where the round buttons of the opened "+" sit
 * above the bar (web twin: `.circle-plusdial` in circle.css), and the room every scrolling list leaves at its end so the
 * last row is never under them.
 */
export const FAB = Object.freeze({ bottom: 76, size: 56 });
export const FAB_CLEARANCE = FAB.bottom + FAB.size + 16;

/** THE PERSONA BUTTON, top-right on every tab, and the room a page's top leaves so its first card is not under it. */
export const PERSONA_BUTTON = Object.freeze({ top: 8, right: 12, size: 34 });
export const PERSONA_BUTTON_CLEARANCE = PERSONA_BUTTON.top + PERSONA_BUTTON.size + 8;
/** THE SETTINGS BUTTON, the gear just left of the persona button, the same size. */
export const SETTINGS_BUTTON_GAP = 6;
// what a header ROW beside the two buttons keeps free on its right, so its buttons wrap instead of hiding under them
export const PERSONA_BUTTON_SIDE_CLEARANCE = PERSONA_BUTTON.right + 2 * PERSONA_BUTTON.size + SETTINGS_BUTTON_GAP + 8;
