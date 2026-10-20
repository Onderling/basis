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

/** @typedef {{ id: string, titleKey: string|null }} ScreenSection  (a section with no heading of its own has no title key) */

export const SCREEN_SECTIONS = Object.freeze({
  // A circle's admin panel: who is in it (roles, remove, leave), a line to everyone, what it shared out (and taking it
  // back), and whom this device muted. The circle's privacy controls live here, so it is the first screen declared.
  adminPanel: Object.freeze([
    Object.freeze({ id: 'admin-members',         titleKey: 'circle.admin.members' }),
    Object.freeze({ id: 'admin-announce',        titleKey: 'circle.admin.announce' }),
    Object.freeze({ id: 'admin-outbound-shares', titleKey: 'circle.share.outbound_title' }),
    Object.freeze({ id: 'admin-muted',           titleKey: 'circle.admin.muted' }),
  ]),
  // A member card (another member's, or your own as someone sees it): how much it reveals, what this viewer sees, what
  // stays hidden. The reveal is the person's own disclosure fact; it was missing on the phone (L359).
  memberCard: Object.freeze([
    Object.freeze({ id: 'membercard-preset', titleKey: 'circle.memberCard.preset_label' }),
    Object.freeze({ id: 'membercard-sees',   titleKey: 'circle.memberCard.sees' }),
    Object.freeze({ id: 'membercard-hides',  titleKey: 'circle.memberCard.hides' }),
  ]),
  // A file someone sent in a contact thread: an image shows itself, every file its name and size, and a way to keep it
  // (web's Download; the phone's folder picker). The keep action was missing on the phone (L349).
  fileBubble: Object.freeze([
    Object.freeze({ id: 'file-preview', titleKey: null }),
    Object.freeze({ id: 'file-meta',    titleKey: null }),
    Object.freeze({ id: 'file-save',    titleKey: 'circle.fileShare.download' }),
  ]),
  // An open governance proposal: what it is (action · decision class), where it stands (status · tally · when it closes ·
  // awaiting enactment), and what this person may do (vote · an admin's override). The deadline was missing on the
  // phone (L353). Status, tally, deadline and awaiting are one meta row on both shells (grouping is layout).
  governanceProposal: Object.freeze([
    Object.freeze({ id: 'proposal-head',     titleKey: null }),
    Object.freeze({ id: 'proposal-status',   titleKey: null }),
    Object.freeze({ id: 'proposal-tally',    titleKey: null }),
    Object.freeze({ id: 'proposal-deadline', titleKey: null }),
    Object.freeze({ id: 'proposal-awaiting', titleKey: 'circle.governance.awaiting_enactment' }),
    Object.freeze({ id: 'proposal-vote',     titleKey: null }),
    Object.freeze({ id: 'proposal-override', titleKey: 'circle.governance.override' }),
  ]),
  // Vandaag's customise sheet: the page's blocks (move, remove, each one's settings), what can be added, the page itself
  // (rename, add one, remove it), and undo. The block list is the shared customise model; these are its frame.
  vandaagCustomise: Object.freeze([
    Object.freeze({ id: 'customise-blocks', titleKey: 'circle.vandaag.blocks_title' }),
    Object.freeze({ id: 'customise-add',    titleKey: 'circle.vandaag.add_block_title' }),
    Object.freeze({ id: 'customise-page',   titleKey: 'circle.vandaag.page_title' }),
    Object.freeze({ id: 'customise-undo',   titleKey: 'circle.vandaag.undo' }),
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
