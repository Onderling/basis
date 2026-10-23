/**
 * THE "+": the one floating button on every tab — where it sits and how big it is (web twin: `.cc-fab` in circle.css),
 * and the room every scrolling list under it leaves at its end so the last row is never under the button.
 */
export const FAB = Object.freeze({ bottom: 76, size: 56 });
export const FAB_CLEARANCE = FAB.bottom + FAB.size + 16;

/** THE HEADER AVATAR, top-right on every tab, and the room a page's top leaves so its first card is not under it. */
export const HEADER_AVATAR = Object.freeze({ top: 8, right: 12, size: 34 });
export const HEADER_AVATAR_CLEARANCE = HEADER_AVATAR.top + HEADER_AVATAR.size + 8;
