/**
 * Stoop V2 — Phase 27 tests.
 *
 * Multi-target posts + sender→receiver filter chain + auto-skillmatch
 * silence on loose contacts.
 *
 *   27.1  postRequest accepts {targets, maxDistanceKm}; legacy callers
 *         still get the active group injected
 *   27.2  targetResolver: resolve targets → recipient set; filter
 *         distance + muted
 *   27.3  sender-side filter applied before fan-out
 *   27.4  receiver-side filter mirrors broadcast-post envelopes
 *   27.7  loose-contact posts silenced (mirror only) when off-skill
 */

import { describe, it, expect } from 'vitest';
import { AgentIdentity, InternalBus, InternalTransport, DataPart } from '@onderling/core';
import { VaultMemory } from '@onderling/vault';

import { createNeighbourhoodAgent } from '../src/index.js';
import {
  resolve as resolveTargets,
  validateTarget,
  filterByDistance,
  filterMuted,
} from '../src/lib/targetResolver.js';
import { cellFor } from '../src/lib/geo.js';

const ANNE = 'https://id.example/anne';
const BOB  = 'https://id.example/bob';
const CARL = 'https://id.example/carl';
const DANI = 'https://id.example/dani';

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

async function buildBundle({ peers = [] } = {}) {
  const id = await AgentIdentity.generate(new VaultMemory());
  const tx = new InternalTransport(new InternalBus(), id.pubKey);
  const bundle = await createNeighbourhoodAgent({
    identity: id, transport: tx,
    offeringMatch: { group: 'oosterpoort', localActor: ANNE, peers },
    members:    [{ webid: ANNE }],
  });
  await bundle.offeringMatch.start();
  return bundle;
}

async function buildPair({ bobBlocks } = {}) {
  const bus = new InternalBus();
  const anneId = await AgentIdentity.generate(new VaultMemory());
  const bobId  = await AgentIdentity.generate(new VaultMemory());
  const anne = await createNeighbourhoodAgent({
    identity: anneId, transport: new InternalTransport(bus, anneId.pubKey),
    offeringMatch: { group: 'oosterpoort', localActor: ANNE,
                  peers: [{ pubKey: bobId.pubKey }] },
    members: [{ webid: ANNE }, { webid: BOB, pubKey: bobId.pubKey }],
  });
  const bob = await createNeighbourhoodAgent({
    identity: bobId, transport: new InternalTransport(bus, bobId.pubKey),
    offeringMatch: { group: 'oosterpoort', localActor: BOB,
                  peers: [{ pubKey: anneId.pubKey }] },
    members: [{ webid: ANNE, pubKey: anneId.pubKey }, { webid: BOB }],
    mutedSet: bobBlocks,
  });
  anne.agent.addPeer(bobId.pubKey, bobId.pubKey);
  bob.agent.addPeer(anneId.pubKey, anneId.pubKey);
  await anne.offeringMatch.start();
  await bob.offeringMatch.start();
  return { anne, bob, anneId, bobId };
}

/* ── 27.2 targetResolver ──────────────────────────────────── */

describe('Stoop V2 Phase 27.2 — targetResolver', () => {
  it('validateTarget accepts all four kinds and rejects others', () => {
    expect(validateTarget({ kind: 'group',    groupId: 'g' })).toBeNull();
    expect(validateTarget({ kind: 'contacts', minTrust: 'bekend' })).toBeNull();
    expect(validateTarget({ kind: 'tag',      tag: 'koor' })).toBeNull();
    expect(validateTarget({ kind: 'list',     listId: '01HX' })).toBeNull();
    expect(validateTarget({ kind: 'whatever' })).toBeTruthy();
    expect(validateTarget({ kind: 'group' })).toBeTruthy();   // missing groupId
  });

  it('resolve(group target) returns group members minus self', async () => {
    const bundle = await buildBundle();
    await callSkill(bundle.agent, 'addContact', { webid: BOB, trustLevel: 'bekend' });
    // BOB is now a contact, not a group-member, so the 'group' target shouldn't include them.
    await bundle.members.addMember({ webid: CARL, relation: 'group-member' });
    const r = await resolveTargets([{ kind: 'group', groupId: 'oosterpoort' }],
      { members: bundle.members, contacts: bundle.contacts, selfWebid: ANNE });
    expect(r.recipients.has(CARL)).toBe(true);
    expect(r.recipients.has(BOB)).toBe(false);
    expect(r.recipients.has(ANNE)).toBe(false);
  });

  it('resolve(contacts minTrust=vertrouwd) filters', async () => {
    const bundle = await buildBundle();
    await callSkill(bundle.agent, 'addContact', { webid: BOB, trustLevel: 'bekend' });
    await callSkill(bundle.agent, 'addContact', { webid: CARL, trustLevel: 'vertrouwd' });
    const r = await resolveTargets([{ kind: 'contacts', minTrust: 'vertrouwd' }],
      { members: bundle.members, contacts: bundle.contacts, selfWebid: ANNE });
    expect(r.recipients.has(CARL)).toBe(true);
    expect(r.recipients.has(BOB)).toBe(false);
  });

  it('resolve(tag) returns contacts with that tag', async () => {
    const bundle = await buildBundle();
    await callSkill(bundle.agent, 'addContact', { webid: BOB, tags: ['koor'] });
    await callSkill(bundle.agent, 'addContact', { webid: CARL, tags: ['familie'] });
    const r = await resolveTargets([{ kind: 'tag', tag: 'koor' }],
      { members: bundle.members, contacts: bundle.contacts, selfWebid: ANNE });
    expect(r.recipients.has(BOB)).toBe(true);
    expect(r.recipients.has(CARL)).toBe(false);
  });

  it('resolve(list) returns hand-picked members', async () => {
    const bundle = await buildBundle();
    await callSkill(bundle.agent, 'addContact', { webid: BOB });
    const list = (await callSkill(bundle.agent, 'createContactList', { name: 'Vrienden' })).list;
    await callSkill(bundle.agent, 'addToContactList', { listId: list.listId, webid: BOB });
    const r = await resolveTargets([{ kind: 'list', listId: list.listId }],
      { members: bundle.members, contacts: bundle.contacts, selfWebid: ANNE });
    expect(r.recipients.has(BOB)).toBe(true);
  });

  it('filterByDistance drops out-of-range; keeps unknowns', async () => {
    const bundle = await buildBundle();
    await callSkill(bundle.agent, 'setMyLocation', {
      cell: cellFor({ lat: 52.37, lng: 4.90 }), label: 'Amsterdam', source: 'geocode',
    });
    await bundle.members.addMember({
      webid: BOB,
      location: { cell: cellFor({ lat: 52.40, lng: 4.95 }), label: 'NL', source: 'geocode' },
    });
    await bundle.members.addMember({
      webid: CARL,
      location: { cell: cellFor({ lat: 53.22, lng: 6.57 }), label: 'Groningen', source: 'geocode' },
    });
    await bundle.members.addMember({ webid: DANI });   // no location → keep
    const set = new Set([BOB, CARL, DANI]);
    const r = await filterByDistance(set, {
      members: bundle.members, selfWebid: ANNE, maxDistanceKm: 10,
    });
    expect(r.has(BOB)).toBe(true);
    expect(r.has(CARL)).toBe(false);    // ~150 km away
    expect(r.has(DANI)).toBe(true);     // unknown location → kept
  });

  it('filterMuted drops muted webids + stableIds', async () => {
    const bundle = await buildBundle();
    await bundle.members.addMember({ webid: BOB, stableId: 'sb-bob' });
    const muted = new Set([BOB]);
    let r = await filterMuted(new Set([BOB, CARL]), muted, bundle.members);
    expect(r.has(BOB)).toBe(false);
    expect(r.has(CARL)).toBe(true);

    const muted2 = new Set(['sb-bob']);
    r = await filterMuted(new Set([BOB, CARL]), muted2, bundle.members);
    expect(r.has(BOB)).toBe(false);
    expect(r.has(CARL)).toBe(true);
  });
});

/* ── 27.1 postRequest accepts targets + maxDistanceKm ─────── */

describe('Stoop V2 Phase 27.1 — postRequest with targets', () => {
  it('legacy postRequest (no targets) gets the active group injected', async () => {
    const bundle = await buildBundle();
    const r = await callSkill(bundle.agent, 'postRequest', {
      text: 'paint', kind: 'ask',
    });
    const item = await bundle.itemStore.getById(r.requestId);
    expect(item.source.targets).toEqual([{ kind: 'group', groupId: 'oosterpoort' }]);
    expect(item.source.maxDistanceKm).toBeNull();
  });

  it('explicit targets + maxDistanceKm persist on the item', async () => {
    const bundle = await buildBundle();
    const r = await callSkill(bundle.agent, 'postRequest', {
      text: 'paint', kind: 'ask',
      targets: [
        { kind: 'group', groupId: 'oosterpoort' },
        { kind: 'contacts', minTrust: 'vertrouwd' },
      ],
      maxDistanceKm: 5,
    });
    const item = await bundle.itemStore.getById(r.requestId);
    expect(item.source.targets).toHaveLength(2);
    expect(item.source.maxDistanceKm).toBe(5);
  });

  it('invalid targets are filtered out before storage', async () => {
    const bundle = await buildBundle();
    const r = await callSkill(bundle.agent, 'postRequest', {
      text: 'x', kind: 'ask',
      targets: [
        { kind: 'group', groupId: 'oosterpoort' },
        { kind: 'whatever' },                          // invalid → dropped
        { kind: 'contacts' },                          // missing minTrust → dropped
      ],
    });
    const item = await bundle.itemStore.getById(r.requestId);
    expect(item.source.targets).toHaveLength(1);
    expect(item.source.targets[0].kind).toBe('group');
  });
});

/* ── 27.4 + 27.7 receiver-side filter + silence ───────────── */

describe('Stoop V2 Phase 27.4/27.7 — broadcast-post receiver filter', () => {
  it('contact-fanout post lands in receiver itemStore + sets viaAutoMatch when sender is not a contact', async () => {
    const { anne, bob, anneId } = await buildPair();
    // Anne posts targeting "all bekenden"; Bob is not yet Anne's
    // contact (so he's a loose contact from her side).  We use the
    // chat.send path directly to mimic the sender-side fan-out.
    await anne.chat.send({
      toWebid:  BOB,
      subtype:  'broadcast-post',
      extras: {
        postId: '01HX-TEST',
        text:   'iemand handig met fietsen?',
        kind:   'ask',
        categoryId: 'vervoer', skillTags: ['fiets'],
        targets: [{ kind: 'contacts', minTrust: 'bekend' }],
        maxDistanceKm: null,
        requiredSkills: [],
      },
    });
    await new Promise(r => setTimeout(r, 50));
    const open = await bob.itemStore.listOpen({});
    const post = open.find(i => i?.source?.requestId === '01HX-TEST');
    expect(post).toBeTruthy();
    expect(post.source.via).toBe('contact-fanout');
    // ANNE isn't a contact in BOB's MemberMap (only group-member by default),
    // so this is a "loose-contact" post.
    expect(post.source.viaAutoMatch).toBe(true);
    // Bob has no skills → notifyWorthy false (silence).
    expect(post.source.notifyWorthy).toBe(false);
  });

  it('notifyWorthy: true when sender IS a contact', async () => {
    const { anne, bob } = await buildPair();
    // Make ANNE a contact in BOB's bundle.
    await callSkill(bob.agent, 'addContact', { webid: ANNE, trustLevel: 'bekend' }, BOB);

    await anne.chat.send({
      toWebid:  BOB,
      subtype:  'broadcast-post',
      extras: {
        postId: '01HX-TEST-2',
        text:   'iets over fietsen',
        kind:   'ask',
        categoryId: 'vervoer', skillTags: ['fiets'],
        targets: [{ kind: 'contacts', minTrust: 'bekend' }],
        requiredSkills: [],
      },
    });
    await new Promise(r => setTimeout(r, 50));
    const post = (await bob.itemStore.listOpen({})).find(i => i?.source?.requestId === '01HX-TEST-2');
    expect(post.source.notifyWorthy).toBe(true);
    expect(post.source.viaAutoMatch).toBe(false);
  });

  it('notifyWorthy: true when post matches my skills (loose contact + skill match)', async () => {
    const { anne, bob } = await buildPair();
    // Bob has 'vervoer' as an active skill.
    await callSkill(bob.agent, 'addMySkill', { categoryId: 'vervoer' }, BOB);

    await anne.chat.send({
      toWebid:  BOB,
      subtype:  'broadcast-post',
      extras: {
        postId: '01HX-TEST-3',
        text:   'fiets repareren?',
        kind:   'ask',
        categoryId: 'vervoer', skillTags: ['fiets'],
        targets: [{ kind: 'contacts', minTrust: 'bekend' }],
        requiredSkills: [],
      },
    });
    await new Promise(r => setTimeout(r, 50));
    const post = (await bob.itemStore.listOpen({})).find(i => i?.source?.requestId === '01HX-TEST-3');
    expect(post.source.notifyWorthy).toBe(true);    // skill match
    expect(post.source.viaAutoMatch).toBe(true);    // sender NOT a contact
  });

  it('blocked senders get filtered out (no item stored)', async () => {
    // The shell's block set, handed in — this app reads it, never writes it.
    const bobBlocks = new Set([ANNE]);
    const { anne, bob } = await buildPair({ bobBlocks });
    await anne.chat.send({
      toWebid:  BOB,
      subtype:  'broadcast-post',
      extras: { postId: '01HX-MUTED', text: 'x', kind: 'ask',
                targets: [{ kind: 'contacts', minTrust: 'bekend' }] },
    });
    await new Promise(r => setTimeout(r, 50));
    const post = (await bob.itemStore.listOpen({})).find(i => i?.source?.requestId === '01HX-MUTED');
    expect(post).toBeUndefined();
  });
});
