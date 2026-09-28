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

/**
 * @param {object} [a]
 * @param {unknown} [a.apps]               the app list (the parameter's value); unset or empty → the default
 * @param {object}  [a.householdManifest]  the household manifest the door's agent carries (`agent.manifest`)
 * @returns {{catalogue: object, manifestsByOrigin: Object<string, object>, apps: string[]}}
 */
export function composeAssistantCatalogue({ apps, householdManifest } = {}) {
  const list = assistantAppsFrom(apps);
  const all = catalogueManifests({ householdManifest });
  const ordered = [...all.filter((m) => m.app === 'household'), ...all.filter((m) => m.app !== 'household')];
  // The door's own ops (the person's memory mode, their language) come whatever the app list says: they are about
  // the conversation, not an app.
  const inScope = [...ordered.filter((m) => list.includes(m.app)), ...DOOR_MANIFESTS];
  const catalogue = scopeCatalogueToApps(mergeManifests(inScope.map((manifest) => ({ manifest }))), [...list, ...DOOR_MANIFESTS.map((m) => m.app)]);
  const manifestsByOrigin = Object.fromEntries(inScope.map((m) => [m.app, m]));
  return { catalogue, manifestsByOrigin, apps: list };
}
