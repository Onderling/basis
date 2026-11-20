/**
 * THE "+": docked in the tab bar now (manifest `plus`); `FAB.bottom` is where the round buttons of the opened "+" sit
 * above the bar (web twin: `.circle-plusdial` in circle.css), and the room every scrolling list leaves at its end so the
 * last row is never under them.
 */
export const FAB = Object.freeze({ bottom: 76, size: 56 });
export const FAB_CLEARANCE = FAB.bottom + FAB.size + 16;

/** THE HEADER AVATAR, top-right on every tab, and the room a page's top leaves so its first card is not under it. */
export const HEADER_AVATAR = Object.freeze({ top: 8, right: 12, size: 34 });
export const HEADER_AVATAR_CLEARANCE = HEADER_AVATAR.top + HEADER_AVATAR.size + 8;
// what a header ROW beside the avatar keeps free on its right, so its buttons wrap instead of hiding under it
export const HEADER_AVATAR_SIDE_CLEARANCE = HEADER_AVATAR.right + HEADER_AVATAR.size + 8;
