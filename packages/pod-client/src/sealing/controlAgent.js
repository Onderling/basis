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
//
// THE STORED RESOURCE IS WHO HOLDS THE KEY. Every change here is computed on the resource as stored, through the
// shared key-resource write (keyResourceWrite.js: serialised in this process, compare-and-swap across devices when
// the store offers `writeIfUnchanged`). A join adds ONE key to the stored recipients; it never rebuilds the list
// from this agent's in-memory roster, which knows nothing of a device enrolled by grantRecipient, a canonical-share
// grantee, or a member another device of the founder added — a rebuild silently took the key from all of them.

import { grantMember, rotateGroupKeyResource, buildGroupKeyResource, banFromHistory, unwrapGroupKey } from './groupKeyResource.js';
import { buildKeyEvent } from './keyEventsLog.js';
import { generateGroupKey } from './envelope.js';
import { changeKeyResource } from './keyResourceWrite.js';

/** The roster could not say whether the member is still a member: the join's key change is NOT made (never a yes). */
export class MemberUnknownError extends Error {
  constructor() {
    super('the roster cannot say yet whether this member is still a member — the group key was not changed');
    this.name = 'MemberUnknownError';
    this.code = 'MEMBER_UNKNOWN';
  }
}

function normalizeMember(m) {
  if (!m || !m.webId || !m.publicKey) throw new Error('control-agent: member needs { webId, publicKey }');
  const out = { webId: String(m.webId), publicKey: String(m.publicKey), role: m.role === 'admin' ? 'admin' : 'member' };
  // podAgent: the Solid WebID the member's pod session signs in as. The roster ref (webId) names the member and
  // keys the group-key wrap; it is not an identity any pod session holds, so a read grant to it opens nothing.
  // When the member said their pod WebID, the ACL grant goes to it instead. It stays here, in this agent's state.
  if (typeof m.podAgent === 'string' && /^https?:\/\//.test(m.podAgent.trim())) out.podAgent = m.podAgent.trim();
  return out;
}

/** The identity the ACL grant names for a member: their pod WebID when known, else the roster ref (today's). */
const aclAgentOf = (m) => m.podAgent ?? m.webId;

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
 *   The pod key resource is still written (defence-in-depth); the LOG is the source. Absent → pod-only, unchanged.
 * @param {string} [a.groupId]                                    circle id stamped onto emitted key-events.
 * @param {Record<string,string>} [a.podAgents]                   roster ref → pod WebID, as the host saved it
 *   (local to this device, never on the roster). A member re-added without one (a reload's roster seed) gets
 *   the saved one back, so a later removal revokes the identity the grant actually named.
 */
export function createControlAgent({ sharing, containerUri, keyStore, controllerKey, modes = ['read', 'write'], roster = [], revokeMeshProof = null, keyEventLog = null, groupId = null, podAgents = {} }) {
  if (!sharing || typeof sharing.grant !== 'function' || typeof sharing.revoke !== 'function') {
    throw new Error('createControlAgent: sharing with grant/revoke required');
  }
  if (!keyStore || typeof keyStore.read !== 'function' || typeof keyStore.write !== 'function') {
    throw new Error('createControlAgent: keyStore with read/write required');
  }
  if (!controllerKey || !controllerKey.publicKey || !controllerKey.privateKey) {
    throw new Error('createControlAgent: controllerKey { publicKey, privateKey } required');
  }
  const savedPodAgents = { ...(podAgents ?? {}) };
  const withSavedPodAgent = (m) => (m.podAgent || !savedPodAgents[m.webId]) ? m : normalizeMember({ ...m, podAgent: savedPodAgents[m.webId] });
  let members = roster.map(normalizeMember).map(withSavedPodAgent);
  const recipientsWithController = (pubs) => [...new Set([...pubs, controllerKey.publicKey])];

  /** Emit the just-written key RESOURCE as a log key-event too, so the SAME versioned key self-distributes with
   *  no pod (the resource is defence-in-depth; the log is the source). Best-effort: a sink failure never breaks
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

  /** Build the initial key resource for the current roster (idempotent — no-op if one exists). SINGLE-FLIGHT: the
   *  check and the write are two awaits apart, so callers that overlapped there each minted their own "version 1"
   *  key; a second caller now waits for the first instead. */
  let bootstrapping = null;
  function bootstrap() {
    if (!bootstrapping) bootstrapping = bootstrapOnce().finally(() => { bootstrapping = null; });
    return bootstrapping;
  }
  async function bootstrapOnce() {
    const { written } = await changeKeyResource(keyStore, (cur) => (cur ? null : buildGroupKeyResource({
      version: 1, groupKey: generateGroupKey(), recipients: recipientsWithController(members.map((m) => m.publicKey)),
    })));
    if (written) await emitKeyEvent(written);
    return written;
  }

  return {
    members: () => members.slice(),
    /** roster ref → pod WebID for every member who gave one: what the host saves locally (never on the roster). */
    podAgents: () => Object.fromEntries(members.filter((x) => x.podAgent).map((x) => [x.webId, x.podAgent])),
    bootstrap,

    /**
     * Join: grant ACL + add the member to the group key (O(1) re-wrap, or bootstrap the first key).
     *
     * `isMember` (optional) — asked on EVERY compute, so a join recomputed after a lost race on a base where the
     * member was just removed does not put them back: `true` adds, `false` drops this change (`{ dropped: true }`),
     * anything else (the roster cannot answer yet) throws MemberUnknownError — it never proceeds as a yes.
     */
    async addMember({ webId, publicKey, role = 'member', podAgent = null, isMember = null }) {
      const m = normalizeMember({ webId, publicKey, role, podAgent });
      // Idempotent: a member already holding the group key (same sealing public key) is a
      // no-op — no re-grant, no re-wrap, no roster duplication. Re-wrapping the SAME key to
      // the SAME recipient set would be harmless (same version, same group key) but would
      // duplicate the roster entry and churn the resource; skipping keeps "provision only
      // when the member set actually changed".
      const known = members.find((x) => x.publicKey === m.publicKey);
      if (known) {
        // the one change an existing member can bring: the pod WebID their read grant should name
        if (m.podAgent && known.podAgent !== m.podAgent) {
          await sharing.grant({ containerUri, agent: m.podAgent, modes });
          if (known.podAgent) await sharing.revoke({ containerUri, agent: known.podAgent, modes });
          members = members.map((x) => (x === known ? { ...x, podAgent: m.podAgent } : x));
        }
        return { keyResource: await keyStore.read(), members: members.slice() };
      }
      const mm = withSavedPodAgent(m);
      let dropped = false;
      const { written, base } = await changeKeyResource(keyStore, async (cur) => {
        if (typeof isMember === 'function') {
          const answer = await isMember();
          if (answer === false) { dropped = true; return null; }   // removed meanwhile: the removal stands
          if (answer !== true) throw new MemberUnknownError();
          dropped = false;
        }
        if (!cur) {   // no key yet: the first one, sealed to this agent's roster + the joiner
          return buildGroupKeyResource({ version: 1, groupKey: generateGroupKey(), recipients: [...recipientsWithController(members.map((x) => x.publicKey)), m.publicKey] });
        }
        if ((cur.recipients ?? []).includes(m.publicKey)) return null;   // already holds this version
        return grantMember(cur, {
          newRecipient: m.publicKey, granterPrivateKey: controllerKey.privateKey,
          currentRecipients: recipientsWithController(cur.recipients ?? []),
        });
      });
      if (dropped) return { keyResource: base, members: members.slice(), dropped: true };
      // the pod access follows the key: granted only once the join stands (a dropped join opens nothing)
      await sharing.grant({ containerUri, agent: aclAgentOf(mm), modes });
      if (written) await emitKeyEvent(written);   // the new roster's key-event — the added member is now a recipient in the log too
      members = [...members, mm];
      return { keyResource: written ?? base, members: members.slice() };
    },

    /**
     * DEVICE-GRAINED audience surgery (the custody arc): a member's DEVICES each hold their own
     * sealing key (derived from their per-circle address — `sealingPublicKeyFromNetworkKey`), and
     * enrolling/revoking a device changes the key's AUDIENCE without touching the member roster
     * or the ACL — the MEMBER stays; one of their readers appears or disappears.
     */

    /** Enroll a device: wrap the current group key to one more recipient (no member-roster change). */
    async grantRecipient({ publicKey } = {}) {
      if (typeof publicKey !== 'string' || !publicKey) throw new Error('grantRecipient: publicKey required');
      const { written, base } = await changeKeyResource(keyStore, (cur) => {
        if (!cur) throw new Error('grantRecipient: no group key yet (bootstrap the circle first)');
        if ((cur.recipients ?? []).includes(publicKey)) return null;
        return grantMember(cur, { newRecipient: publicKey, granterPrivateKey: controllerKey.privateKey, currentRecipients: cur.recipients ?? [] });
      });
      if (!written) return { keyResource: base, granted: false };
      await emitKeyEvent(written);
      return { keyResource: written, granted: true };
    },

    /**
     * Revoke a device: rotate the group key to every current holder MINUS the device's sealing
     * key. `policy: 'ban'` additionally re-seals history to exclude it (the stolen-device
     * default — nothing pod-fetchable remains for the island; what it already downloaded cannot
     * be clawed back, by any system).
     */
    async revokeRecipient({ publicKey, policy = 'ban' } = {}) {
      if (typeof publicKey !== 'string' || !publicKey) throw new Error('revokeRecipient: publicKey required');
      const { written, base } = await changeKeyResource(keyStore, (cur) => {
        if (!cur || !(cur.recipients ?? []).includes(publicKey)) return null;
        const holders = new Set(cur.recipients ?? []);
        holders.delete(publicKey);
        const next = rotateGroupKeyResource({ previous: cur, recipients: recipientsWithController([...holders]) });
        return policy === 'ban' ? banFromHistory(next, { excludePubKey: publicKey, controllerPrivateKey: controllerKey.privateKey }) : next;
      });
      if (!written) return { keyResource: base ?? null, rotated: false };
      await emitKeyEvent(written);
      return { keyResource: written, rotated: true };
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
      await sharing.revoke({ containerUri, agent: aclAgentOf(target), modes });
      delete savedPodAgents[target.webId];
      const remaining = members.filter((x) => x.webId !== target.webId);
      // Rotate to EVERY CURRENT KEY-HOLDER minus the departing member — not to the roster alone.
      //
      // This resource can hold recipients who are NOT roster members: an out-of-circle CANONICAL SHARE
      // (`createCanonicalShare.share`) grants by adding the recipient's sealing key here. Rotating to
      // `remaining` alone therefore evicted every such grantee as collateral whenever ANY member was removed
      // — a silent loss of access for someone unrelated to the removal (the same class as the grant-side drop
      // fixed in item-store/circleShareEnforcement; this is the third place it appeared, so the rule is:
      // a rotation's audience is derived from the CURRENT HOLDERS minus the departing party, never from the
      // roster alone). `cur.recipients` IS that holder set — every prior rotation already pruned it.
      const { written: next } = await changeKeyResource(keyStore, (cur) => {
        const holders = new Set([...(cur?.recipients ?? []), ...remaining.map((x) => x.publicKey)]);
        holders.delete(target.publicKey);          // the one party this rotation is meant to evict
        const rotated = rotateGroupKeyResource({ previous: cur, recipients: recipientsWithController([...holders]) });
        return policy === 'ban' ? banFromHistory(rotated, { excludePubKey: target.publicKey, controllerPrivateKey: controllerKey.privateKey }) : rotated;
      });
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
