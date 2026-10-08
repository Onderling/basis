/**
 * A person with a root and several devices, as a bot meets them over the identity link: each device signs with its own
 * root-signed delegation, every device knows the person's chat identity. What their app sends — the offer, a turn's
 * statement, a call's statement, a revocation — built with the same shared code the app uses.
 */
import nacl from 'tweetnacl';
import {
  AgentIdentity, Bootstrap, b64encode, deriveDeviceSeed, deviceDelegationPubKey, signDeviceDelegation,
  signDeviceRevocation, signDeviceStatement, STATEMENT_DOMAINS,
} from '@onderling/core';
import { VaultMemory } from '@onderling/vault';
import { encodeLinkOffer, linkOfferMessage, LINK_OPS } from '../../src/v2/identityLink.js';

export async function linkedPerson() {
  const root = Bootstrap.create().bootstrap;
  const chat = await AgentIdentity.generate(new VaultMemory());
  const devices = new Map();
  const device = (deviceId) => {
    if (!devices.has(deviceId)) {
      const seed = deriveDeviceSeed(root.deriveAgentSeed('default'), deviceId);
      const delegation = signDeviceDelegation(root.secret, { profileId: 'default', deviceId, pubKey: deviceDelegationPubKey(seed) });
      const kp = nacl.sign.keyPair.fromSeed(seed);
      devices.set(deviceId, { delegation, sign: (m) => nacl.sign.detached(new TextEncoder().encode(m), kp.secretKey) });
    }
    return devices.get(deviceId);
  };
  const statement = (deviceId, node, op, args, now) => signDeviceStatement({
    domain: STATEMENT_DOMAINS.IDENTITY_LINK, node, op, args, ...device(deviceId), ...(now ? { now } : {}),
  });
  return {
    root: device('first').delegation.by,
    webid: chat.pubKey,
    /** The line the app makes for this bot, from this device. */
    offer(deviceId, bot, { webid = chat.pubKey, signer = chat, now } = {}) {
      const st = statement(deviceId, bot, LINK_OPS.LINK, { w: webid }, now);
      return encodeLinkOffer({ statement: st, webid, webidSig: b64encode(signer.sign(linkOfferMessage({ k: webid, b: bot, n: st.nonce }))) });
    },
    /** The statement a turn to the bot carries, from this device. */
    turn: (deviceId, bot, { text, messageId }, { now } = {}) => statement(deviceId, bot, LINK_OPS.TURN, { text, messageId }, now),
    /** The statement a call to the bot carries. */
    call: (deviceId, bot, op, args) => statement(deviceId, bot, op, args),
    /** The root's tombstone for one of its devices. */
    revocation: (deviceId) => signDeviceRevocation(root.secret, { profileId: 'default', deviceId }),
  };
}
