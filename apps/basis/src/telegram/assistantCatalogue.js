/**
 * The catalogue a door's assistant is handed, scoped to its app list — once, for any door that is not a circle.
 *
 * Scope first, then interpret: every surface of the door (the model's tools, `/help`, a slash command, a button
 * tap) is a projection of this one catalogue, so an app left out here is out of all of them — the model cannot
 * pick what it was never offered. The circle doors already do this per circle (`scopeCatalogueToApps` over the
 * circle's `policy.apps`); a door that is not a circle — the box's Telegram chat — takes its list from the
 * `assistant.apps` parameter (`assistantApps.js`) and scopes through the same `scopeCatalogueToApps`.
 *
 * The manifests come from the one list both painting shells compose from (`manifestSources.js`), with two
 * differences, both on purpose:
 *   · only the apps in the list are MERGED, not merged-then-dropped. Two apps that declare the same op id
 *     (household and tasks both declare `addTask` and `listOpen`) leave the bare id to the first and prefix the
 *     second, so an app that is switched off would otherwise still rename the ops of the apps that are on — and
 *     the gate rules speak the bare names (`listOpen`, `addItem`), so a renamed op is one the gate cannot reach.
 *   · household comes first. This door's gate rules and its conversations so far are household's; with tasks
 *     switched on, tasks' two colliding ops arrive as `tasks/addTask` and `tasks/listOpen` rather than taking
 *     household's names. (The circle doors put tasks first — a circle's items are tasks.)
 */
import { mergeManifests } from '../manifestMerge.js';
import { scopeCatalogueToApps } from '../v2/circleCatalogueScope.js';
import { catalogueManifests, DOOR_MANIFESTS } from '../v2/manifestSources.js';
import { assistantAppsFrom } from '../v2/assistantApps.js';
import { scopeCatalogueToRole, botOffers } from '../v2/botOpMap.js';

/**
 * @param {object} [a]
 * @param {unknown} [a.apps]               the app list (the parameter's value); unset or empty → the default
 * @param {object}  [a.householdManifest]  the household manifest the door's agent carries (`agent.manifest`)
 * @param {boolean} [a.slim]               a household bot: only the ops on the bot's map (`botOpMap.js`)
 * @param {boolean} [a.withoutDoorOps]     a circle the bot joined: the door's own ops (a person's settings, the admin's
 *                                         ops) are not composed — they belong to a person's own door, never a circle
 * @returns {{catalogue: object, manifestsByOrigin: Object<string, object>, apps: string[]}}
 */
export function composeAssistantCatalogue({ apps, householdManifest, slim = false, withoutDoorOps = false } = {}) {
  const list = assistantAppsFrom(apps);
  const all = catalogueManifests({ householdManifest });
  const ordered = [...all.filter((m) => m.app === 'household'), ...all.filter((m) => m.app !== 'household')];
  // The door's own ops (the person's memory mode, their language) come whatever the app list says: they are about
  // the conversation, not an app.
  const doorOwn = withoutDoorOps ? [] : DOOR_MANIFESTS;
  const inScope = [...ordered.filter((m) => list.includes(m.app)), ...doorOwn];
  // A household bot (`slim`) narrows each app to the bot's map BEFORE the merge: a command is prefixed only when two
  // ops the bot offers share it, never for an op it drops (the tasks app's own `/invite` beside the door's).
  const merged = (slim ? inScope.map((m) => ({ ...m, operations: (m.operations ?? []).filter((op) => botOffers(m.app, op, null)) })) : inScope)
    .map((manifest) => ({ manifest }));
  const scoped = scopeCatalogueToApps(mergeManifests(merged), [...list, ...doorOwn.map((m) => m.app)]);
  // A household bot (`slim`): exactly the bot's map (`botOpMap.js`) — nothing else of the apps is composed.
  const catalogue = slim ? scopeCatalogueToRole(scoped, null) : scoped;
  const manifestsByOrigin = Object.fromEntries(inScope.map((m) => [m.app, m]));
  return { catalogue, manifestsByOrigin, apps: list };
}

/**
 * The door's catalogue as it stands, recomposed when its admin switches an app on or off. The shells read it through
 * getters (the runner, the engine, the model's tools), so a switch reaches every surface at once without a restart.
 * @param {object} a
 * @param {() => unknown} a.getApps              the `assistant.apps` parameter's value
 * @param {(list: string[]) => Promise<unknown>} a.setApps  writes the parameter (never the model: slash only, admin only)
 * @param {object} [a.householdManifest]
 */
export function createDoorCatalogue({ getApps, setApps, householdManifest, slim = false, withoutDoorOps = false } = {}) {
  if (typeof getApps !== 'function') throw new TypeError('createDoorCatalogue: getApps is required');
  // no `setApps`: a door whose apps are fixed (a household bot composes its template's) — there is no switch
  let current = composeAssistantCatalogue({ apps: getApps(), householdManifest, slim, withoutDoorOps });
  // The apps a door can offer: every app manifest the shells compose, but the shell's own.
  const available = catalogueManifests({ householdManifest }).map((m) => m.app).filter((a) => a && a !== 'basis');
  return {
    catalogue: () => current.catalogue,
    manifestsByOrigin: () => current.manifestsByOrigin,
    apps: () => [...current.apps],
    available: () => [...available],
    /** @param {string[]} list */
    async setApps(list) {
      if (typeof setApps !== 'function') throw new Error('createDoorCatalogue: this door\'s apps are fixed');
      await setApps(list);
      current = composeAssistantCatalogue({ apps: list, householdManifest, slim, withoutDoorOps });
      return current.apps;
    },
  };
}
