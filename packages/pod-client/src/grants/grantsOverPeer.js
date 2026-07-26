/**
 * grantsOverPeer — ONE grant surface over the single `Peer` (connectivity Phase 4 §4, Wave B tail).
 *
 * Out-of-circle share (recipient by roster OR network-key) and a task-scoped mandate (grantee = any
 * known `Peer`) resolve through ONE `grant`/`revoke` + the two read-side unifiers
 * `effectiveAudience` / `mayDecrypt`. This is a THIN façade — it composes the primitives that already
 * ship, adds NO new crypto (design: `plans/NOTE-grants-over-peer.md`, decisions D1–D7):
 *
 *   - **mandate (a skill scope, task-bound)** → `TaskGrantManager.attachGrant` ("authority travels with
 *     the task"; revoked on task complete/cancel). D5: attenuated from the granter's own authority.
 *   - **resource share, DEFAULT = broker (D1)** → a scoped `res.read:<id>` `PodCapabilityToken` the
 *     granter's device/companion honours; the KEY NEVER LEAVES, revoke is instant.
 *   - **resource share, OFFLINE opt-in (`policy.offline`)** → `resourceKeyGrant.issueGrant` (a per-resource
 *     CEK the grantee can open without the granter online); revoke = TokenRegistry (+ re-seal/rotate, step 3).
 *
 * Read-side unifiers:
 *   - `effectiveAudience(base, resourceId, {scheme|policy}) = base ∪ liveGrants(resourceId)` — EXTENDS the
 *     seal audience. D2 is **ENFORCED, not documented**: the caller must name the scheme the resource is
 *     sealed under, and `assertScopedScheme` admits ONLY the scoped ones (pairwise / per-resource-CEK).
 *     Group-key is refused by construction (widening it would hand one out-of-circle grantee the whole
 *     circle), and an absent scheme fails closed.
 *   - `mayDecrypt(peerPubKey, resourceId) = isMember ∨ holdsLiveGrant` — a member reads via the group key,
 *     a grantee via the released CEK / the broker; the gate falls out of which key material the peer obtains.
 *
 * D3 (registry): this holds the LOCAL grant registry (the out-of-circle-share-of-your-own-content path —
 * private to the granter). The governance-log grant event for a CIRCLE resource is a separate emitter the
 * host wires in step 3; this façade stays mechanism-only.
 *
 * LAYERING (invariant 5): lives at the pod-client (SDK) layer — it composes `@onderling/core`'s
 * `PodCapabilityToken` + `TaskGrantManager` + `TokenRegistry` with pod-client's `resourceKeyGrant` broker +
 * the seal grammar (`resourceScope`). No shell logic; the broker / task-manager / membership test are injected.
 */

import { PodCapabilityToken } from '@onderling/core';
import { resourceScope } from '../sealing/resourceKeyGrant.js';
import { SEAL_SCHEMES, chooseSealScheme } from '../sealing/sealResolver.js';

/** The two seal-backed schemes a resource grant may ride (D1). Mandate grants ride `TaskGrant` (a 3rd mode). */
export const GRANT_MODE = Object.freeze({ BROKER: 'broker', CEK: 'cek', MANDATE: 'mandate' });

/**
 * D2 (ENFORCED) — the ONLY seal schemes whose audience a grant may extend. Both are SCOPED: a pairwise
 * recipient set and a per-resource CEK each cover one datum/resource, so adding a grantee widens exactly
 * that resource. `group-key` is excluded BY CONSTRUCTION: its audience is the whole circle, so extending it
 * would hand an out-of-circle grantee every piece of circle content sealed under that key. `sealed-forward`
 * is a delivery scheme (a brokered hop), not an at-rest audience, so it is not extensible either.
 */
export const SCOPED_SEAL_SCHEMES = Object.freeze([SEAL_SCHEMES.PAIRWISE, SEAL_SCHEMES.PER_RESOURCE_CEK]);

/**
 * D2 gate — assert a seal scheme may have its audience extended by a grant. DENY-BY-DEFAULT: an absent /
 * unknown scheme throws rather than defaulting to "allowed", so a caller that forgets to say which scheme
 * it is sealing under cannot silently widen a group-key audience.
 *
 * @param {string|null|undefined} scheme  a `SEAL_SCHEMES` value.
 * @returns {string} the validated scheme.
 * @throws {Error} when the scheme is group-key, sealed-forward, unsealed (null), or missing.
 */
export function assertScopedScheme(scheme) {
  if (scheme === SEAL_SCHEMES.GROUP_KEY) {
    throw new Error(
      'grantsOverPeer: refusing to extend a GROUP-KEY audience (D2) — a grant would hand the grantee every '
      + 'piece of circle content sealed under that key. Seal the resource under a scoped scheme '
      + `(${SCOPED_SEAL_SCHEMES.join(' | ')}) and grant against that.`,
    );
  }
  if (scheme === SEAL_SCHEMES.SEALED_FORWARD) {
    throw new Error('grantsOverPeer: sealed-forward is a delivery scheme, not an at-rest audience — nothing to extend (D2)');
  }
  if (scheme == null) {
    throw new Error(
      'grantsOverPeer: no seal scheme resolved (unsealed p0/p1 content, or none supplied) — pass '
      + '{ scheme } or { policy } naming a scoped scheme (D2, deny-by-default)',
    );
  }
  if (!SCOPED_SEAL_SCHEMES.includes(scheme)) {
    throw new Error(`grantsOverPeer: unknown seal scheme "${scheme}" — a grant may only extend ${SCOPED_SEAL_SCHEMES.join(' | ')} (D2)`);
  }
  return scheme;
}

/**
 * D1 — pick the scheme for a RESOURCE grant from policy. Default = broker (least-authority: key stays home,
 * revoke instant). `policy.offline === true` opts into the per-resource CEK (offline-capable) path.
 * @param {{offline?: boolean}} [policy]
 * @returns {'broker'|'cek'}
 */
export function chooseGrantMode(policy = {}) {
  return policy?.offline === true ? GRANT_MODE.CEK : GRANT_MODE.BROKER;
}

/** Normalise a `Peer` (or a bare pubKey) to `{ pubKey, sealingPublicKey }`. */
function peerKeys(peer) {
  if (typeof peer === 'string') return { pubKey: peer, sealingPublicKey: null };
  const p = peer && typeof peer === 'object' ? peer : {};
  // Accept the Peer façade shape (`sealingKey`) and the roster shape (`sealingPublicKey`).
  return { pubKey: p.pubKey ?? p.circleAddress ?? null, sealingPublicKey: p.sealingPublicKey ?? p.sealingKey ?? null };
}

/**
 * Build the grant façade for ONE granter.
 *
 * @param {object} deps
 * @param {import('@onderling/core').AgentIdentity} deps.identity   the granter (token issuer).
 * @param {string|null} [deps.podRoot]        pod root URI for a broker-path `PodCapabilityToken`.
 * @param {object|null} [deps.resourceBroker] a `createResourceKeyGrant` broker (CEK path). Required for
 *                                            `policy.offline` grants; absent → an offline grant throws.
 * @param {import('@onderling/core').TaskGrantManager|null} [deps.taskGrants]  the mandate path. Required for
 *                                            skill/task grants; absent → a mandate grant throws.
 * @param {import('@onderling/core').TokenRegistry|null} [deps.tokenRegistry]  revocation sink (shared with the
 *                                            broker); `revoke()` marks a token revoked so future opens deny.
 * @param {(peerPubKey: string) => boolean} [deps.isMember]  circle membership — a member always `mayDecrypt`.
 * @param {Map<string, object>} [deps.grants]  the local grant registry (grantId → record). Injectable for tests.
 * @param {() => number} [deps.now]            clock (expiry checks); injectable for tests.
 * @param {(event: object) => any} [deps.onGrantEvent]  D3 — the governance/permission-log emitter, called ONLY
 *   for a grant against a CIRCLE resource (one issued with `{circleId}`); an out-of-circle share of the
 *   granter's OWN content stays private to the local registry. Injected from the composition root so this
 *   module stays transport-free (invariant 5); BEST-EFFORT — an emitter failure never fails the grant/revoke.
 *   The payload follows the existing `permission-log` convention (`{logKind, event, …}`).
 * @param {(resourceId: string) => (string|null|Promise<string|null>)} [deps.readSealed]  D4 — read a resource's
 *   CURRENT sealed body, for revoke→rotate. With `writeSealed`, a CEK revoke re-seals under a fresh key.
 * @param {(resourceId: string, sealed: string) => any} [deps.writeSealed]  D4 — persist the re-sealed body.
 */
export function createGrantsOverPeer({
  identity,
  podRoot = null,
  resourceBroker = null,
  taskGrants = null,
  tokenRegistry = null,
  isMember = () => false,
  grants = new Map(),
  now = () => Date.now(),
  onGrantEvent = null,
  readSealed = null,
  writeSealed = null,
} = {}) {
  if (!identity || typeof identity.pubKey !== 'string') {
    throw new Error('createGrantsOverPeer: identity (the granter) is required');
  }

  function record(id, rec) { grants.set(id, { grantId: id, ...rec }); }

  /**
   * D3 — emit the governance/permission-log event for a CIRCLE-resource grant. A grant carrying no
   * `circleId` is an out-of-circle share of the granter's own content: it stays in the local registry and
   * emits NOTHING (their call, nobody else's business). Best-effort by design — the grant has already
   * landed, so a logging hiccup must never fail it or be reported as failure.
   */
  async function emitGrantEvent(kind, rec) {
    if (typeof onGrantEvent !== 'function' || !rec?.circleId) return;
    try {
      await onGrantEvent({
        logKind: kind,                       // 'resource-granted' | 'resource-revoked'
        event:   kind,
        circleId: rec.circleId,
        resourceId: rec.resourceId ?? rec.scope ?? null,
        scope:    rec.scope ?? null,
        peer:     rec.peerPubKey ?? null,
        mode:     rec.mode ?? null,
        grantId:  rec.grantId ?? null,
        by:       identity.pubKey,
        ...(rec.expiresAt != null ? { expiresAt: rec.expiresAt } : {}),
      });
    } catch { /* best-effort — never fails the grant/revoke */ }
  }

  /** Live (not expired, not revoked-and-dropped) grants for a resource. */
  function liveGrants(resourceId) {
    const t = now();
    const out = [];
    for (const rec of grants.values()) {
      if (rec.resourceId !== resourceId) continue;
      if (rec.expiresAt != null && rec.expiresAt <= t) continue;
      out.push(rec);
    }
    return out;
  }

  /**
   * Issue a grant to a `Peer`. D5: a grant can never exceed the granter's own reach — the underlying
   * primitives enforce attenuation (TaskGrant `verifyChain`; a resource grant is issued FROM the granter's
   * own custody). Records the grant locally (D3 own-content path).
   *
   * @param {object|string} peer  the grantee `Peer` (or bare pubKey).
   * @param {string} scope         a resource id (resource grant) or a skill id (mandate).
   * @param {object} [opts]
   * @param {'resource'|'skill'} [opts.kind='resource']
   * @param {{offline?: boolean}} [opts.policy]  D1 scheme selector for a resource grant.
   * @param {string} [opts.task]    task id — REQUIRED for a `skill` (mandate) grant.
   * @param {string} [opts.circleId]  D3 — set when the scope is a CIRCLE resource: the grant is then also
   *   emitted to the governance/permission log (co-admins see it). Omit for an out-of-circle share of the
   *   granter's own content, which stays private to the local registry.
   * @param {number} [opts.expiresIn]
   * @returns {Promise<{grantId: string, token: object, mode: string}>}
   */
  async function grant(peer, scope, { kind = 'resource', policy = {}, task, circleId = null, expiresIn } = {}) {
    const { pubKey, sealingPublicKey } = peerKeys(peer);
    if (!pubKey) throw new Error('grant: a grantee pubKey is required');
    if (typeof scope !== 'string' || !scope) throw new Error('grant: a scope (resource id or skill id) is required');

    if (kind === 'skill') {
      // Mandate — authority travels with the task (TaskGrant). Task-bound so it auto-revokes on complete/cancel.
      if (!taskGrants) throw new Error('grant: a TaskGrantManager is required for a skill (mandate) grant');
      if (!task) throw new Error('grant: a task id is required for a skill (mandate) grant');
      const token = await taskGrants.attachGrant({
        taskId: task, memberPubKey: pubKey, grant: { skill: scope },
        ...(expiresIn != null ? { expiresIn } : {}),
      });
      record(token.id, { peerPubKey: pubKey, sealingPublicKey, kind, scope, mode: GRANT_MODE.MANDATE, task, circleId, expiresAt: token.expiresAt ?? null });
      await emitGrantEvent('resource-granted', grants.get(token.id));
      return { grantId: token.id, token, mode: GRANT_MODE.MANDATE };
    }

    // Resource grant — D1 chooses the scheme by policy.
    const resourceId = scope;
    const mode = chooseGrantMode(policy);
    let token;
    if (mode === GRANT_MODE.CEK) {
      if (!resourceBroker || typeof resourceBroker.issueGrant !== 'function') {
        throw new Error('grant: a resourceKeyGrant broker is required for an offline (CEK) grant');
      }
      token = await resourceBroker.issueGrant({ subject: pubKey, resourceId, ...(expiresIn != null ? { expiresIn } : {}) });
    } else {
      if (!podRoot) throw new Error('grant: podRoot is required for a broker grant');
      token = await PodCapabilityToken.issue(identity, {
        subject: pubKey, pod: podRoot, scopes: [resourceScope(resourceId)],
        ...(expiresIn != null ? { expiresIn } : {}),
      });
    }
    record(token.id, { peerPubKey: pubKey, sealingPublicKey, kind, scope: resourceId, resourceId, mode, task, circleId, expiresAt: token.expiresAt ?? null });
    await emitGrantEvent('resource-granted', grants.get(token.id));
    return { grantId: token.id, token, mode };
  }

  /**
   * Revoke a grant by id, or every grant of a task. D4: broker-backed → the token is marked revoked so a
   * future open/releaseKey denies (instant, nothing to rotate); CEK-backed → same registry revoke here, plus
   * the resource re-seal/rotate is the step-3 addition (a released CEK can't be un-seen). Drops the local row.
   *
   * D4 — a CEK-backed revoke also ROTATES when `readSealed`/`writeSealed` are wired: the resource is
   * re-sealed under a fresh CEK, because a grantee who already fetched the old key cannot be made to
   * un-see it (the same honesty as the circle's ban→rotate). Still-live grantees pick the new key up on
   * their next `releaseKey`; the revoked one is denied. Without those seams the revoke is registry-only —
   * honest, but future-access-only — and that is reported back as `rotated: false`.
   *
   * @param {string | {grantId?: string, task?: string}} arg
   * @returns {Promise<{revoked: string[], rotated: boolean}>}
   */
  async function revoke(arg) {
    if (arg && typeof arg === 'object' && arg.task) {
      const res = taskGrants?.revokeTaskGrants(arg.task) ?? { revokedTokenIds: [] };
      const dropped = [];
      for (const [id, rec] of grants) if (rec.task === arg.task) { dropped.push(rec); grants.delete(id); }
      for (const rec of dropped) await emitGrantEvent('resource-revoked', rec);
      return { revoked: res.revokedTokenIds ?? [], rotated: false };
    }
    const grantId = typeof arg === 'string' ? arg : arg?.grantId;
    if (!grantId) throw new Error('revoke: a grantId or { task } is required');
    const rec = grants.get(grantId);
    if (tokenRegistry) await tokenRegistry.revoke(grantId);

    let rotated = false;
    if (rec?.mode === GRANT_MODE.CEK && resourceBroker) {
      if (typeof resourceBroker.revoke === 'function') {
        try { await resourceBroker.revoke({ tokenId: grantId, resourceId: rec.resourceId }); } catch { /* registry revoke already denies */ }
      }
      // D4 rotate — re-seal under a fresh CEK so the revoked holder's copy of the old key opens only what
      // they already had. Requires both seams; a rotation failure must NOT undo the revocation above, so it
      // is caught and reported as `rotated: false` rather than thrown.
      if (typeof readSealed === 'function' && typeof writeSealed === 'function'
          && typeof resourceBroker.rotateResource === 'function' && rec.resourceId) {
        try {
          const sealed = await readSealed(rec.resourceId);
          if (typeof sealed === 'string' && sealed) {
            const next = resourceBroker.rotateResource(rec.resourceId, { sealed });
            await writeSealed(rec.resourceId, next.sealed);
            rotated = true;
          }
        } catch { rotated = false; }
      }
    }
    grants.delete(grantId);
    if (rec) await emitGrantEvent('resource-revoked', rec);
    return { revoked: [grantId], rotated };
  }

  /**
   * Seal-side unifier — EXTEND a scoped-resource audience with the resource's live grantees. Returns a new
   * array of `{ pubKey, sealingPublicKey }` peer descriptors, deduped by pubKey.
   *
   * D2 is ENFORCED here, not merely documented: the caller must name the scheme the resource is sealed
   * under — either explicitly (`{ scheme }`) or via the one resolver (`{ policy }` → `chooseSealScheme`) —
   * and `assertScopedScheme` throws unless it is pairwise or per-resource-CEK. A group-key audience can
   * therefore never be widened by a grant, and a caller who omits the scheme fails closed rather than
   * silently widening one.
   *
   * @param {Array<object|string>} baseAudience  the scoped-resource base recipients.
   * @param {string} resourceId
   * @param {object} opts
   * @param {string} [opts.scheme]  a `SEAL_SCHEMES` value (wins over `policy`).
   * @param {object} [opts.policy]  a seal policy, resolved via `chooseSealScheme`.
   * @returns {Array<{pubKey: string, sealingPublicKey: string|null}>}
   * @throws {Error} when the resolved scheme is not a scoped one (D2).
   */
  function effectiveAudience(baseAudience, resourceId, { scheme, policy } = {}) {
    assertScopedScheme(scheme ?? (policy !== undefined ? chooseSealScheme(policy) : null));
    const out = [];
    const seen = new Set();
    for (const a of Array.isArray(baseAudience) ? baseAudience : []) {
      const { pubKey, sealingPublicKey } = peerKeys(a);
      if (!pubKey || seen.has(pubKey)) continue;
      seen.add(pubKey);
      out.push({ pubKey, sealingPublicKey });
    }
    for (const rec of liveGrants(resourceId)) {
      if (!rec.peerPubKey || seen.has(rec.peerPubKey)) continue;
      seen.add(rec.peerPubKey);
      out.push({ pubKey: rec.peerPubKey, sealingPublicKey: rec.sealingPublicKey ?? null });
    }
    return out;
  }

  /**
   * Seal-side unifier in SEALING-KEY space — the same union as `effectiveAudience`, but over raw X25519
   * sealing public keys, which is the vocabulary the per-resource group-key resource speaks
   * (`groupKeyResource.recipients`, `grantMember({currentRecipients})`). Same D2 gate.
   *
   * WHY THIS EXISTS: `grantMember` REPLACES the recipient set with `[...currentRecipients, newRecipient]`.
   * A caller that passes only the origin roster therefore DROPS every previously-granted out-of-circle
   * recipient on the next grant (proven: they can no longer unwrap). Passing
   * `effectiveSealingKeys(roster ∪ resource.recipients, resourceId)` keeps prior grantees by construction.
   *
   * @param {Array<string|object>} baseKeys  raw sealing pubkeys (or peer descriptors — `sealingPublicKey` is read).
   * @param {string} resourceId
   * @param {{scheme?: string, policy?: object}} opts  D2 — required, as for `effectiveAudience`.
   * @returns {string[]} deduped sealing public keys.
   */
  function effectiveSealingKeys(baseKeys, resourceId, { scheme, policy } = {}) {
    assertScopedScheme(scheme ?? (policy !== undefined ? chooseSealScheme(policy) : null));
    const out = [];
    const seen = new Set();
    const add = (k) => { if (typeof k === 'string' && k && !seen.has(k)) { seen.add(k); out.push(k); } };
    for (const b of Array.isArray(baseKeys) ? baseKeys : []) {
      add(typeof b === 'string' ? b : (b?.sealingPublicKey ?? b?.sealingKey ?? null));
    }
    for (const rec of liveGrants(resourceId)) add(rec.sealingPublicKey);
    return out;
  }

  /**
   * Read-side gate — may this peer decrypt this resource? A member reads via the group key; a non-member
   * reads iff they hold a live grant covering the resource.
   * @param {string} peerPubKey
   * @param {string} resourceId
   * @returns {boolean}
   */
  function mayDecrypt(peerPubKey, resourceId) {
    if (peerPubKey && isMember(peerPubKey)) return true;
    return liveGrants(resourceId).some((r) => r.peerPubKey === peerPubKey);
  }

  return { grant, revoke, effectiveAudience, effectiveSealingKeys, mayDecrypt, liveGrants, GRANT_MODE, SCOPED_SEAL_SCHEMES };
}

export default createGrantsOverPeer;
