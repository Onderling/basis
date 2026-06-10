// groupKeyResource.js — versioned group-key distribution for a shared (household) pod.
//
// A key resource is the group key (for ONE version) sealed to all current members in a single
// recipient-mode envelope — the multi-recipient envelope IS the distribution. It lives on the pod
// (e.g. `/.keys/group-vN.json`), so offline members learn keys by READING the pod (reconnect → read →
// unwrap with the local private key). No out-of-band push.
//
//   • grant (join)  = re-seal the SAME group key to +1 member, same version — O(1), the new member can
//                     read all content under this version. (Or rotate, if forward-join secrecy is wanted.)
//   • revoke (leave) = rotate to a NEW group key + a new version, sealed to the REMAINING members. Forward
//                     secrecy: the departed keep cached old-version ciphertext but can't read new content.
//
// Pure (no pod I/O): the control-agent (key-holder) reads/writes the resource; it owns the member roster
// (public keys), since the envelope stores only recipientIds, not the keys.

import { seal, open, generateGroupKey } from './envelope.js';

/** Build the key resource for `version`: the group key sealed to every current member's public key. */
export function buildGroupKeyResource({ version = 1, groupKey, recipients }) {
  const pubs = [...new Set((Array.isArray(recipients) ? recipients : [recipients]).filter(Boolean))];
  if (pubs.length === 0) throw new Error('buildGroupKeyResource: at least one recipient public key required');
  if (!groupKey) throw new Error('buildGroupKeyResource: groupKey required');
  return { v: 1, version, members: pubs.length, sealed: seal(groupKey, pubs) };
}

/** Unwrap the group key from a resource with a member's private key. Throws if not a member of this version. */
export function unwrapGroupKey(resource, privateKey) {
  if (!resource || typeof resource.sealed !== 'string') throw new Error('unwrapGroupKey: invalid key resource');
  return open(resource.sealed, privateKey);
}

/** grant — add a member to the CURRENT version: a current holder unwraps the group key and re-seals the
 *  SAME key to the expanded roster (same version). `currentRecipients` = the roster's public keys. */
export function grantMember(resource, { newRecipient, granterPrivateKey, currentRecipients }) {
  if (!newRecipient) throw new Error('grantMember: newRecipient public key required');
  const groupKey = unwrapGroupKey(resource, granterPrivateKey);
  const recipients = [...(currentRecipients || []), newRecipient];
  return buildGroupKeyResource({ version: resource.version, groupKey, recipients });
}

/** revoke / rotate — a NEW group key + version, sealed to the given roster (omit the departed member to
 *  revoke). `previous` supplies the version to increment; pass `null` for a fresh v1. */
export function rotateGroupKeyResource({ previous = null, recipients, groupKey } = {}) {
  const prev = previous && Number.isInteger(previous.version) ? previous.version : 0;
  return buildGroupKeyResource({ version: prev + 1, groupKey: groupKey || generateGroupKey(), recipients });
}
