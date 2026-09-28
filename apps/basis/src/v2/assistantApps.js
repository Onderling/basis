/**
 * assistantApps — which apps a door's assistant may act in, as a parameter.
 *
 * The model picks its tool from the catalogue it is handed, so the catalogue is where "this bot does
 * household and lists, not tasks" is decided — before the model sees anything, not after it has picked.
 * A circle door takes the list from the circle's policy (`policy.apps`); a door that is not a circle (the
 * box's Telegram chat) takes it from this parameter.
 *
 * Device scope: the list belongs to the door on this device (one box's bot may offer tasks and another's
 * not), never to the person's other devices. `kind: user`, so it is settable through `set-param` — by the
 * owner, never by the model.
 */
import { param, PARAM_SCOPE, PARAM_KIND } from '@onderling/item-store';

export const ASSISTANT_APPS_PARAM_KEY = 'assistant.apps';

/** The default: the household lists and the composable lists. */
export const ASSISTANT_APPS = param({ key: 'assistant.apps', scope: PARAM_SCOPE.DEVICE, kind: PARAM_KIND.USER, default: Object.freeze(['household', 'lists']) });

/**
 * A stored value as an app list: an array of app names, de-duplicated. Anything else (unset, empty, a stray
 * string) is the default — an empty list would leave a bot that can do nothing and says nothing about why.
 * @param {unknown} value
 * @returns {string[]}
 */
export function assistantAppsFrom(value) {
  const apps = Array.isArray(value) ? [...new Set(value.filter((a) => typeof a === 'string' && a.trim()).map((a) => a.trim()))] : [];
  return apps.length ? apps : [...ASSISTANT_APPS];
}
