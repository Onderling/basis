/**
 * Stoop V2 — Phase 24 tests.
 *
 * ContactBook + trust + tags + lists + QR contact-share +
 * asymmetric contact-add envelopes (kind: 'contact-request').
 */

import { describe, it, expect } from 'vitest';
import { AgentIdentity, InternalBus, InternalTransport, DataPart } from '@onderling/core';
import { VaultMemory } from '@onderling/vault';

import { createNeighbourhoodAgent } from '../src/index.js';

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

async function buildBundle(actor = ANNE, peers = []) {
  const id = await AgentIdentity.generate(new VaultMemory());
  const tx = new InternalTransport(new InternalBus(), id.pubKey);
  const bundle = await createNeighbourhoodAgent({
    identity: id, transport: tx,
    offeringMatch: { group: 'oosterpoort', localActor: actor, peers },
    members:    [{ webid: actor }],
  });
  await bundle.offeringMatch.start();
  return { bundle, id };
}

async function buildPair() {
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
  });
  anne.agent.addPeer(bobId.pubKey, bobId.pubKey);
  bob.agent.addPeer(anneId.pubKey, anneId.pubKey);
  await anne.offeringMatch.start();
  await bob.offeringMatch.start();
  return { anne, bob, anneId, bobId };
}

/* ── ContactBook CRUD ─────────────────────────────────────────── */

describe('Stoop V2 Phase 24 — ContactBook', () => {
  it('addContact upserts a MemberMap entry with relation: contact', async () => {
    const { bundle } = await buildBundle();
    const r = await callSkill(bundle.agent, 'addContact', {
      webid: BOB, handle: 'klusclub-bob', trustLevel: 'bekend',
    });
    expect(r.contact.relation).toBe('contact');
    expect(r.contact.trustLevel).toBe('bekend');
    expect(r.contact.handle).toBe('klusclub-bob');
  });

  it('removeContact drops the entry + cleans lists', async () => {
    const { bundle } = await buildBundle();
    await callSkill(bundle.agent, 'addContact', { webid: BOB, trustLevel: 'bekend' });
    const list = (await callSkill(bundle.agent, 'createContactList', { name: 'Vrienden' })).list;
    await callSkill(bundle.agent, 'addToContactList', { listId: list.listId, webid: BOB });

    await callSkill(bundle.agent, 'removeContact', { webid: BOB });
    const contacts = (await callSkill(bundle.agent, 'listContacts', {})).contacts;
    expect(contacts).toEqual([]);
    const reloaded = (await callSkill(bundle.agent, 'getContactList', { listId: list.listId })).list;
    expect(reloaded.contactWebids).toEqual([]);
  });

  it('setContactTrust + setContactTags persist on MemberMap', async () => {
    const { bundle } = await buildBundle();
    await callSkill(bundle.agent, 'addContact', { webid: BOB });
    await callSkill(bundle.agent, 'setContactTrust', { webid: BOB, level: 'vertrouwd' });
    await callSkill(bundle.agent, 'setContactTags',  { webid: BOB, tags: ['koor', 'familie'] });
    const c = (await callSkill(bundle.agent, 'listContacts', {})).contacts[0];
    expect(c.trustLevel).toBe('vertrouwd');
    expect(c.tags).toEqual(['koor', 'familie']);
  });

  it('listContacts({minTrust: vertrouwd}) filters', async () => {
    const { bundle } = await buildBundle();
    await callSkill(bundle.agent, 'addContact', { webid: 'https://id.example/c1', trustLevel: 'bekend' });
    await callSkill(bundle.agent, 'addContact', { webid: 'https://id.example/c2', trustLevel: 'vertrouwd' });
    const r = (await callSkill(bundle.agent, 'listContacts', { minTrust: 'vertrouwd' })).contacts;
    expect(r).toHaveLength(1);
    expect(r[0].webid).toBe('https://id.example/c2');
  });

  it('setContactFlag toggles the per-contact flags', async () => {
    const { bundle } = await buildBundle();
    await callSkill(bundle.agent, 'addContact', { webid: BOB });
    await callSkill(bundle.agent, 'setContactFlag', { webid: BOB, flag: 'shareLocation', value: true });
    await callSkill(bundle.agent, 'setContactFlag', { webid: BOB, flag: 'allowHopThrough', value: true });
    const c = (await callSkill(bundle.agent, 'listContacts', {})).contacts[0];
    expect(c.shareLocation).toBe(true);
    expect(c.allowHopThrough).toBe(true);
    expect(c.allowAutomatching).toBe(true);   // default
  });
});

/* ── Lists ────────────────────────────────────────────────────── */

describe('Stoop V2 Phase 24 — ContactLists', () => {
  it('createList → addToList → listLists round-trip; persists via cache', async () => {
    const { bundle } = await buildBundle();
    await callSkill(bundle.agent, 'addContact', { webid: BOB });
    const list = (await callSkill(bundle.agent, 'createContactList', { name: 'Vrienden' })).list;
    expect(list.listId).toBeTruthy();
    expect(list.name).toBe('Vrienden');

    await callSkill(bundle.agent, 'addToContactList', { listId: list.listId, webid: BOB });
    const lists = (await callSkill(bundle.agent, 'listContactLists', {})).lists;
    expect(lists).toHaveLength(1);
    expect(lists[0].contactWebids).toEqual([BOB]);
  });

  it('renameList + removeFromList + deleteList work', async () => {
    const { bundle } = await buildBundle();
    const list = (await callSkill(bundle.agent, 'createContactList', { name: 'A' })).list;
    await callSkill(bundle.agent, 'renameContactList', { listId: list.listId, name: 'B' });
    let one = (await callSkill(bundle.agent, 'getContactList', { listId: list.listId })).list;
    expect(one.name).toBe('B');

    await callSkill(bundle.agent, 'addContact', { webid: BOB });
    await callSkill(bundle.agent, 'addToContactList', { listId: list.listId, webid: BOB });
    await callSkill(bundle.agent, 'removeFromContactList', { listId: list.listId, webid: BOB });
    one = (await callSkill(bundle.agent, 'getContactList', { listId: list.listId })).list;
    expect(one.contactWebids).toEqual([]);

    await callSkill(bundle.agent, 'deleteContactList', { listId: list.listId });
    const after = (await callSkill(bundle.agent, 'getContactList', { listId: list.listId })).list;
    expect(after).toBeNull();
  });
});

/* ── QR contact-share ─────────────────────────────────────────── */

describe('Stoop V2 Phase 24 — QR contact-share', () => {
  it('getContactShareQr → addContactFromQr round-trips', async () => {
    const { bundle: srcBundle, id: srcId } = await buildBundle(ANNE);
    const dst = await buildBundle('https://id.example/dst');

    await callSkill(srcBundle.agent, 'setMyHandle', { handle: 'oosterpoort-bird-23' });
    const r = await callSkill(srcBundle.agent, 'getContactShareQr', { trustOffer: 'vertrouwd' });
    expect(r.payload).toMatch(/^onderling-contact:\/\//);

    const add = await callSkill(dst.bundle.agent, 'addContactFromQr', { payload: r.payload }, 'https://id.example/dst');
    expect(add.contact.webid).toBe(ANNE);
    expect(add.contact.handle).toBe('oosterpoort-bird-23');
    expect(add.contact.trustLevel).toBe('vertrouwd');
    expect(add.contact.pubKey).toBe(srcId.pubKey);
  });

  it('addContactFromQr rejects malformed payload', async () => {
    const { bundle } = await buildBundle();
    expect(await callSkill(bundle.agent, 'addContactFromQr', { payload: 'not a contact url' }))
      .toEqual({ error: 'invalid-payload' });
  });
});

/* ── Asymmetric contact-add request envelope ─────────────────── */

describe('Stoop V2 Phase 24 — asymmetric contact-add request', () => {
  it('Anne sends → Bob sees a contact-request item; accept adds Anne to Bob\'s ContactBook', async () => {
    const { anne, bob, anneId } = await buildPair();
    await callSkill(anne.agent, 'setMyHandle', { handle: 'anne-23' }, ANNE);

    const r = await callSkill(anne.agent, 'requestContactAdd', {
      toWebid: BOB, trustOffer: 'vertrouwd',
    }, ANNE);
    expect(r.ok).toBe(true);

    // Wait for the envelope to be received + stored.
    await new Promise(r => setTimeout(r, 50));

    const requests = (await callSkill(bob.agent, 'listContactRequests', undefined, BOB)).requests;
    expect(requests).toHaveLength(1);
    const req = requests[0];
    expect(req.source.fromWebid).toBe(ANNE);
    expect(req.source.handle).toBe('anne-23');
    expect(req.source.trustOffer).toBe('vertrouwd');

    // Bob accepts.
    const accept = await callSkill(bob.agent, 'acceptContactRequest', { requestId: req.id }, BOB);
    expect(accept.ok).toBe(true);
    expect(accept.contact.trustLevel).toBe('vertrouwd');
    expect(accept.contact.pubKey).toBe(anneId.pubKey);

    // Anne should NOT have been auto-added to Bob's bundle without
    // her clicking accept on her own (asymmetric).  But here, BOB
    // accepted, and Anne has not run any reciprocal flow — her
    // ContactBook stays empty for Bob.
    const anneContacts = (await callSkill(anne.agent, 'listContacts', undefined, ANNE)).contacts;
    expect(anneContacts).toEqual([]);
  });

  it('declineContactRequest closes the prompt without adding', async () => {
    const { anne, bob } = await buildPair();
    await callSkill(anne.agent, 'requestContactAdd', { toWebid: BOB, trustOffer: 'bekend' }, ANNE);
    await new Promise(r => setTimeout(r, 50));

    const requests = (await callSkill(bob.agent, 'listContactRequests', undefined, BOB)).requests;
    expect(requests).toHaveLength(1);
    const r = await callSkill(bob.agent, 'declineContactRequest', { requestId: requests[0].id }, BOB);
    expect(r.ok).toBe(true);

    const bobContacts = (await callSkill(bob.agent, 'listContacts', undefined, BOB)).contacts;
    expect(bobContacts).toEqual([]);

    // After decline, the request item is closed (not in listOpen).
    const stillOpen = (await callSkill(bob.agent, 'listContactRequests', undefined, BOB)).requests;
    expect(stillOpen).toEqual([]);
  });
});
