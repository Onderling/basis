/**
 * WHERE THE APP OPENS — the person's choice, per device: Vandaag (the default: the home), the circles list, or the tab
 * they last used. A device setting in the parameter register (its own kind, user-settable), so both shells read and
 * write the same one and My data shows it. The last-used tab itself is a per-device convenience kept beside the shell
 * (plain storage), not a setting: it changes on every tab switch.
 */
import { param, PARAM_SCOPE, PARAM_KIND } from '@onderling/item-store';

/** The choice: 'vandaag' (default) · 'circles' · 'last'. */
export const START_SCREEN = param({ key: 'home.startScreen', scope: PARAM_SCOPE.DEVICE, kind: PARAM_KIND.USER, default: 'vandaag' });

/** The choices, in the order My data offers them, with their labels. */
export const START_SCREEN_CHOICES = Object.freeze([
  Object.freeze({ value: 'vandaag', labelKey: 'circle.mydata.start_vandaag' }),
  Object.freeze({ value: 'circles', labelKey: 'circle.mydata.start_circles' }),
  Object.freeze({ value: 'last', labelKey: 'circle.mydata.start_last' }),
]);

/** Where a shell keeps the last tab used (plain storage, this device only). */
export const LAST_TAB_STORAGE_KEY = 'cc.lastTab';

const TABS = new Set(['screens', 'circles', 'contacten', 'mij']);

/**
 * The tab the app opens on.
 * @param {string|null|undefined} choice   the setting's value
 * @param {string|null|undefined} lastTab  the last tab used on this device
 * @returns {'screens'|'circles'|'contacten'|'mij'}
 */
export function startTabFor(choice, lastTab) {
  if (choice === 'circles') return 'circles';
  if (choice === 'last' && TABS.has(lastTab)) return lastTab;
  return 'screens';
}
