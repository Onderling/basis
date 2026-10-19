/**
 * screenSections — what a hand-painted screen SHOWS, declared once: its sections, in order, each with the words of
 * its title. Both shells paint a declared screen from this list (section id = the web `data-section` and the mobile
 * testID), so a section on one shell only is a red guard (`lint-screen-sections`), not a finding weeks later.
 *
 * Why: the projector guards cover what a manifest declares; a screen painted by hand (DOM on web, JSX on mobile) had
 * nothing declaring what it holds, and the buttons assessment (2026-10-19) found five gaps there — the admin's
 * outbound shares among them, the circle's privacy controls. Sections and actions only, never layout or idiom: a
 * shell orders, groups and styles as its platform does.
 */

/** @typedef {{ id: string, titleKey: string }} ScreenSection */

export const SCREEN_SECTIONS = Object.freeze({
  // A circle's admin panel: who is in it (roles, remove, leave), a line to everyone, what it shared out (and taking it
  // back), and whom this device muted. The circle's privacy controls live here, so it is the first screen declared.
  adminPanel: Object.freeze([
    Object.freeze({ id: 'admin-members',         titleKey: 'circle.admin.members' }),
    Object.freeze({ id: 'admin-announce',        titleKey: 'circle.admin.announce' }),
    Object.freeze({ id: 'admin-outbound-shares', titleKey: 'circle.share.outbound_title' }),
    Object.freeze({ id: 'admin-muted',           titleKey: 'circle.admin.muted' }),
  ]),
});

/**
 * A declared screen's sections, in order ([] for a screen not declared).
 * @param {string} screen
 * @returns {ReadonlyArray<ScreenSection>}
 */
export function sectionsOf(screen) {
  return SCREEN_SECTIONS[screen] ?? [];
}
