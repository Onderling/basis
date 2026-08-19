/**
 * Stoop V1 — Phase 6 tests.
 *
 * Handle validation (pure), and the new profile-management skills:
 * setMyHandle / setMyDisplayName / setPeerReveal / setGroupReveal /
 * getMyProfile.  All compose Phase 1B's MemberMap + Reveals + resolve()
 * — Phase 6 adds no new substrate primitives.
 */

import { describe, it, expect } from 'vitest';
import { AgentIdentity, InternalBus, InternalTransport, DataPart } from '@onderling/core';
import { VaultMemory } from '@onderling/vault';

import { validateHandle, HANDLE_RULES } from '../src/lib/handle.js';
import { createNeighbourhoodAgent } from '../src/index.js';
import { Reveals } from '@onderling/identity-resolver';

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

async function buildAgent({ reveals, members } = {}) {
  const id = await AgentIdentity.generate(new VaultMemory());
  const tx = new InternalTransport(new InternalBus(), id.pubKey);
  const bundle = await createNeighbourhoodAgent({
    identity: id, transport: tx,
    offeringMatch: { group: 'oosterpoort', localActor: ANNE, peers: [] },
    members:  members ?? [{ webid: ANNE }],     // ANNE pre-exists in MemberMap so updates are upserts
    reveals,
  });
  await bundle.offeringMatch.start();
  return bundle;
}

// ── Handle validation ─────────────────────────────────────────────────────

describe('validateHandle — pure rules', () => {
  it('accepts lowercase letters / digits / - / _ within 3..32 chars', () => {
    for (const h of ['anne', 'oosterpoort-bird-23', 'a_b', 'klusclub_handyman_2026']) {
      expect(validateHandle(h)).toEqual({ ok: true, handle: h });
    }
  });

  it('lowercases the input', () => {
    expect(validateHandle('Anne-Van-Dijk')).toEqual({ ok: true, handle: 'anne-van-dijk' });
  });

  it('strips a leading @', () => {
    expect(validateHandle('@anne')).toEqual({ ok: true, handle: 'anne' });
  });

  it('rejects too-short / too-long', () => {
    expect(validateHandle('an')).toEqual({ ok: false, reason: 'too-short' });
    expect(validateHandle('a'.repeat(33))).toEqual({ ok: false, reason: 'too-long' });
  });

  it('rejects whitespace + invalid chars', () => {
    expect(validateHandle('anne dijk').ok).toBe(false);
    expect(validateHandle('anne!').ok).toBe(false);
    expect(validateHandle('anne.dijk').ok).toBe(false);
  });

  it('rejects non-strings', () => {
    expect(validateHandle(undefined)).toEqual({ ok: false, reason: 'not-a-string' });
    expect(validateHandle(123)).toEqual({ ok: false, reason: 'not-a-string' });
  });

  it('exposes the rules constants for UI hints', () => {
    expect(HANDLE_RULES.minLen).toBe(3);
    expect(HANDLE_RULES.maxLen).toBe(32);
    expect(typeof HANDLE_RULES.pattern).toBe('string');
  });
});

// ── setMyHandle / setMyDisplayName ────────────────────────────────────────

describe('Stoop V1 — setMyHandle / setMyDisplayName', () => {
  it('setMyHandle validates + upserts into MemberMap', async () => {
    const bundle = await buildAgent();
    const r = await callSkill(bundle.agent, 'setMyHandle', { handle: 'oosterpoort-bird-23' });
    expect(r.handle).toBe('oosterpoort-bird-23');
    expect(r.member.handle).toBe('oosterpoort-bird-23');
    const found = await bundle.members.resolveByWebid(ANNE);
    expect(found.handle).toBe('oosterpoort-bird-23');
  });

  it('setMyHandle rejects invalid input and does NOT mutate', async () => {
    const bundle = await buildAgent();
    const before = await bundle.members.resolveByWebid(ANNE);
    const r = await callSkill(bundle.agent, 'setMyHandle', { handle: 'an' });
    expect(r.error).toBe('invalid-handle');
    expect(r.reason).toBe('too-short');
    const after = await bundle.members.resolveByWebid(ANNE);
    expect(after.handle).toBe(before.handle ?? null);
  });

  it('setMyDisplayName upserts trimmed displayName', async () => {
    const bundle = await buildAgent();
    const r = await callSkill(bundle.agent, 'setMyDisplayName', { displayName: '  Anne van Dijk  ' });
    expect(r.displayName).toBe('Anne van Dijk');
    expect(r.member.displayName).toBe('Anne van Dijk');
  });

  it('setMyDisplayName rejects empty input', async () => {
    const bundle = await buildAgent();
    const r = await callSkill(bundle.agent, 'setMyDisplayName', { displayName: '   ' });
    expect(r.error).toMatch(/displayName/);
  });
});

// ── Reveal flips ──────────────────────────────────────────────────────────

describe('Stoop V1 — setPeerReveal / setGroupReveal', () => {
  it('setPeerReveal flips the local reveal; resolve() now returns displayName', async () => {
    const reveals = new Reveals();
    const bundle = await buildAgent({
      reveals,
      members: [{ webid: ANNE }, { webid: BOB, handle: 'bob-fix-it', displayName: 'Bob Janssen' }],
    });

    const before = await callSkill(bundle.agent, 'listOpen');
    expect(reveals.decide({ peerWebid: BOB }).showDisplayName).toBe(false);

    const r = await callSkill(bundle.agent, 'setPeerReveal', { peerWebid: BOB });
    expect(r).toMatchObject({ peerWebid: BOB, showDisplayName: true });
    expect(reveals.decide({ peerWebid: BOB }).showDisplayName).toBe(true);
  });

  it('setPeerReveal({showDisplayName: false}) explicitly hides', async () => {
    const reveals = new Reveals();
    reveals.setPeerReveal(BOB, true);
    const bundle = await buildAgent({ reveals });
    await callSkill(bundle.agent, 'setPeerReveal', { peerWebid: BOB, showDisplayName: false });
    expect(reveals.decide({ peerWebid: BOB }).showDisplayName).toBe(false);
  });

  it('setGroupReveal flips the per-group reveal', async () => {
    const reveals = new Reveals();
    const bundle = await buildAgent({ reveals });
    await callSkill(bundle.agent, 'setGroupReveal', { groupId: 'oosterpoort' });
    expect(reveals.decide({ peerWebid: BOB, groupId: 'oosterpoort' }))
      .toEqual({ showDisplayName: true, source: 'group' });
  });

  it('setPeerReveal rejects missing peerWebid', async () => {
    const bundle = await buildAgent({ reveals: new Reveals() });
    const r = await callSkill(bundle.agent, 'setPeerReveal', {});
    expect(r.error).toMatch(/peerWebid/);
  });

  it('reveals is auto-wired by default (Phase 14 fix)', async () => {
    // Without an explicit `reveals: ...` opt, the factory mints a
    // default in-memory Reveals so requestReveal / setPeerReveal
    // work out of the box.  Earlier behaviour was `error: 'no-reveals'`.
    const bundle = await buildAgent();
    const r = await callSkill(bundle.agent, 'setPeerReveal', { peerWebid: BOB });
    expect(r.peerWebid).toBe(BOB);
    expect(r.showDisplayName).toBe(true);
  });
});

// ── getMyProfile ──────────────────────────────────────────────────────────

describe('Stoop V1 — getMyProfile', () => {
  it('returns the calling actor entry + default render in current group', async () => {
    const bundle = await buildAgent();
    await callSkill(bundle.agent, 'setMyHandle',      { handle: 'oosterpoort-bird-23' });
    await callSkill(bundle.agent, 'setMyDisplayName', { displayName: 'Anne van Dijk' });

    const r = await callSkill(bundle.agent, 'getMyProfile');
    expect(r.entry.handle).toBe('oosterpoort-bird-23');
    expect(r.entry.displayName).toBe('Anne van Dijk');
    // Default group view: handle wins (no reveal flipped).
    expect(r.renderForCurrentGroup.render).toBe('@oosterpoort-bird-23');
    expect(r.renderForCurrentGroup.isRevealed).toBe(false);
  });

  it('returns entry: null for unknown actor', async () => {
    const bundle = await buildAgent();
    const r = await callSkill(bundle.agent, 'getMyProfile', undefined, 'https://nobody.example/');
    expect(r.entry).toBeNull();
  });
});
