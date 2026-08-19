/**
 * THE AGREEMENT: what a connection is OFFERED equals what it can actually REACH.
 *
 * Two layers hold this fact — the DO menu a person ticks (`connectionOpChoices`) and the kernel skills a
 * peer may invoke (`renderA2A`). When two layers hold one fact and nobody pins the agreement, they drift,
 * and both directions of drift are bad in a specific way:
 *
 *   menu offers what the surface refuses → a person ticks an op, the connection is told it may do it, and
 *     the call is denied at the door. The grant lies.
 *   surface exposes what the menu never showed → an op is reachable that nobody chose to delegate. The
 *     grant is silently wider than the person's intent, which is the failure this whole arc exists to stop.
 *
 * So this reads BOTH and forces whoever changes one to change the other, or to decide on purpose that they
 * differ (CLAUDE.md — "when two layers hold the same fact, pin the AGREEMENT, not either value").
 */
import { describe, it, expect } from 'vitest';
import { renderA2A, NEVER_DELEGABLE } from '@onderling/app-manifest';
import { connectionOpChoices } from '../src/v2/connections.js';
import { paramsManifest } from '../src/v2/paramsManifest.js';
import { householdManifest } from '../../household/manifest.js';
import { mockTasksManifest } from '../src/core/manifests/mockManifests.js';
import { calendarManifest } from '@onderling-app/calendar/manifest';
import { agentsManifest } from '@onderling-app/agents/manifest';

/** The web shell's CONNECTION_MANIFESTS, mirrored here — the shell itself is a DOM module. */
const MANIFESTS = [paramsManifest, householdManifest, mockTasksManifest, calendarManifest, agentsManifest];

describe('the connection surface agrees with the connection menu', () => {
  it('every op the menu offers is reachable over A2A — a ticked op is never refused at the door', () => {
    const offered = connectionOpChoices({ manifests: MANIFESTS }).map((c) => c.opId ?? c.id);
    const reachable = new Set(
      renderA2A(MANIFESTS, { callSkill: async () => ({}) })
        .filter((s) => s.policy !== 'never')
        .map((s) => s.id),
    );
    const promisedButRefused = offered.filter((id) => !reachable.has(id));
    expect(promisedButRefused, 'the menu offers ops the A2A surface refuses').toEqual([]);
  });

  it('every op the surface exposes was offerable — nothing is reachable that nobody could choose', () => {
    const offered = new Set(connectionOpChoices({ manifests: MANIFESTS }).map((c) => c.opId ?? c.id));
    const reachable = renderA2A(MANIFESTS, { callSkill: async () => ({}) })
      .filter((s) => s.policy !== 'never')
      .map((s) => s.id);
    const reachableButUnoffered = reachable.filter((id) => !offered.has(id));
    expect(
      reachableButUnoffered,
      'the A2A surface exposes ops the menu never showed — a grant wider than anyone chose',
    ).toEqual([]);
  });

  it('the escalation family is withheld on BOTH sides, not just one', () => {
    const offered = new Set(connectionOpChoices({ manifests: MANIFESTS }).map((c) => c.opId ?? c.id));
    const byId = new Map(renderA2A(MANIFESTS, { callSkill: async () => ({}) }).map((s) => [s.id, s]));
    for (const id of NEVER_DELEGABLE) {
      expect(offered.has(id), `${id} is offered by the menu`).toBe(false);
      // …and where it exists as a declared op, the surface refuses it outright rather than relying on
      // the menu's discretion. A menu is a convention; `never` is the gate.
      if (byId.has(id)) expect(byId.get(id).policy, `${id} is reachable over A2A`).toBe('never');
    }
  });
});
