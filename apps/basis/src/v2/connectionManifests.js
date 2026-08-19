/**
 * connectionManifests — the ONE list of what a connection can be granted, and reach.
 *
 * Three readers hold this fact and all three must agree:
 *   1. the DO menu a person ticks           (`connectionOpChoices`)
 *   2. the ops actually reachable over A2A  (`renderA2A` → `a2aManifests`)
 *   3. both shells, which must offer the same thing (invariant 2, web ≡ mobile)
 *
 * (3) had already broken before this module existed. The web shell listed five manifests; the mobile
 * shell reused its full dispatch catalog — a different seven, including stoop, whose manifest now
 * declares 92 ops. So the same person pairing the same screen was offered a materially different set
 * depending on which shell they paired from, and after the A2A surface landed that difference would
 * have become a difference in what a peer could actually invoke. Not a paint bug.
 *
 * The list is deliberately NARROWER than the dispatch catalog. A connection is a thing acting as you
 * somewhere else, so the default answer to "may it do this?" is no, and each entry here is a decision
 * that a whole app's ops are reasonable to delegate at all. Widening it is a product call, not a
 * refactor — which is why it lives in one named place instead of being implied by whatever a shell
 * happened to import.
 *
 * What must NEVER be delegated is a separate question with a separate answer: `NEVER_DELEGABLE` in
 * `@onderling/app-manifest`, enforced at the door as `policy: 'never'` rather than by omission here.
 */
import { paramsManifest } from './paramsManifest.js';
import { householdManifest } from '../../../household/manifest.js';
import { mockTasksManifest } from '../core/manifests/mockManifests.js';
import { calendarManifest } from '@onderling-app/calendar/manifest';
import { agentsManifest } from '@onderling-app/agents/manifest';

/**
 * @param {object} [a]
 * @param {object} [a.householdManifest] — override (mobile injects one at boot; defaults to the real one)
 * @returns {object[]} the manifests a connection may be granted from, in a stable order
 */
export function connectionManifests({ householdManifest: injected } = {}) {
  return [
    // device preferences — the smallest useful grant, and the one a half-trusted screen wants most
    paramsManifest,
    injected ?? householdManifest,
    mockTasksManifest,
    calendarManifest,
    // agents LAST, matching both shells' catalog order so a future op-id collision resolves the same way
    agentsManifest,
  ].filter(Boolean);
}

/** The default list, for callers with no override to inject. */
export const CONNECTION_MANIFESTS = connectionManifests();
