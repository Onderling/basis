/**
 * Every app op declares its visibility in its manifest (`manifestConformance`), and the skill the bundle registers for
 * that op is judged at the same level. Two places hold one fact today — the manifest and the registration call in each
 * app's skill wiring — so this pins their AGREEMENT on a real boot: whoever changes one changes both, or the test says
 * which op drifted. Also: the assistant's own manifest declares a valid tier on every op.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { SkillRegistry, defineSkill } from '@onderling/core';
import { VISIBILITY_TIERS } from '@onderling/app-manifest';
import { bootRealAgentNode, teardown } from './support/pairRealAgents.js';
import { assistantManifest } from '../src/v2/assistantManifest.js';
import agentsManifest from '../../agents/manifest.js';
import basisManifest from '../manifest.js';
import calendarManifest from '../../calendar/manifest.js';
import folioManifest from '../../folio/manifest.js';
import householdManifest from '../../household/manifest.js';
import listsManifest from '../../lists/manifest.js';
import pinboardManifest from '../../pinboard/manifest.js';
import tasksManifest from '../../tasks-v0/manifest.js';

const MANIFESTS = { agents: agentsManifest, basis: basisManifest, calendar: calendarManifest, folio: folioManifest,
  household: householdManifest, lists: listsManifest, pinboard: pinboardManifest, tasks: tasksManifest };

describe('an op is registered at the visibility its manifest declares', () => {
  const registered = new Map();   // op id → Set of the visibilities it was registered with, across every agent
  let node;
  const original = SkillRegistry.prototype.register;
  beforeAll(async () => {
    SkillRegistry.prototype.register = function (skill) {
      if (typeof skill?.visibility === 'string') {
        if (!registered.has(skill.id)) registered.set(skill.id, new Set());
        registered.get(skill.id).add(skill.visibility);
      }
      return original.apply(this, arguments);
    };
    try { node = await bootRealAgentNode('visibility', { taskLane: true }); }
    finally { SkillRegistry.prototype.register = original; }
  }, 60_000);
  afterAll(async () => { await teardown(node); });

  it('the boot registered the apps\' skills (the probe is not empty)', () => {
    expect(registered.size).toBeGreaterThan(200);
  });

  for (const [app, manifest] of Object.entries(MANIFESTS)) {
    it(`${app}: every registered op matches its declared visibility`, () => {
      const drift = [];
      for (const op of manifest.operations) {
        const seen = registered.get(op.id);
        if (!seen) continue;   // not a skill on any agent (reached through the host's dispatch); the door judges it by its declaration
        for (const v of seen) if (v !== op.visibility) drift.push(`${op.id}: declared ${op.visibility}, registered ${v}`);
      }
      expect(drift, drift.join('\n')).toEqual([]);
    });
  }

  // The ops that reveal, move or end the person's keys, devices and grants, or rewire where their traffic goes, are the
  // owner's alone: `private` (self only, whatever tier anyone else holds). Declared, so the host gate judges them by
  // their own record once every app op lives on the host.
  const OWNER_ONLY = {
    household: ['revealOwnerPhrase', 'restoreOwnerPhrase', 'exportRecoveryFile', 'importRecoveryFile', 'revokeDevice',
      'replaceDevice', 'enrollDevice', 'buildEnrollOffer', 'grantCompanion', 'revokeCompanionGrant', 'grantSurface',
      'revokeSurface'],
    // `settings` writes the relay endpoint among the device's controls
    basis: ['rotate-identity', 'debug-dump', 'audit-tail', 'set-relay', 'settings'],
    pinboard: ['restoreFromMnemonicWizard', 'encryptedBackupWizard'],
  };
  for (const [app, ids] of Object.entries(OWNER_ONLY)) {
    it(`${app}: the owner's custody and wiring ops are declared private`, () => {
      const declared = Object.fromEntries(MANIFESTS[app].operations.map((op) => [op.id, op.visibility]));
      const wrong = ids.filter((id) => declared[id] !== 'private').map((id) => `${id}: ${declared[id] ?? 'not declared'}`);
      expect(wrong).toEqual([]);
    });
  }

  it('the assistant\'s manifest declares one of the four tiers on every op', () => {
    const bad = assistantManifest.operations.filter((op) => !VISIBILITY_TIERS.includes(op.visibility)).map((op) => op.id);
    expect(bad).toEqual([]);
  });

  // The manifest's tiers and the kernel gate's are one list held in two packages: pin that they agree.
  it('the manifest tiers are exactly the tiers the kernel accepts for a skill', () => {
    for (const tier of VISIBILITY_TIERS) expect(() => defineSkill('probe', async () => [], { visibility: tier })).not.toThrow();
    expect(() => defineSkill('probe', async () => [], { visibility: 'owner' })).toThrow(/unknown visibility tier/);
  });
});
