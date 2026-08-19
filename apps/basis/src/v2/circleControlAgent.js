/**
 * circleControlAgent — compose a per-circle sealed-pod control agent (S4, pod
 * foundation; the SAFE offline-testable slice of REMAINING-WORK §4 E2).
 *
 * Wires the sealing substrate into a single per-circle producer: a pod key
 * store (holds the versioned, recipient-wrapped group key) + a control agent that
 * grants/revokes pod ACL AND rotates the group key on membership change (forward
 * secrecy on leave). The `podClient` + `sharing` are INJECTED, so this is fully
 * unit-testable with an in-memory pod + mock sharing (no real Solid pod, no OIDC).
 *
 * Scope (deliberate): this constructs + drives the control agent and resolves the
 * content-sealing strategy; it does NOT yet restructure basis's single
 * shared stoop agent into per-circle agents, nor wire a real OIDC pod session —
 * those are the env-gated / restructuring phases that need a real pod to verify.
 * p0/p1 circles seal nothing → this returns `null` (the caller uses a plain client).
 */
import {
  createControlAgent, createPodKeyStore, resolveCircleStorage, readGroupKey,
} from '@onderling/pod-client';

const SEALED_POSTURES = new Set(['p2', 'p3']);

/**
 * @param {object} deps
 * @param {string} deps.circleId
 * @param {'p0'|'p1'|'p2'|'p3'} [deps.storagePosture]  from `circlePolicy.storagePosture`.
 * @param {{ read: Function, write: Function }} [deps.podClient]  a PodClient (real or in-memory).
 * @param {{ grant: Function, revoke: Function }} [deps.sharing]  pod ACL grant/revoke (real or mock).
 * @param {{ publicKey: string, privateKey: string }} [deps.controllerKey]  the agent's sealing keypair.
 * @param {string} [deps.circleRootUri]   the circle's pod container root (default a mem:// uri).
 * @param {Array<{ webId: string, publicKey: string, role?: string }>} [deps.roster]  initial members.
 * @param {{ append: (event:object) => any }} [deps.keyEventLog]  optional no-pod distribution sink — when
 *   present, every key establish/grant/rotation ALSO emits the versioned key AS a log key-event (fanned to
 *   the then-current members, self-distributing with no pod). The pod key resource is still written
 *   (defence-in-depth); the LOG is the source for a no-pod circle. Absent → pod-only, unchanged.
 * @returns {object|null}  the control-agent facade, or `null` for an unsealed (p0/p1) circle.
 */
export function createCircleControlAgent({
  circleId,
  storagePosture = 'p0',
  podClient,
  sharing,
  controllerKey,
  circleRootUri,
  roster = [],
  keyEventLog = null,
} = {}) {
  if (!circleId) throw new Error('createCircleControlAgent: circleId is required');
  if (!SEALED_POSTURES.has(storagePosture)) return null;   // p0/p1 → no sealing, no control agent
  if (!podClient || !sharing || !controllerKey) {
    throw new Error('createCircleControlAgent: podClient, sharing, controllerKey are required for a sealed (p2/p3) circle');
  }

  const root = (circleRootUri ?? `mem://circle/${circleId}`).replace(/\/$/, '');
  const keyStore = createPodKeyStore({ podClient, uri: `${root}/.keys/group.json` });
  const agent = createControlAgent({
    sharing,
    // Grant members access to the WHOLE circle container — they need to read both
    // the per-recipient-wrapped group key (`${root}/.keys/`) AND the sealed content
    // (everything's encrypted, so a shared READ is safe) for true multi-device.
    containerUri: `${root}/`,
    keyStore,
    controllerKey,
    modes: ['read', 'write'],
    roster,
    // No-pod distribution: when a sink is injected, the control-agent fans each versioned key AS a
    // log key-event to the then-current members (the departed excluded on a rotation → backward
    // secrecy). `groupId` = the circle id, so a member folds only this circle's events.
    keyEventLog,
    groupId: circleId,
  });

  return {
    circleId,
    storagePosture,
    circleRootUri: root,
    agent,
    keyStore,
    bootstrap:    () => agent.bootstrap(),
    addMember:    (m) => agent.addMember(m),
    removeMember: (m) => agent.removeMember(m),
    members:      () => agent.members(),

    /**
     * Resolve the circle's CONTENT seal/open strategy once the caller's group key
     * is unwrappable (the member is a current recipient). Throws if revoked / not a
     * recipient (the group key was rotated away from them). Returns null when the
     * circle hasn't been bootstrapped yet (no key resource) — the caller then falls
     * back to a plain client rather than sealing with missing material.
     *
     * The group-key resource is the AUTHORISATION gate for BOTH sealed postures: a
     * member proves current membership by unwrapping it (a revoked/never-granted key
     * throws → the caller sees null, never plaintext). The resolved strategy then
     * differs by posture:
     *   • p2 — GROUP-KEY seal: content is encrypted under the shared `groupKey`.
     *   • p3 — RECIPIENT seal: content is sealed directly to the CURRENT roster's
     *          public keys (writer is host-blind) + opened with the member's own key.
     *          Recipients = every current member + the controller, taken from the
     *          control-agent roster so a p3 writer seals to exactly who can read.
     *
     * ── CROSS-VERSION READER (Phase 3, wired 2026-07-08 per Frits' call) ────────────
     * p2 content sealed under an OLDER key version (before a rotation the member lived
     * through) now opens too. The `readGroupKey` call above is the membership GATE — a
     * revoked/never member THROWS there, so DROP-OUTS get NO access, historic or
     * otherwise ("no historic access for drop-outs"). A CURRENT member then gets the
     * cross-version strategy over the retained key RESOURCE
     * (`resolveCircleStorage({ posture: 'p2', resource, privateKey })` →
     * `groupKeyStrategy({ resource, privateKey })`), which opens every version the member
     * can unwrap and seals under the current one — forward secrecy preserved (a drop-out
     * never reaches it). The access contract for revoked/never is UNCHANGED (still the
     * gate's throw), so gating on current membership adds historic-read WITHOUT flipping
     * the revoked/never security assertions.
     *
     * @param {string} privateKey  the member's sealing private key.
     * @returns {Promise<{ seal: Function, open: Function } | null>}
     */
    async sealingStrategy(privateKey) {
      const groupKey = await readGroupKey({ keyStore, privateKey });
      if (groupKey == null) return null;   // not bootstrapped → plain client (no seal with missing key)
      if (storagePosture === 'p3') {
        // Content is recipient-sealed, not group-key-sealed: gather the current roster's
        // public keys (+ the controller, always a recipient) so a writer seals to all
        // members. `groupKey` above only served as the membership gate (already passed).
        const recipients = [...new Set([
          ...agent.members().map((m) => m.publicKey),
          controllerKey.publicKey,
        ].filter(Boolean))];
        return resolveCircleStorage({ posture: 'p3', recipients, privateKey });
      }
      // p2: the caller passed the readGroupKey membership gate above (a revoked/never member THROWS
      // there → NO access, historic or otherwise — "no historic access for drop-outs"). A CURRENT
      // member gets the CROSS-VERSION reader over the retained key resource, so they can open p2
      // content sealed under an OLDER version they lived through; seal still writes the current version.
      // A drop-out never reaches this line, so forward secrecy holds and no revoked/never assertion flips.
      const resource = await keyStore.read();
      return resolveCircleStorage({ posture: storagePosture, resource, privateKey });
    },
  };
}
