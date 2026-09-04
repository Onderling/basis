/**
 * basis v2 — per-circle pod producer (S4 pod foundation, the structural slice).
 *
 * REMAINING-WORK §4 E2's blocker was: "basis builds one shared stoop agent,
 * not per-circle; nothing detects storagePosture ∈ {p2,p3}, creates member sealing
 * identities, instantiates createControlAgent, or wraps the circle pod-client." This
 * is that producer: for ONE circle it composes the S4 sealing substrate into a
 * per-circle storage producer —
 *   • a per-circle X25519 sealing identity (always, vault-backed), and
 *   • for a SEALED posture (p2/p3): a per-circle control agent over the circle's
 *     pod-client — bootstrapped, holding the recipient-wrapped group key, ready to
 *     grant/seal on join and revoke/rotate on leave (forward secrecy).
 *
 * It's the per-SCOPE producer that lives OUTSIDE the single stoop agent (one agent
 * per service-context; per-scope state outside — CLAUDE.md invariant #6). The app
 * keeps one of these per open circle, keyed by circle id.
 *
 * Deps are INJECTED (no hard `@onderling/pod-client` / `@onderling/pseudo-pod` import) so
 * this module stays portable for Metro/RN and unit-testable: the web host passes a
 * `makePodClient` that builds an in-memory pseudo-pod client (real per-circle sealed
 * storage in the browser, NO OIDC/CSS) — a real Solid pod-client is the env-gated
 * swap later. p0/p1 circles seal nothing → `controlAgent` is null (plain storage).
 */
import { createCircleSealingIdentity } from './circleSealingIdentity.js';
import { createCircleControlAgent } from './circleControlAgent.js';

const SEALED_POSTURES = new Set(['p2', 'p3']);

/** A no-op ACL sharing: an in-memory pseudo-pod has no ACL layer; real grant/revoke is env-gated. */
function memorySharing() {
  return { grant: async () => {}, revoke: async () => {} };
}

/**
 * @param {object} deps
 * @param {string} deps.circleId
 * @param {'p0'|'p1'|'p2'|'p3'} [deps.storagePosture]      from `circlePolicy.storagePosture`.
 * @param {{ get: Function, set: Function }} deps.vault     the app's key/value vault.
 * @param {Array<{webId:string, publicKey:string, role?:string}>} [deps.roster]  initial members.
 * @param {() => {publicKey:string, privateKey:string}} [deps.generateKeypair]  REQUIRED for p2/p3.
 * @param {(circleId:string) => {read:Function, write:Function}} [deps.makePodClient]  REQUIRED for p2/p3.
 * @param {{grant:Function, revoke:Function}} [deps.sharing]  ACL (defaults to a memory no-op).
 * @param {boolean} [deps.bootstrap=true]  bootstrap the control agent's key resource immediately.
 * @param {{ append: (event:object) => any }} [deps.keyEventLog]  optional no-pod distribution sink — passed
 *   through to the control agent so every establish/grant/rotation ALSO fans the versioned key AS a log
 *   key-event to the then-current members (self-distributing with no pod). Absent → pod-only, unchanged.
 * @param {string} [deps.controllerKeyPrefix]
 * @returns {Promise<{circleId, storagePosture, sealingIdentity, controlAgent:(object|null), podClient:(object|null), circleRootUri:(string|null)}>}
 */
export async function createCirclePodProducer({
  circleId,
  storagePosture = 'p0',
  vault,
  roster = [],
  generateKeypair,
  makePodClient,
  circleRootUri,
  sharing,
  bootstrap = true,
  keyEventLog = null,
  sealingKeyPair = null,
  controllerKeyPrefix = 'cc.circle-controller-key',
  groupKeyPrefix = 'cc.circle-groupkey',
} = {}) {
  if (!circleId) throw new Error('createCirclePodProducer: circleId is required');
  if (!vault || typeof vault.get !== 'function' || typeof vault.set !== 'function') {
    throw new Error('createCirclePodProducer: a vault with get/set is required');
  }

  // p0/p1 → no client-side seal, no control agent, NO sealing identity (a plaintext
  // circle never becomes a recipient). Skipping it keeps this path crypto-free, so it
  // runs in the browser where the sealing primitives (x25519/HKDF) are deliberately
  // stubbed — see the sealed branch below.
  if (!SEALED_POSTURES.has(storagePosture)) {
    return { circleId, storagePosture, sealingIdentity: null, controlAgent: null, podClient: null, circleRootUri: null, persist: async () => {} };
  }

  // Sealed (p2/p3): a per-circle sealing identity (two circles never share one).
  // The sealing keygen is tweetnacl (`nacl.box.keyPair`) + @noble hashes — pure JS, no
  // node:crypto — so this branch is browser- and React-Native-safe: both shells inject the
  // same `generateKeypair` from @onderling/pod-client, and the real sealer pair runs under
  // happy-dom in mediaEmbed.test.js. The producer itself is proven in Node
  // (circlePodProducer.test.js) and composed live by the web media gateway; no browser-env
  // test covers the PRODUCER yet — that is the honest remaining gap, not the crypto.
  // (An earlier comment here said the keygen was node:crypto and "not yet in the browser";
  // that was true once and had gone stale — it misled a trace on 2026-09-02.)
  // ONE sealing key family (2026-09-04): the device's sealing keypair is the ed2curve image of its
  // per-circle ADDRESS key, handed in by the agent (`circleSealingKeyPairFor`). Every grant in the
  // circle already wraps to `sealingPublicKeyFromNetworkKey(address)`; opening with anything else
  // meant a member's own group key was wrapped to a key it did not hold. The random per-circle vault
  // identity remains only for a host with no agent (the producer's own tests).
  const sealingIdentity = (sealingKeyPair?.publicKey && sealingKeyPair?.privateKey)
    ? {
      ensure: async () => sealingKeyPair,
      publicKey: async () => sealingKeyPair.publicKey,
      rosterEntry: async (webId, role = 'member') => ({ webId: String(webId), publicKey: sealingKeyPair.publicKey, role }),
    }
    : createCircleSealingIdentity({ circleId, store: vault });
  const selfKey = await sealingIdentity.ensure();   // {publicKey, privateKey}
  if (typeof generateKeypair !== 'function' || typeof makePodClient !== 'function') {
    throw new Error('createCirclePodProducer: a sealed (p2/p3) circle needs generateKeypair + makePodClient');
  }

  // Per-circle controller keypair, persisted so the group key stays unwrappable for
  // THIS agent across reloads (the in-memory pod's group key itself is ephemeral; a
  // persistent backend / real pod is the durability follow-up).
  const ckKey = `${controllerKeyPrefix}:${circleId}`;
  let controllerKey = null;
  const stored = await vault.get(ckKey);
  if (stored) { try { controllerKey = JSON.parse(stored); } catch { controllerKey = null; } }
  if (!controllerKey?.publicKey || !controllerKey?.privateKey) {
    controllerKey = generateKeypair();
    await vault.set(ckKey, JSON.stringify(controllerKey));
  }

  const podClient = await makePodClient(circleId);
  // The circle's container: an in-memory pseudo-pod by default, or a REAL Solid-pod container
  // URI (e.g. `<podRoot>/circles/<id>`) when the host passes one with a real-pod makePodClient.
  const root = (circleRootUri ?? `pseudo-pod://circle-${circleId}/circle`).replace(/\/$/, '');
  const keyResourceUri = `${root}/.keys/group.json`;
  const groupKeyVaultKey = `${groupKeyPrefix}:${circleId}`;

  // DURABILITY — the per-circle pod is an EPHEMERAL pseudo-pod (its group-key resource
  // dies on reload), but the controller key + sealing identity persist in the vault. So
  // persist the group-key resource to the vault too: RESTORE it into the fresh pod BEFORE
  // bootstrap (which then finds it + no-ops, keeping the SAME group key), and SAVE it after.
  // Result: a sealed circle's group key survives a reload, so previously-sealed content
  // (the posts live in the durable stoop store) stays decryptable. Use a durable vault
  // (VaultIndexedDB on web, VaultAsyncStorage on mobile) for cross-session durability.
  const savedRes = await vault.get(groupKeyVaultKey);
  if (savedRes) {
    try { await podClient.write(keyResourceUri, savedRes, { contentType: 'application/json' }); } catch { /* fresh-bootstrap below */ }
  }

  // Include THIS device's own per-circle sealing identity in the bootstrap roster, so the
  // local member is a recipient of the group key and can seal/open the circle's content
  // (otherwise only the abstract controller key could). Dedupe by publicKey.
  const selfEntry = { webId: `circle:${circleId}:self`, publicKey: selfKey.publicKey, role: 'member' };
  const fullRoster = roster.some((m) => m?.publicKey === selfKey.publicKey) ? roster : [...roster, selfEntry];
  const controlAgent = createCircleControlAgent({
    circleId, storagePosture, podClient,
    sharing: sharing ?? memorySharing(),
    controllerKey, circleRootUri: root, roster: fullRoster,
    // No-pod distribution: the control agent fans every versioned key AS a log key-event through this
    // sink (rotation on remove → fanned to the REMAINING members only, backward secrecy). Absent → pod-only.
    keyEventLog,
  });

  /** Save the pod's current group-key resource to the vault (call after bootstrap + each membership change). */
  async function persistGroupKey() {
    try {
      const r = await podClient.read(keyResourceUri, { decode: 'text' });
      const body = typeof r === 'string' ? r : r?.content;
      if (body != null) await vault.set(groupKeyVaultKey, typeof body === 'object' ? JSON.stringify(body) : String(body));
    } catch { /* best-effort */ }
  }

  if (bootstrap && controlAgent) { await controlAgent.bootstrap(); await persistGroupKey(); }

  return { circleId, storagePosture, sealingIdentity, controlAgent, podClient, circleRootUri: root, persist: persistGroupKey };
}

/**
 * A control-agent ROUTER for the single stoop agent: stoop fires one `controlAgent`'s
 * `addMember`/`removeMember` on every membership event (carrying `groupId`), and this
 * routes each to the matching per-circle producer's control agent + persists the rotated
 * group key. This is how MULTI-member sealed circles grow: redeem → the joiner's sealing
 * public key is wrapped into that circle's group key; leave → revoked + rotated. One stoop
 * agent, N per-circle control agents (CLAUDE.md invariant #6).
 *
 * @param {(circleId:string) => (object|Promise<object|null>)} getProducer  resolve a circle's producer.
 * @returns {{ addMember: Function, removeMember: Function }}
 */
export function createCircleControlAgentRouter(getProducer) {
  // Best-effort, and LOUD when it fails. Sealing degrading gracefully is the intended posture — a
  // membership event must not fail because a circle's pod is unreachable. But this catch sat between
  // the caller and every key operation, so a control-agent that threw looked exactly like one that
  // succeeded: the join/leave returned ok and nothing anywhere said the group key had not moved. It
  // also swallowed the throw BEFORE the callers' own reporting could see it, which is why a warning
  // belongs here and not only there. `what` names the operation that did not reach the key.
  const route = async (groupId, fn, what) => {
    if (!groupId || typeof getProducer !== 'function') return;
    const prod = await getProducer(groupId);
    if (!prod?.controlAgent) return;                 // circle not sealed / producer not live → no-op
    try { await fn(prod.controlAgent); await prod.persist?.(); }
    catch (err) {
      console.warn(
        `[circlePods] ${what} did not reach circle ${groupId}'s group key → the key audience is unchanged:`,
        err?.message ?? err,
      );
    }
  };
  return {
    async addMember({ webId, publicKey, role, groupId }) {
      if (!webId || !publicKey) return;
      await route(groupId, (ca) => ca.addMember({ webId, publicKey, role }), `granting ${webId}`);
    },
    async removeMember({ webId, force, policy, groupId }) {
      if (!webId) return;
      await route(groupId, (ca) => ca.removeMember({ webId, force, policy }), `revoking ${webId}`);
    },
    // Device-grained audience surgery (the custody arc): the member stays; one of their devices'
    // sealing keys joins or leaves the group key's audience.
    async grantRecipient({ publicKey, groupId }) {
      if (!publicKey) return;
      await route(groupId, (ca) => ca.grantRecipient?.({ publicKey }), 'enrolling a device');
    },
    async revokeRecipient({ publicKey, policy, groupId }) {
      if (!publicKey) return;
      await route(groupId, (ca) => ca.revokeRecipient?.({ publicKey, policy }), 'revoking a device');
    },
  };
}

/**
 * Seed a sealed circle's group-key roster with members who joined BEFORE its producer was
 * live: list the circle's members and route each through the control-agent router so the group
 * key is wrapped to them too. Idempotent-ish (re-wrapping an existing recipient is harmless).
 * Best-effort; needs a live producer for `circleId` in the router.
 *
 * A roster row carries `sealingPublicKey` only when the joiner supplied one at redemption, which
 * the live join flow does not — so this used to wrap the key for nobody and seed an empty roster.
 * The sealing key is a deterministic function of the member's network key, so `deriveSealingKey`
 * is INJECTED (the same shape `recipientAddrsFromRoster` and `shareRecipients` use) and fills in
 * whenever the row has none.
 *
 * @param {{ callSkill:Function, circleId:string, router:{addMember:Function},
 *          deriveSealingKey?:(networkKey:string)=>string }} a
 * @returns {Promise<number>} how many members were (re)wrapped.
 */
export async function seedCircleRoster({ callSkill, circleId, router, deriveSealingKey = null } = {}) {
  if (typeof callSkill !== 'function' || !circleId || typeof router?.addMember !== 'function') return 0;
  let members = [];
  try {
    const res = await callSkill('stoop', 'listGroupMembers', { groupId: circleId });
    members = Array.isArray(res?.members) ? res.members : [];
  } catch { return 0; }
  let n = 0;
  for (const m of members) {
    if (!m?.webid) continue;
    let publicKey = m.sealingPublicKey ?? m.sealingPubKey ?? null;
    if (!publicKey && typeof deriveSealingKey === 'function') {
      const net = m.circleAddress ?? m.pubKey ?? m.webid;
      try { publicKey = net ? deriveSealingKey(net) : null; } catch { publicKey = null; }
    }
    if (!publicKey) continue;
    try { await router.addMember({ webId: m.webid, publicKey, role: m.role, groupId: circleId }); n += 1; }
    catch { /* best-effort per member */ }
  }
  return n;
}
