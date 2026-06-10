// controlAgent.js — the household control-agent. Applies pod ACL grant/revoke AND group-key rotation
// TOGETHER on membership events, so "join the circle → get pod access; leave → lose it" is one operation
// no human need be online for. Wraps `sharing` (ACL, packages/pod-client/src/sharing) + the versioned key
// resources (groupKeyResource.js). The agent is itself a key-holder (a recipient of every key resource),
// so it can always unwrap to re-wrap on grant.
//
// Invariants:
//   • at least one ADMIN always remains — removing the last admin throws (unless `force`);
//   • the pod OWNER is break-glass — a `force` removal bypasses the admin guard (they hold the pod anyway).
//
// Pure orchestration: pod I/O is injected — `sharing.grant/revoke`, and a `keyStore` {read,write} that
// persists the key resource to the pod (e.g. /.keys/group-vN.json via a SealedPodClient or PodClient).

import { grantMember, rotateGroupKeyResource, buildGroupKeyResource } from './groupKeyResource.js';
import { generateGroupKey } from './envelope.js';

function normalizeMember(m) {
  if (!m || !m.webId || !m.publicKey) throw new Error('control-agent: member needs { webId, publicKey }');
  return { webId: String(m.webId), publicKey: String(m.publicKey), role: m.role === 'admin' ? 'admin' : 'member' };
}

/**
 * @param {object} a
 * @param {{ grant: Function, revoke: Function }} a.sharing       ACL grant/revoke (createClientSharing)
 * @param {string} a.containerUri                                 the circle's shared container
 * @param {{ read: () => any, write: (res:any) => any }} a.keyStore  reads/writes the key resource on the pod
 * @param {{ publicKey: string, privateKey: string }} a.controllerKey  the agent's own keypair (always a recipient)
 * @param {string[]} [a.modes]                                    ACL modes granted to members (default read+write)
 * @param {Array<{webId,publicKey,role}>} [a.roster]             initial member roster
 */
export function createControlAgent({ sharing, containerUri, keyStore, controllerKey, modes = ['read', 'write'], roster = [] }) {
  if (!sharing || typeof sharing.grant !== 'function' || typeof sharing.revoke !== 'function') {
    throw new Error('createControlAgent: sharing with grant/revoke required');
  }
  if (!keyStore || typeof keyStore.read !== 'function' || typeof keyStore.write !== 'function') {
    throw new Error('createControlAgent: keyStore with read/write required');
  }
  if (!controllerKey || !controllerKey.publicKey || !controllerKey.privateKey) {
    throw new Error('createControlAgent: controllerKey { publicKey, privateKey } required');
  }
  let members = roster.map(normalizeMember);
  const recipientsWithController = (pubs) => [...new Set([...pubs, controllerKey.publicKey])];

  /** Build the initial key resource for the current roster (idempotent — no-op if one exists). */
  async function bootstrap() {
    if (await keyStore.read()) return null;
    const pubs = recipientsWithController(members.map((m) => m.publicKey));
    const res = buildGroupKeyResource({ version: 1, groupKey: generateGroupKey(), recipients: pubs });
    await keyStore.write(res);
    return res;
  }

  return {
    members: () => members.slice(),
    bootstrap,

    /** Join: grant ACL + add the member to the group key (O(1) re-wrap, or bootstrap the first key). */
    async addMember({ webId, publicKey, role = 'member' }) {
      const m = normalizeMember({ webId, publicKey, role });
      await sharing.grant({ containerUri, agent: m.webId, modes });
      const cur = await keyStore.read();
      const currentPubs = recipientsWithController(members.map((x) => x.publicKey));
      const next = cur
        ? grantMember(cur, { newRecipient: m.publicKey, granterPrivateKey: controllerKey.privateKey, currentRecipients: currentPubs })
        : buildGroupKeyResource({ version: 1, groupKey: generateGroupKey(), recipients: [...currentPubs, m.publicKey] });
      await keyStore.write(next);
      members = [...members, m];
      return { keyResource: next, members: members.slice() };
    },

    /** Leave: enforce ≥1 admin, revoke ACL + rotate the group key (forward secrecy). */
    async removeMember({ webId, force = false }) {
      const target = members.find((x) => x.webId === String(webId));
      if (!target) return { keyResource: await keyStore.read(), members: members.slice(), removed: false };
      const adminCount = members.filter((x) => x.role === 'admin').length;
      if (!force && target.role === 'admin' && adminCount <= 1) {
        throw new Error('control-agent: cannot remove the last admin (≥1-admin invariant)');
      }
      await sharing.revoke({ containerUri, agent: target.webId, modes });
      const remaining = members.filter((x) => x.webId !== target.webId);
      const cur = await keyStore.read();
      const next = rotateGroupKeyResource({
        previous: cur,
        recipients: recipientsWithController(remaining.map((x) => x.publicKey)),
      });
      await keyStore.write(next);
      members = remaining;
      return { keyResource: next, members: members.slice(), removed: true };
    },
  };
}
