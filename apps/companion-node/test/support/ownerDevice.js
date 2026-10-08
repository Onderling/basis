// One device of a person, as a test drives it: root-delegated, and able to sign a management statement for a node.
import nacl from 'tweetnacl';
import { deriveDeviceSeed, deviceDelegationPubKey, signDeviceDelegation, signDeviceStatement, STATEMENT_DOMAINS } from '@onderling/core';

/**
 * @param {{secret: Uint8Array, deriveAgentSeed: (label: string) => Uint8Array}} root   the person's owner root (Bootstrap)
 * @param {string} deviceId
 * @returns {{delegation: object, auth: (node: string, op: string, args?: object) => object}}
 */
export function ownerDevice(root, deviceId) {
  const seed = deriveDeviceSeed(root.deriveAgentSeed('default'), deviceId);
  const delegation = signDeviceDelegation(root.secret, { profileId: 'default', deviceId, pubKey: deviceDelegationPubKey(seed) });
  const kp = nacl.sign.keyPair.fromSeed(seed);
  const sign = (m) => nacl.sign.detached(new TextEncoder().encode(m), kp.secretKey);
  return {
    delegation,
    auth: (node, op, args = {}, { now } = {}) => signDeviceStatement({ domain: STATEMENT_DOMAINS.COMPANION_MANAGE, node, op, args, delegation, sign, ...(now ? { now } : {}) }),
  };
}
