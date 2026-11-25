/**
 * THE ASSISTANT PANEL'S TWO TABS — the one model both shells paint (web `vandaagPlus.js`, mobile `VandaagPlusModal.js`).
 *
 * The "+" opens a floating panel titled Assistant, with two parts over the "+" sheet's declared sections
 * (`screenSections.js` plusSheet): Gesprek, the conversation with the person's own assistant (its thread and its line),
 * and Maken, what the person can make (what they pinned and their own acts, each opening the form it opens). A test
 * pins that every declared section sits in exactly one tab.
 *
 * Which tab shows: the one the person last chose, Gesprek the first time. An open form (picked, filled by a line, or an
 * own row opened to change it) shows on Maken, where the form is painted; when it closes, the chosen tab shows again.
 * Only a tap on a tab is a choice (and is remembered on the device: a view setting, `storageName('assistantTab')`).
 */

export const ASSISTANT_TABS = Object.freeze([
  Object.freeze({ id: 'gesprek', labelKey: 'circle.assistant.tab_conversation', sections: Object.freeze(['plus-thread', 'plus-line']) }),
  Object.freeze({ id: 'maken', labelKey: 'circle.assistant.tab_make', sections: Object.freeze(['plus-pinned', 'plus-own']) }),
]);

const DEFAULT_TAB = 'gesprek';

/** The section ids a tab shows, in their declared order. */
export function assistantSectionsOf(tabId) {
  return [...(ASSISTANT_TABS.find((x) => x.id === tabId)?.sections ?? [])];
}

/**
 * The tab to show now.
 * @param {{chosen?: string|null, actId?: string|null, editing?: boolean}} [o]
 *   `chosen`  — the tab the person last tapped (remembered on the device); unknown or absent → Gesprek
 *   `actId`   — a form is open (an act picked, or filled by a line)
 *   `editing` — opened on an own row to change it
 */
export function assistantTabFor({ chosen = null, actId = null, editing = false } = {}) {
  if (actId || editing) return 'maken';
  return ASSISTANT_TABS.some((x) => x.id === chosen) ? chosen : DEFAULT_TAB;
}
