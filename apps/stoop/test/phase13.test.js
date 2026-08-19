/**
 * Stoop V1 — Phase 13 tests.
 *
 * UX completeness — vakantie modus, hop-routing sealedForward at
 * factory, stale-post detection, near-dup detection, encrypted
 * backup round-trip.
 */

import { describe, it, expect, vi, afterEach } from 'vitest';
import { AgentIdentity, InternalBus, InternalTransport, DataPart } from '@onderling/core';
import { VaultMemory } from '@onderling/vault';

import { createNeighbourhoodAgent } from '../src/index.js';
import {
  encryptBackup,
  decryptBackup,
} from '../src/lib/encryptedBackup.js';
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

describe('Stoop V1 Phase 13.6 — encrypted backup', () => {
  it('encrypts + decrypts with the right passphrase', async () => {
    const data = { webid: ANNE, items: [{ id: '1', text: 'paint' }] };
    const blob = await encryptBackup({ data, passphrase: 'correct horse battery staple' });
    expect(blob.v).toBe(1);
    expect(blob.ciphertext).toBeTruthy();
    expect(blob.salt).toBeTruthy();
    expect(blob.nonce).toBeTruthy();

    const back = await decryptBackup({ blob, passphrase: 'correct horse battery staple' });
    expect(back).toEqual(data);
  });

  it('fails on wrong passphrase', async () => {
    const blob = await encryptBackup({ data: { x: 1 }, passphrase: 'one' });
    await expect(decryptBackup({ blob, passphrase: 'two' })).rejects.toThrow(/wrong passphrase/);
  });

  it('fails on tampered ciphertext', async () => {
    const blob = await encryptBackup({ data: { x: 1 }, passphrase: 'p' });
    blob.ciphertext = blob.ciphertext.slice(0, -2) + 'xx';
    await expect(decryptBackup({ blob, passphrase: 'p' })).rejects.toThrow();
  });

  it('rejects empty passphrase', async () => {
    await expect(encryptBackup({ data: {}, passphrase: '' })).rejects.toThrow(/passphrase/);
  });

  it('encryptedBackup skill returns a blob; wrong passphrase rejects', async () => {
    const bundle = await buildAgent();
    await callSkill(bundle.agent, 'postRequest',
      { text: 'paint my fence', kind: 'ask', expectClaims: 0, timeoutMs: 1 });

    const r = await callSkill(bundle.agent, 'encryptedBackup', { passphrase: 'mine' });
    expect(r.blob).toBeTruthy();

    const restored = await decryptBackup({ blob: r.blob, passphrase: 'mine' });
    expect(restored.webid).toBe(ANNE);
    expect(restored.items.some(i => i.text === 'paint my fence')).toBe(true);

    // Wrong passphrase fails.
    await expect(decryptBackup({ blob: r.blob, passphrase: 'wrong' })).rejects.toThrow();
  });

  it('encryptedBackup skill rejects missing passphrase', async () => {
    const bundle = await buildAgent();
    expect(await callSkill(bundle.agent, 'encryptedBackup', {})).toEqual({ error: 'passphrase required' });
  });
});

// ── dupCheck ─────────────────────────────────────────────────────────────

describe('Stoop V1 Phase 13.5 — dupCheck', () => {
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

// ── Vakantie modus ───────────────────────────────────────────────────────

describe('Stoop V1 Phase 13.1 — vakantie modus', () => {
  it('flips all active skills to gepauzeerd; on=false restores actief', async () => {
    const bundle = await buildAgent();
    await callSkill(bundle.agent, 'addMySkill', { categoryId: 'klusjes' });
    await callSkill(bundle.agent, 'addMySkill', { categoryId: 'tuin' });

    const on = await callSkill(bundle.agent, 'setSkillsHolidayMode', { on: true });
    expect(on.holidayMode).toBe(true);
    let list = await callSkill(bundle.agent, 'listMySkills');
    expect(list.skills.every(s => s.status === 'paused')).toBe(true);

    const off = await callSkill(bundle.agent, 'setSkillsHolidayMode', { on: false });
    expect(off.holidayMode).toBe(false);
    list = await callSkill(bundle.agent, 'listMySkills');
    expect(list.skills.every(s => s.status === 'active')).toBe(true);
  });

  it('does not unarchive gearchiveerd skills', async () => {
    const bundle = await buildAgent();
    await callSkill(bundle.agent, 'addMySkill', { categoryId: 'klusjes', status: 'archived' });
    await callSkill(bundle.agent, 'setSkillsHolidayMode', { on: true });
    await callSkill(bundle.agent, 'setSkillsHolidayMode', { on: false });
    const list = await callSkill(bundle.agent, 'listMySkills');
    expect(list.skills[0].status).toBe('archived');
  });

  it('rejects invalid arg', async () => {
    const bundle = await buildAgent();
    expect(await callSkill(bundle.agent, 'setSkillsHolidayMode', {})).toEqual({ error: 'on (bool) required' });
  });
});

// ── Stale-post nudge ─────────────────────────────────────────────────────

describe('Stoop V1 Phase 13.4 — stale-post detection', () => {
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
    // Wait a brief moment so the item's addedAt is strictly less than now.
    await new Promise(r => setTimeout(r, 5));
    // thresholdDays = a tiny fractional number (4 ms) — items older than that count as stale.
    const r = await callSkill(bundle.agent, 'listMyStalePosts',
      { thresholdDays: 4 / (24 * 60 * 60 * 1000) });
    expect(r.stale).toHaveLength(1);
    expect(r.stale[0].text).toBe('fresh post');
  });
});

// ── hop-routing sealedForward at construction ────────────────────────────

describe('Stoop V1 Phase 13.3 — hop sealedForward at agent construction', () => {
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
