/**
 * CLOSE CONTACTS + DIRECT MESSAGES SEALED TO THE PERSON (binding-levels §10, the last two build steps).
 *
 * Anna and Bea share no circle. They exchange cards — the card carries the person's CURRENT key and its chain.
 * Bea's direct message to Anna is sealed to Anna's person key: the wire carries a box and no text, and Anna's device
 * opens it. Then Anna rotates (a revoke ceremony) — Bea does not know yet and seals the next message to version 1,
 * which Anna still opens with the seed she rotated away from. Anna's reply comes sealed FROM version 2, so Bea pulls
 * the chain, verifies the link from the version she holds, and her next message is sealed to version 2.
 *
 * Real agents over the shared bus, the production stoop skills, the production channel with the agent's seal.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { bootRealAgentNode, connectNodesOverBus, until, teardown } from '../support/pairRealAgents.js';
import { EventLog } from '../../src/eventLog.js';
import { Bootstrap, derivePersonKeySeed, derivePersonLinkKeySeed, personKeyPubKeyB64, signPersonKeyLink, openFromPersonKey } from '@onderling/core';
import { makeHandleFileShare, buildFileShareEnvelope } from '../../src/core/handlers/fileShare.js';

const log = () => ({ deviceLog: new EventLog({ initial: [], muted: [] }) });
const tapWire = (node) => {   // every contact-message payload as it arrives on the wire, before the channel opens it
  const raw = []; const prior = node._routerRef.fn;
  node._routerRef.fn = (env) => { if (String(env?.payload?.subtype ?? '').startsWith('contact-')) raw.push(env.payload); return prior?.(env); };
  return raw;
};
const tapLanded = (node) => {   // what the channel handed to the app, opened
  const landed = []; const orig = node.contactThreadChannel.persistInbound.bind(node.contactThreadChannel);
  node.contactThreadChannel.persistInbound = async (t) => { landed.push(t); return orig(t); };
  return landed;
};
const contactKey = async (node, webid) => (((r) => r?.items ?? r?.contacts ?? [])(await node.agent.callSkill('stoop', 'listContacts', {}))).find((c) => c.webid === webid)?.personKey ?? null;
const dm = (from, to, text, messageId) => from.contactThreadChannel.sendTurn({ peerAddr: to.pubKey, threadId: to.pubKey, text, messageId }).sent;

describe('contacts seal direct messages to the person key', () => {
  let A; let B; let rawAtA; let rawAtB; let landedAtA; let landedAtB;

  beforeAll(async () => {
    A = await bootRealAgentNode('A', { agentOpts: log(), contactChannel: true });
    B = await bootRealAgentNode('B', { agentOpts: log(), contactChannel: true });
    await connectNodesOverBus([A, B]);
    rawAtA = tapWire(A); rawAtB = tapWire(B); landedAtA = tapLanded(A); landedAtB = tapLanded(B);
    // The Hi: each takes the other's card.
    for (const [me, other] of [[A, B], [B, A]]) {
      const card = await other.agent.callSkill('stoop', 'getContactShareQr', {});
      const r = await me.agent.callSkill('stoop', 'addContactFromQr', { payload: card.payload });
      expect(r.error, JSON.stringify(r)).toBeUndefined();
    }
  }, 60_000);
  afterAll(async () => { await teardown(A, B); });

  it('the card carries the person key AND the link key\'s public half; the contact book keeps both (the pin)', async () => {
    const pinA = await contactKey(B, A.pubKey);
    expect(pinA).toMatchObject({ version: 1, pubKey: A.agent.personKey().pubKey });
    expect(typeof pinA.linkKeyPub, 'no link key pinned from the card').toBe('string');
    expect(pinA.linkKeyPub).not.toBe(pinA.pubKey);
    expect(await contactKey(A, B.pubKey)).toMatchObject({ version: 1, pubKey: B.agent.personKey().pubKey });
    expect(typeof (await contactKey(A, B.pubKey)).linkKeyPub).toBe('string');
  });

  it('THE HOLE (2026-09-16), closed: a revoked device holds seed n and the profile address — its forged chain moves nothing, and neither does a card with a link key of its own', async () => {
    // The thief: everything the lost device holds — version 1's seed (derivable from the phrase it saw at its ceremony,
    // never the root afterwards). It signs "1 vouches for 2" itself, naming a key of its own, and answers Bea's pull.
    const phrase = (await A.agent.callSkill('household', 'revealOwnerPhrase', {}))?.mnemonic;
    const profileSeed = Bootstrap.fromMnemonic(phrase).deriveAgentSeed('default');
    const seed1 = derivePersonKeySeed(profileSeed, 1);
    expect(personKeyPubKeyB64(seed1), 'the test holds what the lost device holds').toBe(A.agent.personKey().pubKey);
    const thiefKey = personKeyPubKeyB64(derivePersonKeySeed(Bootstrap.create().bootstrap.deriveAgentSeed('default'), 1));
    const forged = signPersonKeyLink(seed1, { version: 2, pubKey: thiefKey, prevVersion: 1 });
    const before = await contactKey(B, A.pubKey);
    const r = await B.agent.callSkill('stoop', 'setContactPersonKey', { webid: A.pubKey, personKey: { version: 2, pubKey: thiefKey }, links: [forged] });
    expect(r.personKey ?? null).toEqual(before);
    expect(await contactKey(B, A.pubKey), 'the forged chain moved the record').toEqual(before);
    // A fresh card with the thief's OWN link key — the pin refuses it.
    const thiefLinkPub = personKeyPubKeyB64(derivePersonLinkKeySeed(Bootstrap.create().bootstrap.deriveAgentSeed('default')));
    const forgedByOwnLink = signPersonKeyLink(derivePersonLinkKeySeed(Bootstrap.create().bootstrap.deriveAgentSeed('default')), { version: 2, pubKey: thiefKey, prevVersion: 1 });
    await B.agent.callSkill('stoop', 'setContactPersonKey', { webid: A.pubKey, personKey: { version: 2, pubKey: thiefKey, linkKeyPub: thiefLinkPub }, links: [forgedByOwnLink] });
    expect(await contactKey(B, A.pubKey), 'a card with a different link key replaced the pin').toEqual(before);
    // And the genuine link, signed by the real link key, IS what Bea will accept — proven by the rotation below.
  });

  it('a direct message crosses as a box, not text — and lands opened', async () => {
    await dm(B, A, 'hoi Anna', 'b1');
    expect(await until(() => (landedAtA.some((t) => t.text === 'hoi Anna') ? true : null), { timeout: 8000, step: 50 }), 'Anna never got the message').toBe(true);
    const wire = rawAtA.find((p) => p.messageId === 'b1');
    expect(wire.text).toBe('');
    expect(wire.sealed).toMatchObject({ to: { version: 1 }, from: { version: 1 } });
    expect(typeof wire.sealed.sealed).toBe('string');
  });

  it('after Anna rotates, a message sealed to the old version still opens; her reply makes Bea pull the chain; the next one seals to v2', async () => {
    const phrase = (await A.agent.callSkill('household', 'revealOwnerPhrase', {}))?.mnemonic;
    const r = await A.agent.callSkill('household', 'revokeDevice', { mnemonic: phrase, deviceId: 'a-device-anna-never-enrolled', circleIds: [] });
    expect(r.personKeyVersion, JSON.stringify(r)).toBe(2);
    expect(A.agent.personKeyChainOf().links).toHaveLength(1);

    // Bea still holds v1 — seals to it; Anna opens with the seed she rotated away from.
    await dm(B, A, 'nog daar?', 'b2');
    expect(await until(() => (landedAtA.some((t) => t.text === 'nog daar?') ? true : null), { timeout: 8000, step: 50 }), 'Anna could not open a message sealed to her previous key').toBe(true);
    expect(rawAtA.find((p) => p.messageId === 'b2').sealed.to.version).toBe(1);

    // Anna replies FROM v2 → Bea pulls the chain and records v2.
    await dm(A, B, 'ja hoor', 'a1');
    expect(await until(() => (landedAtB.some((t) => t.text === 'ja hoor') ? true : null), { timeout: 8000, step: 50 }), 'Bea never got the reply').toBe(true);
    expect(rawAtB.find((p) => p.messageId === 'a1').sealed.from.version).toBe(2);
    expect(await until(async () => ((await contactKey(B, A.pubKey))?.version === 2 ? true : null), { timeout: 8000, step: 50 }), `Bea never learned v2: ${JSON.stringify(await contactKey(B, A.pubKey))}`).toBe(true);
    expect((await contactKey(B, A.pubKey)).pubKey).toBe(A.agent.personKey().pubKey);

    await dm(B, A, 'mooi', 'b3');
    expect(await until(() => (landedAtA.some((t) => t.text === 'mooi') ? true : null), { timeout: 8000, step: 50 })).toBe(true);
    expect(rawAtA.find((p) => p.messageId === 'b3').sealed.to.version).toBe(2);
  }, 60_000);

  it('a FILE in a DM is sealed to the person like the text: the wire carries the box and a stub, never the bytes; the revoked device (seed 1) cannot open a file sealed after the rotation', async () => {
    // Bea → Anna, who is at version 2 and known to Bea as such (the rotation above). The receive half is the
    // shells' production handler with the agent's own `openFor`; the send half is the builtin's envelope builder.
    const wireAtA = []; const delivered = [];
    const priorA = A._routerRef.fn;
    const onFile = makeHandleFileShare({ deliverToThread: (t) => delivered.push(t), openFor: A.agent.contactSeal.openFor, logger: { warn: () => {} } });
    A._routerRef.fn = (env) => { if (env?.payload?.subtype === 'file-share') { wireAtA.push(env.payload); return onFile(env.from, env.payload); } return priorA?.(env); };
    const file = { id: 'f-1', name: 'foto.jpg', mime: 'image/jpeg', size: 3, dataB64: Buffer.from('abc').toString('base64') };
    const envelope = await buildFileShareEnvelope({ file, peerAddr: A.pubKey, sealFor: B.agent.contactSeal.sealFor, sentAt: 1234 });
    expect(envelope.file.dataB64, 'the bytes left in the clear').toBeUndefined();
    expect(envelope.sealed).toMatchObject({ to: { version: 2 }, from: { version: 1 } });
    await B.agent.sendPeerMessage(A.pubKey, envelope);
    expect(await until(() => (delivered.length ? true : null), { timeout: 8000, step: 50 }), 'the file never landed opened').toBe(true);
    expect(delivered[0].file).toMatchObject({ id: 'f-1', name: 'foto.jpg', mime: 'image/jpeg', size: 3, dataB64: file.dataB64 });
    expect(delivered[0].sealed).toMatchObject({ to: { version: 2 } });
    expect(wireAtA[0].file.dataB64).toBeUndefined();
    // THE THIEF: the lost device holds seed 1 (from the phrase it saw at its ceremony) — the box is sealed to version 2.
    const phrase = (await A.agent.callSkill('household', 'revealOwnerPhrase', {}))?.mnemonic;
    const seed1 = derivePersonKeySeed(Bootstrap.fromMnemonic(phrase).deriveAgentSeed('default'), 1);
    expect(await openFromPersonKey(seed1, wireAtA[0].sealed.from.pubKey, wireAtA[0].sealed), 'seed 1 opened a file sealed to version 2').toBe(null);
    // And with NO key on record the file goes as before — bytes inline, transport-sealed only (the stated fallback).
    const plain = await buildFileShareEnvelope({ file, peerAddr: 'nobody-on-record', sealFor: B.agent.contactSeal.sealFor });
    expect(plain.sealed).toBeUndefined();
    expect(plain.file.dataB64).toBe(file.dataB64);
  }, 60_000);
});
