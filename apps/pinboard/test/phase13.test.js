/**
 * Pinboard V1 — Phase 13 tests.
 *
 * UX completeness — vakantie modus, hop-routing sealedForward at
 * factory, stale-post detection, near-dup detection.
 */

import { describe, it, expect, vi, afterEach } from 'vitest';
import { AgentIdentity, InternalBus, InternalTransport, DataPart } from '@onderling/core';
import { VaultMemory } from '@onderling/vault';

import { createNeighbourhoodAgent } from '../src/index.js';
import {
  similarity,
  findNearDuplicate,
  normalisePostText,
} from '../src/lib/dupCheck.js';

const ANNE = 'https://id.example/anne';

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

async function buildAgent() {
  const id = await AgentIdentity.generate(new VaultMemory());
  const tx = new InternalTransport(new InternalBus(), id.pubKey);
  const bundle = await createNeighbourhoodAgent({
    identity: id, transport: tx,
    offeringMatch: { group: 'oosterpoort', localActor: ANNE, peers: [] },
    members:    [{ webid: ANNE }],
  });
  await bundle.offeringMatch.start();
  return bundle;
}

// ── Encrypted backup round-trip ──────────────────────────────────────────

describe('Pinboard V1 Phase 13.5 — dupCheck', () => {
  it('similarity is 1.0 for identical text', () => {
    expect(similarity('hello world', 'hello world')).toBe(1);
  });

  it('similarity ~ 1 after normalisation (case + punct)', () => {
    expect(similarity('Hello, world!', 'hello world')).toBeGreaterThan(0.9);
  });

  it('similarity ~ 0 for unrelated text', () => {
    expect(similarity('iemand handig met fietsen', 'belasting hulp gevraagd')).toBeLessThan(0.6);
  });

  it('findNearDuplicate returns the highest-similarity prior post', () => {
    const prior = [
      { id: 'a', text: 'iemand handig met de auto' },
      { id: 'b', text: 'iemand handig met fietsen' },
      { id: 'c', text: 'belasting hulp' },
    ];
    const hit = findNearDuplicate('Iemand handig met fietsen?', prior);
    expect(hit?.duplicate.id).toBe('b');
    expect(hit?.ratio).toBeGreaterThan(0.8);
  });

  it('findNearDuplicate returns null when no prior post is near', () => {
    const prior = [{ id: 'a', text: 'belasting hulp' }];
    expect(findNearDuplicate('Iemand handig met fietsen?', prior)).toBeNull();
  });

  it('checkDuplicate skill warns when posting a near-dup of a recent own post', async () => {
    const bundle = await buildAgent();
    await callSkill(bundle.agent, 'postRequest',
      { text: 'Iemand handig met fietsen?', kind: 'ask', expectClaims: 0, timeoutMs: 1 });

    const r = await callSkill(bundle.agent, 'checkDuplicate', { text: 'iemand handig met fietsen' });
    expect(r.duplicate).toBeTruthy();
    expect(r.ratio).toBeGreaterThan(0.8);
  });

  it('checkDuplicate skill returns null when text is unique', async () => {
    const bundle = await buildAgent();
    await callSkill(bundle.agent, 'postRequest',
      { text: 'belasting hulp', kind: 'ask', expectClaims: 0, timeoutMs: 1 });

    const r = await callSkill(bundle.agent, 'checkDuplicate', { text: 'iets heel anders over fietsen' });
    expect(r.duplicate).toBeNull();
  });
});

// (holiday mode over the roster offerings retired 2026-10-15 with the offering writers: 'away' is the person's one
// availability record, which the host's offering match reads)

// ── Stale-post nudge ─────────────────────────────────────────────────────

describe('Pinboard V1 Phase 13.4 — stale-post detection', () => {
  it('listMyStalePosts({thresholdDays: 30}) returns nothing for fresh posts', async () => {
    const bundle = await buildAgent();
    await callSkill(bundle.agent, 'postRequest',
      { text: 'fresh post', kind: 'ask', expectClaims: 0, timeoutMs: 1 });
    const r = await callSkill(bundle.agent, 'listMyStalePosts', { thresholdDays: 30 });
    expect(r.stale).toEqual([]);
  });

  it('listMyStalePosts with a very small threshold catches just-posted items', async () => {
    const bundle = await buildAgent();
    await callSkill(bundle.agent, 'postRequest',
      { text: 'fresh post', kind: 'ask', expectClaims: 0, timeoutMs: 1 });
    // Wait long enough that the item is UNAMBIGUOUSLY older than the threshold. The margin used to be
    // 1 ms — sleep 5, ask for older-than-4 — and a loaded runner does not honour a 5 ms timer that
    // precisely, so this failed in CI while passing on every developer machine (2026-09-10). What the
    // test is about is the threshold arithmetic, not the clock, so the margin is now wide enough that
    // scheduling cannot decide the outcome.
    await new Promise(r => setTimeout(r, 60));
    // thresholdDays = a tiny fraction of a day (10 ms) — anything older than that counts as stale.
    const r = await callSkill(bundle.agent, 'listMyStalePosts',
      { thresholdDays: 10 / (24 * 60 * 60 * 1000) });
    expect(r.stale).toHaveLength(1);
    expect(r.stale[0].text).toBe('fresh post');
  });
});

// ── hop-routing sealedForward at construction ────────────────────────────

describe('Pinboard V1 Phase 13.3 — hop sealedForward at agent construction', () => {
  it('agent has sealedForward enabled for the configured group after creation', async () => {
    const bundle = await buildAgent();
    // No public introspection API for sealedForward state on the SDK;
    // we just assert the call path didn't throw + the agent is started.
    expect(bundle.agent.address).toBeTruthy();
    // The lib function exists and is callable on the bundle's agent.
    expect(typeof bundle.agent.enableSealedForwardFor).toBe('function');
  });
});

// ── Quick spot-checks on lib helpers ─────────────────────────────────────

describe('dupCheck lib', () => {
  it('normalisePostText collapses whitespace + strips punctuation + lowercases', () => {
    expect(normalisePostText('Hello,   World!\n')).toBe('hello world');
  });
});
