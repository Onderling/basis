/**
 * Stoop V1 — Phase 7 (onboarding) tests.
 *
 * Covers the create-group wizard's persistence + retrieval + acceptance,
 * the privacy-notice + data-location skills, and the onboarding-state
 * status report.  No new substrate primitives — everything composes
 * existing item-store + MemberMap + Phase-1B identity-resolver.
 */

import { describe, it, expect } from 'vitest';
import { AgentIdentity, InternalBus, InternalTransport, DataPart } from '@onderling/core';
import { VaultMemory } from '@onderling/vault';

import { createNeighborhoodAgent } from '../src/index.js';

const ANNE = 'https://id.example/anne';
const BOB  = 'https://id.example/bob';

async function callSkill(agent, skillId, args, fromWebid = ANNE) {
  const def = agent.skills.get(skillId);
  if (!def) throw new Error(`callSkill: no such skill: ${skillId}`);
  return def.handler({
    parts:    args === undefined ? [] : [DataPart(args)],
    from:     fromWebid,
    agent,
    envelope: null,
  });
}

async function buildAgent({ dataLocationConfig } = {}) {
  const id = await AgentIdentity.generate(new VaultMemory());
  const tx = new InternalTransport(new InternalBus(), id.pubKey);
  const bundle = await createNeighborhoodAgent({
    identity: id, transport: tx,
    offeringMatch: { group: 'oosterpoort', localActor: ANNE, peers: [] },
    members:   [{ webid: ANNE }],
    dataLocationConfig,
  });
  await bundle.offeringMatch.start();
  return bundle;
}

// ── createGroupWithRules + getGroupRules + acceptGroupRules ───────────────

describe('Stoop V1 — group governance wizard', () => {
  it('createGroupWithRules persists; getGroupRules returns the latest', async () => {
    const bundle = await buildAgent();

    const r = await callSkill(bundle.agent, 'createGroupWithRules', {
      groupId: 'oosterpoort-skills',
      name:    'Oosterpoort skills',
      rules: {
        purpose:        'Neighbours die elkaar willen helpen.',
        admins:         [ANNE],
        houseRules:     ['Geen reclame', 'Geen politiek'],
        conflictPolicy: 'mediation',
        accessPolicy:   'invite-only',
        leavePolicy:    'keep-posts',
      },
    });
    expect(r.rulesId).toBeTruthy();
    expect(r.groupId).toBe('oosterpoort-skills');

    const fetched = await callSkill(bundle.agent, 'getGroupRules', { groupId: 'oosterpoort-skills' });
    expect(fetched.rules.text).toBe('Oosterpoort skills');
    expect(fetched.rules.source.rules.conflictPolicy).toBe('mediation');
    expect(fetched.rules.source.rules.admins).toEqual([ANNE]);
  });

  it('getGroupRules returns null when no rules exist', async () => {
    const bundle = await buildAgent();
    const r = await callSkill(bundle.agent, 'getGroupRules', { groupId: 'unknown' });
    expect(r.rules).toBeNull();
  });

  it('latest-rules-win when called multiple times for the same group', async () => {
    const bundle = await buildAgent();
    await callSkill(bundle.agent, 'createGroupWithRules', {
      groupId: 'g', name: 'v1', rules: { version: 1, conflictPolicy: 'admin' },
    });
    // Force a millisecond gap so the two ULIDs / addedAt timestamps
    // are unambiguously ordered.  Real users won't update rules
    // twice within the same ms; the test must avoid the race too.
    await new Promise(r => setTimeout(r, 5));
    await callSkill(bundle.agent, 'createGroupWithRules', {
      groupId: 'g', name: 'v2', rules: { version: 2, conflictPolicy: 'vote' },
    });
    const fetched = await callSkill(bundle.agent, 'getGroupRules', { groupId: 'g' });
    expect(fetched.rules.text).toBe('v2');
    expect(fetched.rules.source.rules.conflictPolicy).toBe('vote');
  });

  it('acceptGroupRules records an audit item; onboardingState reflects it', async () => {
    const bundle = await buildAgent();

    let state = await callSkill(bundle.agent, 'getOnboardingState');
    expect(state.groupsAccepted).toEqual([]);

    const r = await callSkill(bundle.agent, 'acceptGroupRules', { groupId: 'oosterpoort' });
    expect(r.acceptanceId).toBeTruthy();

    state = await callSkill(bundle.agent, 'getOnboardingState');
    expect(state.groupsAccepted).toContain('oosterpoort');
  });

  it('rejects missing args', async () => {
    const bundle = await buildAgent();
    expect(await callSkill(bundle.agent, 'createGroupWithRules', { name: 'x', rules: {} })).toEqual({ error: 'groupId required' });
    expect(await callSkill(bundle.agent, 'createGroupWithRules', { groupId: 'g', rules: {} })).toEqual({ error: 'name required' });
    expect(await callSkill(bundle.agent, 'getGroupRules',     {})).toEqual({ error: 'groupId required' });
    expect(await callSkill(bundle.agent, 'acceptGroupRules',  {})).toEqual({ error: 'groupId required' });
  });
});

// ── getOnboardingState ────────────────────────────────────────────────────

describe('Stoop V1 — getOnboardingState', () => {
  it('reports handle/displayName/groupsAccepted truthfully', async () => {
    const bundle = await buildAgent();

    let state = await callSkill(bundle.agent, 'getOnboardingState');
    expect(state.handleSet).toBe(false);
    expect(state.displayNameSet).toBe(false);
    expect(state.groupsAccepted).toEqual([]);
    expect(state.currentGroupId).toBe('oosterpoort');

    await callSkill(bundle.agent, 'setMyHandle',      { handle: 'anne' });
    await callSkill(bundle.agent, 'setMyDisplayName', { displayName: 'Anne' });
    await callSkill(bundle.agent, 'acceptGroupRules', { groupId: 'oosterpoort' });

    state = await callSkill(bundle.agent, 'getOnboardingState');
    expect(state.handleSet).toBe(true);
    expect(state.displayNameSet).toBe(true);
    expect(state.groupsAccepted).toEqual(['oosterpoort']);
  });
});

// ── getDataLocation + getPrivacyNotice + markMnemonicShown ─────────────────

describe('Stoop V1 — privacy / data-location / mnemonic', () => {
  it('getDataLocation returns the configured values', async () => {
    const bundle = await buildAgent({
      dataLocationConfig: {
        relayOperator: 'the author',
        relayUrl:      'wss://relay.example',
        podIssuer:     'https://login.inrupt.com',
        podRoot:       'https://storage.inrupt.com/anne/',
      },
    });
    const r = await callSkill(bundle.agent, 'getDataLocation');
    expect(r.relayOperator).toBe('the author');
    expect(r.relayUrl).toBe('wss://relay.example');
    expect(r.podIssuer).toBe('https://login.inrupt.com');
    expect(r.podRoot).toBe('https://storage.inrupt.com/anne/');
  });

  it('getDataLocation returns null fields when not configured', async () => {
    const bundle = await buildAgent();
    const r = await callSkill(bundle.agent, 'getDataLocation');
    expect(r).toEqual({ relayOperator: null, relayUrl: null, podIssuer: null, podRoot: null });
  });

  it('getPrivacyNotice returns the NL notice by default with seven sections', async () => {
    const bundle = await buildAgent();
    const r = await callSkill(bundle.agent, 'getPrivacyNotice');
    expect(r.lang).toBe('nl');
    expect(r.sections).toHaveLength(7);
    expect(r.sections[0].heading).toMatch(/versleuteld/i);
  });

  it('getPrivacyNotice supports lang switch + falls back to en for unknown', async () => {
    const bundle = await buildAgent();
    const en = await callSkill(bundle.agent, 'getPrivacyNotice', { lang: 'en' });
    expect(en.sections[0].heading).toMatch(/encrypted/i);
    const fb = await callSkill(bundle.agent, 'getPrivacyNotice', { lang: 'unknown' });
    expect(fb.sections[0].heading).toMatch(/encrypted/i);   // fallback
  });

  it('markMnemonicShown writes a flag onto the MemberMap entry', async () => {
    const bundle = await buildAgent();
    await callSkill(bundle.agent, 'markMnemonicShown');
    const me = await bundle.members.resolveByWebid(ANNE);
    expect(me.externalIds.mnemonicShown).toBe('true');
  });
});
