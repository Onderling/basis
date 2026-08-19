/**
 * Stoop V1 — Phase 10 tests (closed-beta hardening).
 *
 * exportMyData snapshot, leaveGroup audit + optional self-deletion,
 * and the new ITEM_TYPES constants source-of-truth.
 */

import { describe, it, expect } from 'vitest';
import { AgentIdentity, InternalBus, InternalTransport } from '@onderling/core';
import { VaultMemory } from '@onderling/vault';

import { createNeighborhoodAgent } from '../src/index.js';
import { ITEM_TYPES, NOTICEBOARD_KINDS } from '../src/lib/itemTypes.js';
import { callSkill } from './util.js';

const ANNE = 'https://id.example/anne';
const BOB  = 'https://id.example/bob';

async function buildAgent() {
  const id = await AgentIdentity.generate(new VaultMemory());
  const tx = new InternalTransport(new InternalBus(), id.pubKey);
  const bundle = await createNeighborhoodAgent({
    identity: id, transport: tx,
    offeringMatch: { group: 'oosterpoort', localActor: ANNE, peers: [] },
    members:    [{ webid: ANNE }, { webid: BOB }],
  });
  await bundle.offeringMatch.start();
  return bundle;
}

describe('Stoop V1 — exportMyData', () => {
  it('returns webid + member entry + own items', async () => {
    const bundle = await buildAgent();
    await callSkill(bundle.agent, 'setMyHandle',      { handle: 'anne' }, ANNE);
    await callSkill(bundle.agent, 'setMyDisplayName', { displayName: 'Anne' }, ANNE);

    const r1 = await callSkill(bundle.agent, 'postRequest',
      { text: 'paint', kind: 'ask', expectClaims: 0, timeoutMs: 1 }, ANNE);
    const r2 = await callSkill(bundle.agent, 'postRequest',
      { text: 'aanhanger', kind: 'lend', dueAt: Date.now() + 86_400_000, expectClaims: 0, timeoutMs: 1 }, ANNE);

    const exp = await callSkill(bundle.agent, 'exportMyData', undefined, ANNE);
    expect(exp.webid).toBe(ANNE);
    expect(exp.member.handle).toBe('anne');
    expect(exp.member.displayName).toBe('Anne');
    expect(exp.items.map(i => i.id).sort()).toEqual([r1.requestId, r2.requestId].sort());
    expect(exp.exportedAt).toBeGreaterThan(0);
  });

  it('does not include other members\' items', async () => {
    const bundle = await buildAgent();
    await callSkill(bundle.agent, 'postRequest',
      { text: 'mine', kind: 'ask', expectClaims: 0, timeoutMs: 1 }, ANNE);
    await callSkill(bundle.agent, 'postRequest',
      { text: 'theirs', kind: 'ask', expectClaims: 0, timeoutMs: 1 }, BOB);

    const exp = await callSkill(bundle.agent, 'exportMyData', undefined, ANNE);
    expect(exp.items.map(i => i.text)).toEqual(['mine']);
  });
});

describe('Stoop V1 — leaveGroup', () => {
  it('records a kind:"group-leave" marker (no deletion by default)', async () => {
    const bundle = await buildAgent();
    await callSkill(bundle.agent, 'postRequest',
      { text: 'paint', kind: 'ask', expectClaims: 0, timeoutMs: 1 }, ANNE);

    const r = await callSkill(bundle.agent, 'leaveGroup', { groupId: 'oosterpoort' }, ANNE);
    expect(r.leaveMarkerId).toBeTruthy();
    expect(r.deletedItems).toBe(0);

    const marker = await bundle.itemStore.getById(r.leaveMarkerId);
    expect(marker.type).toBe(ITEM_TYPES.GROUP_LEAVE);
    expect(marker.source.groupId).toBe('oosterpoort');
    expect(marker.source.leftBy).toBe(ANNE);

    // The original ask is still there.
    const open = await callSkill(bundle.agent, 'listOpen', { kind: 'ask' }, ANNE);
    expect(open.items.some(i => i.text === 'paint')).toBe(true);
  });

  it('deletePosts: true removes the actor\'s own items', async () => {
    const bundle = await buildAgent();
    await callSkill(bundle.agent, 'postRequest',
      { text: 'mine-1', kind: 'ask', expectClaims: 0, timeoutMs: 1 }, ANNE);
    await callSkill(bundle.agent, 'postRequest',
      { text: 'mine-2', kind: 'offer', expectClaims: 0, timeoutMs: 1 }, ANNE);
    await callSkill(bundle.agent, 'postRequest',
      { text: 'theirs', kind: 'ask', expectClaims: 0, timeoutMs: 1 }, BOB);

    const r = await callSkill(bundle.agent, 'leaveGroup', { groupId: 'oosterpoort', deletePosts: true }, ANNE);
    expect(r.deletedItems).toBe(2);

    const open = await callSkill(bundle.agent, 'listOpen', undefined, ANNE);
    const texts = open.items.map(i => i.text);
    expect(texts).not.toContain('mine-1');
    expect(texts).not.toContain('mine-2');
    expect(texts).toContain('theirs');     // other members untouched
  });

  it('rejects missing groupId', async () => {
    const bundle = await buildAgent();
    expect(await callSkill(bundle.agent, 'leaveGroup', {}, ANNE)).toEqual({ error: 'groupId required' });
  });
});

describe('Stoop V1 — ITEM_TYPES constants', () => {
  it('exposes the V1 vocabulary', () => {
    expect(ITEM_TYPES.ASK).toBe('ask');
    expect(ITEM_TYPES.OFFER).toBe('offer');
    expect(ITEM_TYPES.LEND).toBe('lend');
    expect(ITEM_TYPES.REPORT).toBe('report');
    expect(ITEM_TYPES.GROUP_RULES).toBe('group-rules');
    expect(ITEM_TYPES.RULES_ACCEPT).toBe('rules-accept');
    expect(ITEM_TYPES.GROUP_LEAVE).toBe('group-leave');
  });

  it('NOTICEBOARD_KINDS lists the three user-facing kinds', () => {
    expect(NOTICEBOARD_KINDS).toEqual(['ask', 'offer', 'lend']);
  });
});
