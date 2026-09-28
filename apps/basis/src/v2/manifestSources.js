/**
 * manifestSources — the ONE list of manifests the app runs.
 *
 * Two sets, both declared here and nowhere else:
 *
 *   • the CATALOGUE — the app manifests both shells merge into their dispatch catalogue and key by origin
 *     (`manifestsByOrigin`). ORDER MATTERS: an op id two apps both declare resolves to the earlier one, so
 *     tasks comes before household (a circle's items are tasks — `addTask` must not land as a household
 *     chore, which is how "@assistant add X" once went to the wrong place), and agents comes last (any future
 *     collision resolves to the established app). The web and mobile shells each held their own copy of
 *     this list with a comment asking them to stay in the same order; they read this one now.
 *   • the PLUMBING — cross-cutting manifests that are composed elsewhere than the catalogue: the parameter
 *     register's ops (routed on the waist's `params` branch, offered to connections) and the device-log
 *     lanes, whose declared `appends` are what each lane's rail derives its allowed kinds from.
 *
 * Readers: both shells' catalogue composition, the surface-coverage snapshot, and the guard
 * `lint-manifest-scopes` — so "a manifest the app runs" and "a manifest the guard checks" are the same set
 * by construction, not by a glob that misses the ones declared outside `apps/<app>/manifest.js`.
 */
import { basisManifest } from '../../manifest.js';
import { mockTasksManifest, mockStoopManifest, mockFolioManifest } from '../core/manifests/mockManifests.js';
import { householdManifest } from '../../../household/manifest.js';
import { calendarManifest } from '../../../calendar/manifest.js';
import { listsManifest } from '../../../lists/manifest.js';
import { agentsManifest } from '../../../agents/manifest.js';
import { paramsManifest } from './paramsManifest.js';
import { governanceManifest } from './governanceManifest.js';
import { membershipManifest } from './membershipManifest.js';
import { keyManifest } from './keyManifest.js';
import { grantsManifest } from './grantsManifest.js';
import { taskManifest } from './taskManifest.js';
import { chatManifest } from './chatManifest.js';

/**
 * The catalogue manifests, in dispatch order.
 * @param {object} [a]
 * @param {object} [a.householdManifest] — the household manifest instance the shell's agent carries (web hands
 *   `agent.manifest`, mobile may inject one at boot); defaults to the real one
 * @returns {object[]}
 */
export function catalogueManifests({ householdManifest: injected } = {}) {
  return [
    basisManifest,
    mockTasksManifest,
    injected ?? householdManifest,
    mockStoopManifest,
    mockFolioManifest,
    calendarManifest,
    listsManifest,
    agentsManifest,
  ];
}

/** The plumbing manifests: the parameter register, then the device-log lanes. */
export const PLUMBING_MANIFESTS = Object.freeze([
  paramsManifest,
  governanceManifest,
  membershipManifest,
  keyManifest,
  grantsManifest,
  taskManifest,
  chatManifest,
]);

/** Every manifest the app runs — the set the manifest guards read. */
export function allManifests() {
  return [...catalogueManifests(), ...PLUMBING_MANIFESTS];
}
