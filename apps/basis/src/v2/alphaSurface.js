/**
 * alphaSurface — the ONE list of what the alpha paints. Both shells read it, so web ≡ mobile by
 * construction (invariant 2); a guard fails a shell that paints a hidden surface from a literal.
 *
 * Frits, 2026-09-08: "Rather less functions that do well, than a multifunctional octopus that is bad at
 * everything. I don't want to delete stuff, but hide it and only return it after improving it." So
 * nothing here removes a capability: the manifests, the ops, the code and the tests of a hidden surface
 * all stay. A hidden surface is simply not PAINTED — it is not in the tab bar, its pill is not shown, and
 * a deep link to it lands on the circles list instead. Widening the alpha is one edit here.
 *
 * Hidden for the alpha, and why (plans/PLAN-alpha-surface-cut.md has the full reasoning):
 *   - the Schermen tab — a per-user screens book nobody uses, competing with Kringen for the first tap;
 *   - In de buurt — a browser cannot discover (no mDNS; Web Bluetooth cannot scan or advertise), so on the
 *     web it is a page that says it cannot do anything, and the native app is not in the store yet;
 *   - the chat ↔ scherm pill inside a circle — the scherm view is a stub that says it "komt in een
 *     vervolg-slice"; it was meant as the GUI twin of the chat and is not that yet.
 */

/** The basis manifest's top-level tabs that remain painted, in the manifest's own order (for tests). */
export const ALPHA_TABS = Object.freeze(['circles', 'contacten', 'mij']);

/** Circle view modes the alpha paints. One mode ⇒ no pill at all. */
export const ALPHA_VIEW_MODES = Object.freeze(['chat']);

/** The manifest tab ids that exist but are not painted, so a test can say so by name. */
export const HIDDEN_TABS = Object.freeze(['screens', 'nearby']);

/** Drop the hidden tabs; everything else a manifest declares is painted, in the manifest's order. A
 *  deny-list, not an allow-list: the alpha HIDES named things, it does not decide what every manifest may
 *  show — so a different manifest (a test's, a derived app's) keeps its own tabs. */
export function alphaTabs(tabs) {
  return (Array.isArray(tabs) ? tabs : []).filter((tab) => !HIDDEN_TABS.includes(tab?.id));
}

/** Whether a top-level tab id is painted in the alpha. */
export function isAlphaTab(id) {
  return !HIDDEN_TABS.includes(id);
}

/** The view modes a circle header may offer; a shell paints the pill only when there are two or more. */
export function alphaViewModes() {
  return ALPHA_VIEW_MODES;
}

/** Clamp a saved / policy-chosen view mode to one the alpha paints (a saved "screen" opens as chat). */
export function alphaViewMode(mode) {
  return ALPHA_VIEW_MODES.includes(mode) ? mode : ALPHA_VIEW_MODES[0];
}

/** Where a navigation to a hidden tab lands instead. */
export const ALPHA_FALLBACK_TAB = 'circles';

/**
 * The circle's ⋯ menu, trimmed to what a member does weekly: back · invite · settings. The rest of the
 * manifest's actions (lists, contacts, view-as, advisor, skills, files, rules, recipes, admin, governance,
 * share, override) stay declared and stay reachable through their own screens the day they come back.
 */
export const HIDDEN_CIRCLE_ACTIONS = Object.freeze([
  'lists', 'contacts', 'override', 'viewAs', 'advisor', 'skills', 'files', 'rules', 'recipes', 'admin', 'governance', 'share',
]);
export function alphaActions(actions) {
  return (Array.isArray(actions) ? actions : []).filter((a) => !HIDDEN_CIRCLE_ACTIONS.includes(a?.id));
}
export function isAlphaAction(id) { return !HIDDEN_CIRCLE_ACTIONS.includes(id); }

/**
 * Circle settings: five things stay in view — which features the circle has, where the data lives, the
 * transport, the relay, private chat between members. Everything else (150 strings' worth: decision
 * deadlines and their consequences, who decides, admin consensus, reveal policy, LLM as tool, agents,
 * per-verb capabilities, app settings, wake nudges, recipes, paired devices) sits behind one closed
 * "Geavanceerd" fold. Nothing removed, the same save. Ids: a section name, `axis:<policy axis>`, or
 * `control:<manifest control id>`.
 */
export const ADVANCED_SETTINGS = Object.freeze([
  'recipeApply', 'apps', 'consensus', 'appSettings', 'capabilities', 'pairedDevices',
  'axis:view', 'axis:llmTool', 'axis:storagePosture', 'axis:sharePosture', 'axis:agents', 'axis:revealPolicy',
  'axis:decisionDeadline', 'axis:governanceEnactment',
  'control:wake-nudges',
]);
export function isAdvancedSetting(id) { return ADVANCED_SETTINGS.includes(id); }
