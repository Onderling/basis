/**
 * The "sealed to the person" mark: a pure projection of the agent's seal status onto one locale key, plus the agent's
 * status itself (the same resolution the seal uses), read over the bus after a card exchange.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { contactSealMark, CONTACT_SEAL_LEVEL } from '../../src/v2/contactSealMark.js';
import { sharedCircleLocale } from '../../src/locales/index.js';
import { bootRealAgentNode, connectNodesOverBus, teardown } from '../support/pairRealAgents.js';

describe('the contact seal mark', () => {
  it('projects the status onto one locale key; anything but a person seal reads as device-only', () => {
    expect(contactSealMark({ sealed: 'person', to: { version: 2, pubKey: 'x' } })).toEqual({ level: CONTACT_SEAL_LEVEL.PERSON, key: 'circle.contacts.sealed_person' });
    expect(contactSealMark({ sealed: 'device' })).toEqual({ level: CONTACT_SEAL_LEVEL.DEVICE, key: 'circle.contacts.sealed_device' });
    expect(contactSealMark(null).key).toBe('circle.contacts.sealed_device');
    expect(contactSealMark(undefined).level).toBe('device');
  });
  it('both keys exist in both shared locales, as {text, doc} leaves', () => {
    for (const lng of ['en', 'nl']) {
      for (const k of ['sealed_person', 'sealed_device']) {
        const leaf = sharedCircleLocale[lng].contacts[k];
        expect(typeof leaf?.text, `${lng} circle.contacts.${k}`).toBe('string');
        expect(typeof leaf?.doc, `${lng} circle.contacts.${k} doc`).toBe('string');
      }
    }
  });
});

describe('the agent says what a direct message to a contact is sealed to', () => {
  let A; let B;
  beforeAll(async () => {
    A = await bootRealAgentNode('A');
    B = await bootRealAgentNode('B');
    await connectNodesOverBus([A, B]);
  }, 60_000);
  afterAll(async () => { await teardown(A, B); });

  it('a stranger, or a contact without a key on record: sealed to the device only', async () => {
    expect(await A.agent.contactSeal.statusFor(B.pubKey)).toEqual({ sealed: 'device' });
  });
  it('after the card: sealed to the person, naming the version', async () => {
    const card = await B.agent.callSkill('stoop', 'getContactShareQr', {});
    expect((await A.agent.callSkill('stoop', 'addContactFromQr', { payload: card.payload })).error).toBeUndefined();
    expect(await A.agent.contactSeal.statusFor(B.pubKey)).toEqual({ sealed: 'person', to: { version: 1, pubKey: B.agent.personKey().pubKey } });
  });
  it('asked by an ALIAS of the contact (a registered address, or the mesh address on their record), it still answers for the person', async () => {
    // an address this device has bound to the identity (the way a per-circle or mesh address is bound)
    expect(A.agent.registerPeerAddress('alias-of-b', B.pubKey)).toBe(true);
    expect((await A.agent.contactSeal.statusFor('alias-of-b')).sealed).toBe('person');
    // the mesh address on the contact record itself, bound nowhere else
    expect((await A.agent.callSkill('stoop', 'addContact', { webid: B.pubKey, peerAddr: 'mesh-addr-of-b' })).error).toBeUndefined();
    expect((await A.agent.contactSeal.statusFor('mesh-addr-of-b')).sealed).toBe('person');
    expect((await A.agent.contactSeal.statusFor('nobody-at-all')).sealed).toBe('device');
  });
});
