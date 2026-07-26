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

import { grantMember, rotateGroupKeyResource, buildGroupKeyResource, banFromHistory, unwrapGroupKey } from './groupKeyResource.js';
import { buildKeyEvent } from './keyEventsLog.js';
import { generateGroupKey } from './envelope.js';

function normalizeMember(m) {
  if (!m || !m.webId || !m.publicKey) throw new Error('control-agent: member needs { webId, publicKey }');
  return { webId: String(m.webId), publicKey: String(m.publicKey), role: m.role === 'admin' ? 'admin' : 'member' };
}

/**
 * Create the household control-agent: applies pod ACL grant/revoke AND group-key rotation together
 * on membership events, so join/leave is a single operation. Enforces that at least one admin
 * remains (`force` bypasses); pure orchestration — pod I/O is injected via `sharing` + `keyStore`.
 *
 * @param {object} a
 * @param {{ grant: Function, revoke: Function }} a.sharing       ACL grant/revoke (createClientSharing)
 * @param {string} a.containerUri                                 the circle's shared container
 * @param {{ read: () => any, write: (res:any) => any }} a.keyStore  reads/writes the key resource on the pod
 * @param {{ publicKey: string, privateKey: string }} a.controllerKey  the agent's own keypair (always a recipient)
 * @param {string[]} [a.modes]                                    ACL modes granted to members (default read+write)
 * @param {Array<{webId,publicKey,role}>} [a.roster]             initial member roster
 * @param {{ append: (event:object) => any }} [a.keyEventLog]     optional log sink — when present, every key
 *   establishment/grant/rotation ALSO emits the versioned key AS a log key-event (self-distributing, no-pod).
 *   The pod key resource is still written (defense-in-depth); the LOG is the source. Absent → pod-only, unchanged.
 * @param {string} [a.groupId]                                    circle id stamped onto emitted key-events.
 */
export function createControlAgent({ sharing, containerUri, keyStore, controllerKey, modes = ['read', 'write'], roster = [], revokeMeshProof = null, keyEventLog = null, groupId = null }) {
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

  /** Emit the just-written key RESOURCE as a log key-event too, so the SAME versioned key self-distributes with
   *  no pod (the resource is defense-in-depth; the log is the source). Best-effort: a sink failure never breaks
   *  the membership op — the pod resource still carries the key. No-op when no `keyEventLog` was injected. */
  async function emitKeyEvent(resource) {
    if (!keyEventLog || typeof keyEventLog.append !== 'function' || !resource) return;
    try {
      const groupKey = unwrapGroupKey(resource, controllerKey.privateKey);   // the controller is always a recipient
      await keyEventLog.append(buildKeyEvent({
        groupId, version: resource.version, groupKey, recipients: resource.recipients,
      }));
    } catch { /* the log key-event is best-effort; the pod resource remains the fallback */ }
  }

  /** Build the initial key resource for the current roster (idempotent — no-op if one exists). */
  async function bootstrap() {
    if (await keyStore.read()) return null;
    const pubs = recipientsWithController(members.map((m) => m.publicKey));
    const res = buildGroupKeyResource({ version: 1, groupKey: generateGroupKey(), recipients: pubs });
    await keyStore.write(res);
    await emitKeyEvent(res);
    return res;
  }

  return {
    members: () => members.slice(),
    bootstrap,

    /** Join: grant ACL + add the member to the group key (O(1) re-wrap, or bootstrap the first key). */
    async addMember({ webId, publicKey, role = 'member' }) {
      const m = normalizeMember({ webId, publicKey, role });
      // Idempotent: a member already holding the group key (same sealing public key) is a
      // no-op — no re-grant, no re-wrap, no roster duplication. Re-wrapping the SAME key to
      // the SAME recipient set would be harmless (same version, same group key) but would
      // duplicate the roster entry and churn the resource; skipping keeps "provision only
      // when the member set actually changed".
      if (members.some((x) => x.publicKey === m.publicKey)) {
        return { keyResource: await keyStore.read(), members: members.slice() };
      }
      await sharing.grant({ containerUri, agent: m.webId, modes });
      const cur = await keyStore.read();
      const currentPubs = recipientsWithController(members.map((x) => x.publicKey));
      const next = cur
        ? grantMember(cur, { newRecipient: m.publicKey, granterPrivateKey: controllerKey.privateKey, currentRecipients: currentPubs })
        : buildGroupKeyResource({ version: 1, groupKey: generateGroupKey(), recipients: [...currentPubs, m.publicKey] });
      await keyStore.write(next);
      await emitKeyEvent(next);   // the new roster's key-event — the added member is now a recipient in the log too
      members = [...members, m];
      return { keyResource: next, members: members.slice() };
    },

    /**
     * Leave / remove — enforce ≥1 admin, revoke ACL + rotate the group key (forward secrecy) + revoke the
     * departed's MESH PROOF (the coupling fix: removal is complete, not just content-key rotation).
     *
     * `policy`:
     *   • `'graceful'` (default) — a normal leave/removal. Forward secrecy (no new content/mesh), but retained
     *     `history[]` is left intact, so the departed keeps access to content they ALREADY had (on their device).
     *   • `'ban'` — maximal revocation (intruder/hostile). Additionally re-seals `history[]` to EXCLUDE the
     *     departed, so no server-fetchable old key remains for them. (Content they already downloaded can't be
     *     clawed back — no system can — but everything the pod holds is denied.)
     */
    async removeMember({ webId, force = false, policy = 'graceful' }) {
      const target = members.find((x) => x.webId === String(webId));
      if (!target) return { keyResource: await keyStore.read(), members: members.slice(), removed: false };
      const adminCount = members.filter((x) => x.role === 'admin').length;
      if (!force && target.role === 'admin' && adminCount <= 1) {
        throw new Error('control-agent: cannot remove the last admin (≥1-admin invariant)');
      }
      await sharing.revoke({ containerUri, agent: target.webId, modes });
      const remaining = members.filter((x) => x.webId !== target.webId);
      const cur = await keyStore.read();
      // Rotate to EVERY CURRENT KEY-HOLDER minus the departing member — not to the roster alone.
      //
      // This resource can hold recipients who are NOT roster members: an out-of-circle CANONICAL SHARE
      // (`createCanonicalShare.share`) grants by adding the recipient's sealing key here. Rotating to
      // `remaining` alone therefore evicted every such grantee as collateral whenever ANY member was removed
      // — a silent loss of access for someone unrelated to the removal (the same class as the grant-side drop
      // fixed in item-store/circleShareEnforcement; this is the third place it appeared, so the rule is:
      // a rotation's audience is derived from the CURRENT HOLDERS minus the departing party, never from the
      // roster alone). `cur.recipients` IS that holder set — every prior rotation already pruned it.
      const holders = new Set([...(cur?.recipients ?? []), ...remaining.map((x) => x.publicKey)]);
      holders.delete(target.publicKey);          // the one party this rotation is meant to evict
      let next = rotateGroupKeyResource({
        previous: cur,
        recipients: recipientsWithController([...holders]),
      });
      if (policy === 'ban') {
        next = banFromHistory(next, { excludePubKey: target.publicKey, controllerPrivateKey: controllerKey.privateKey });
      }
      await keyStore.write(next);
      // The rotation as a log key-event: sealed to the REMAINING recipients only, so the departed — absent from
      // it — never folds the new version in and cannot open post-removal content (backward secrecy, no pod).
      await emitKeyEvent(next);
      members = remaining;
      // ── Coupling: revoke the departed's mesh membership proof too (both policies). Best-effort:
      //    a failure is surfaced in the return, never silently swallowed and never left partial-then-thrown.
      let proofRevoked = false;
      if (typeof revokeMeshProof === 'function') {
        try { await revokeMeshProof(target); proofRevoked = true; }
        catch { proofRevoked = false; }
      }
      return { keyResource: next, members: members.slice(), removed: true, policy, banned: policy === 'ban', proofRevoked };
    },
  };
}
