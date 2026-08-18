/**
 * surfaceGrants — the SURFACE role: a paired view/device's standing authority to act
 * through this agent's waist.
 *
 * A surface is not a circle member: it holds no roster row, signs no spine statements, and
 * appears in no fold. What it holds is a materialized role bundle — one signed
 * `CapabilityToken` per op the owner picked — and every act it sends is verified against
 * exactly those tokens at this agent's dispatch door (`surfaceRail.js`). The view's own code
 * is untrusted by construction: a modified view can SEND anything; nothing beyond its picks
 * VERIFIES here.
 *
 * Reuse, not a new subsystem: the bundle vocabulary is core's `defineRoleBundle` (the same
 * shape as the built-in admin bundle — "a role is a named bundle of capabilities"), the token
 * substrate is `materializeBundle` (the standalone half of `RoleGrantManager`, documented for
 * exactly this token-only use), and revocation is the same issuer-side set the role and task
 * grant managers keep. `RoleGrantManager` itself is not used because its other half is
 * circle governance (`GroupManager.setRole`) — a surface holds no governance role to set.
 *
 * The role rank sits below `observer`: a surface may act as the owner within its picks, but
 * it outranks nobody and can never be promoted into circle governance by rank comparison.
 *
 * Grant lifetime: a standing surface, so the default TTL is deliberately longer than the
 * role machinery's 24 h materialization default. Re-granting the same view revokes the
 * previous token set first (rotation for free, mirroring `RoleGrantManager.grant`).
 */
import { CapabilityToken, defineRoleBundle } from '@onderling/core';

/** The role id + its rank (between external 20 and observer 40). */
export const SURFACE_ROLE = 'surface';
const SURFACE_ROLE_RANK = 30;

/** Standing-surface default: 30 days. The owner re-grants (rotates) or revokes. */
export const SURFACE_GRANT_TTL_MS = 30 * 24 * 60 * 60 * 1000;

/**
 * Normalise a read grant — the SECTIONS a paired view may see ("what may this screen see?").
 * Default-strict on every axis: nothing listed → nothing matched.
 *   circles: string[] | '*'   which circles' entries the view's lane carries ('*' = all)
 *   kinds:   string[] | '*' | null   restrict to these entry kinds within those circles (null = all kinds)
 *   device:  boolean          whether DEVICE-scoped entries (no circle — settings changes etc.) are included
 * @returns {object|null} the frozen normalised reads, or null when nothing is granted
 */
export function normaliseReads(reads) {
  if (!reads || typeof reads !== 'object') return null;
  const circles = reads.circles === '*' ? '*'
    : Array.isArray(reads.circles) ? Object.freeze(reads.circles.filter((c) => typeof c === 'string' && c.length > 0)) : null;
  const kinds = reads.kinds === '*' || reads.kinds == null ? (reads.kinds ?? null)
    : Array.isArray(reads.kinds) ? Object.freeze(reads.kinds.filter((k) => typeof k === 'string' && k.length > 0)) : null;
  const device = reads.device === true;
  const empty = (!circles || (circles !== '*' && circles.length === 0)) && !device;
  return empty ? null : Object.freeze({ circles: circles ?? Object.freeze([]), kinds, device });
}

/**
 * Compile a normalised read grant into the mirror sink's entry predicate — the lane filter.
 * An entry's circle scope is its first-class `circleId` (falling back to the legacy payload
 * homes); an entry WITHOUT circle scope is device-scoped and matches only when the grant says
 * `device: true` — default-strict, an unscoped entry never leaks through a circle pick.
 */
export function compileReadFilter(reads) {
  const r = normaliseReads(reads);
  if (!r) return () => false;
  const circleSet = r.circles === '*' ? '*' : new Set(r.circles);
  const kindSet   = r.kinds == null || r.kinds === '*' ? null : new Set(r.kinds);
  return (entry) => {
    if (!entry) return false;
    if (kindSet && !kindSet.has(entry.kind ?? entry.type)) return false;
    const circleId = entry.circleId ?? entry.payload?.groupId ?? entry.groupId ?? null;
    if (circleId == null) return r.device;
    return circleSet === '*' || circleSet.has(circleId);
  };
}

/** The view's mirror lane id — path-safe, derived from its pubkey, distinct from device lanes. */
export function viewLaneId(viewPubKey) {
  return `view-${String(viewPubKey).replace(/[^a-zA-Z0-9]/g, '').slice(0, 16)}`;
}

/**
 * Compile a set of picked op ids into a surface role bundle. Op ids are the waist's skill
 * ids (`group.op`, e.g. `params.set-param`); `.*`-prefix and `*` scopes are accepted by the
 * token layer but a surface grant should name exact ops — the pick IS the boundary.
 *
 * @param {string[]} ops         picked skill ids (non-empty strings)
 * @param {object} [opts]
 * @param {string} [opts.actingAs]  the owner ref the surface acts as (stamped per template)
 * @param {string} [opts.label]     surface label, stamped into each token's constraints
 * @returns {object} a frozen role bundle for `materializeBundle`
 */
export function compileSurfaceBundle(ops, { actingAs, label } = {}) {
  if (!Array.isArray(ops) || ops.length === 0) {
    throw new Error('compileSurfaceBundle: ops must be a non-empty array of skill ids');
  }
  const grants = ops.map((op) => {
    if (typeof op !== 'string' || op.length === 0) {
      throw new Error('compileSurfaceBundle: every op must be a non-empty skill id');
    }
    return {
      skill: op,
      ...(actingAs ? { actingAs } : {}),
      ...(label ? { constraints: { surface: label } } : {}),
    };
  });
  // First call auto-registers the surface role at its rank; later calls validate against it.
  return defineRoleBundle({ id: SURFACE_ROLE, rank: SURFACE_ROLE_RANK, grants });
}

/**
 * The issuer-side grant registry for this agent's surfaces: mint, rotate, revoke, and answer
 * the revocation question the dispatch door asks per token.
 *
 * @param {object} a
 * @param {{pubKey: string, sign: Function}} a.identity  the granting identity (token issuer —
 *   the same identity whose pubKey the dispatch door trusts as issuer)
 * @param {string} [a.agentId]  the token `agentId` binding; defaults to identity.pubKey
 * @param {(viewPubKey: string) => void} [a.onReadGrantChange]  fired after any grant/revoke
 *   that changes a view's READ sections — the mirror side reconciles its view lanes on this
 * @param {{read:Function, write:Function}} [a.store]  DataSource-shaped durable home. WITHOUT it
 *   the registry is memory-only (test compositions); WITH it, revocation survives a restart —
 *   which it must, because nothing else in the door does. A surface token is signed by the
 *   device's stable identity and keeps verifying forever, so the revocation set is the ONLY
 *   thing standing between an unpaired view and the waist. An in-memory-only set means the
 *   next boot silently re-admits every view the owner ever unpaired.
 * @param {string} [a.uri]  where the registry is persisted
 */
export function createSurfaceGrants({ identity, agentId, onReadGrantChange, store = null, uri = 'mem://basis/surfaces.json' } = {}) {
  if (!identity || typeof identity.sign !== 'function') {
    throw new Error('createSurfaceGrants: a signing identity is required');
  }
  const boundAgentId = agentId ?? identity.pubKey;
  /** viewPubKey → { label, ops, tokens: [{id, expiresAt}], reads } */
  const granted = new Map();
  /** revoked tokens — the dispatch door consults this per act. id → expiresAt (for pruning). */
  const revoked = new Map();
  const readsChanged = (viewPubKey) => { try { onReadGrantChange?.(viewPubKey); } catch { /* observer only */ } };

  // FAIL CLOSED until the durable registry is loaded. Without this there is a window at every
  // boot — between the door being reachable and the registry arriving — in which a revoked
  // token verifies, and a race is not a thing to leave in a security gate. Memory-only
  // compositions have nothing to wait for, so they start ready.
  let ready = !store;
  let persisting = Promise.resolve();

  const snapshot = () => JSON.stringify({
    v: 1,
    granted: [...granted.entries()],
    revoked: [...revoked.entries()],
  });

  function persist() {
    if (!store) return persisting;
    persisting = persisting.then(async () => {
      try { await store.write(uri, snapshot()); }
      catch (err) { if (typeof console !== 'undefined') console.warn('[surface-grants] persist failed', err?.message ?? err); }
    });
    return persisting;
  }

  return {
    /**
     * Load the durable registry. Until this resolves the door refuses (see `isReady`) — the
     * boot kicks it, and expired revocations are dropped on the way in so the set cannot grow
     * without bound: once a token is past its own expiry, `CapabilityToken.verify` refuses it
     * anyway and remembering it buys nothing.
     */
    async hydrate({ now = Date.now } = {}) {
      if (!store) return true;
      try {
        const raw = await store.read(uri);
        const parsed = raw ? JSON.parse(typeof raw === 'string' ? raw : raw?.content ?? 'null') : null;
        if (parsed && parsed.v === 1) {
          const t = now();
          for (const [k, e] of parsed.granted ?? []) granted.set(k, e);
          for (const [id, expiresAt] of parsed.revoked ?? []) {
            if (!Number.isFinite(expiresAt) || expiresAt > t) revoked.set(id, expiresAt);
          }
        }
      } catch (err) {
        // A registry we cannot read is NOT an empty registry — staying closed is the only safe
        // reading of "I do not know what was revoked".
        if (typeof console !== 'undefined') console.warn('[surface-grants] registry unreadable — the door stays closed', err?.message ?? err);
        return false;
      }
      ready = true;
      return true;
    },

    /** Whether the durable registry has loaded. The door refuses while this is false. */
    isReady: () => ready,

    /**
     * Grant (or re-grant) a view: mint one token per picked op, revoking any previous set for
     * this view first.
     * @param {object} g
     * @param {string} g.viewPubKey   the view's public key (token subject)
     * @param {string[]} g.ops        picked skill ids
     * @param {string} [g.label]      display label for the surface
     * @param {number} [g.expiresIn=SURFACE_GRANT_TTL_MS]
     * @returns {Promise<{viewPubKey: string, label: string|null, ops: string[], tokens: object[]}>}
     */
    async grant({ viewPubKey, ops, reads = null, label = null, expiresIn = SURFACE_GRANT_TTL_MS } = {}) {
      if (typeof viewPubKey !== 'string' || viewPubKey.length === 0) {
        throw new Error('surfaceGrants.grant: viewPubKey required');
      }
      const bundle = compileSurfaceBundle(ops, { actingAs: identity.pubKey, label });
      const normReads = normaliseReads(reads);
      // Rotation: a re-grant invalidates the previous set before issuing the fresh one.
      const previous = granted.get(viewPubKey);
      if (previous) for (const t of previous.tokens ?? []) revoked.set(t.id, t.expiresAt);

      const tokens = [];
      for (const g of bundle.grants) {
        tokens.push(await CapabilityToken.issue(identity, {
          subject:   viewPubKey,
          agentId:   boundAgentId,
          skill:     g.skill,
          expiresIn,
          constraints: { role: SURFACE_ROLE, ...(g.actingAs ? { actingAs: g.actingAs } : {}), ...(g.constraints ?? {}) },
        }));
      }
      granted.set(viewPubKey, {
        label, ops: [...ops], reads: normReads,
        tokens: tokens.map((t) => ({ id: t.id, expiresAt: t.expiresAt })),
      });
      await persist();
      if (normReads || previous?.reads) readsChanged(viewPubKey);
      return { viewPubKey, label, ops: [...ops], reads: normReads, laneId: normReads ? viewLaneId(viewPubKey) : null, tokens: tokens.map((t) => t.toJSON()) };
    },

    /**
     * Revoke a view's standing: every token materialized for it stops verifying at the door,
     * even if the view still holds the blobs.
     * @returns {boolean} whether the view had a grant to revoke
     */
    revoke(viewPubKey) {
      const entry = granted.get(viewPubKey);
      if (!entry) return false;
      for (const t of entry.tokens ?? []) revoked.set(t.id, t.expiresAt);
      granted.delete(viewPubKey);
      persist();
      if (entry.reads) readsChanged(viewPubKey);
      return true;
    },

    /** The dispatch door's revocation question. */
    isRevoked(tokenId) { return revoked.has(tokenId); },

    /** Flush any pending write — for a caller that wants the revoke durable before replying. */
    flush: () => persisting,

    /** Current grants, for a settings surface: [{viewPubKey, label, ops, reads}]. */
    list() {
      return [...granted.entries()].map(([viewPubKey, e]) => ({ viewPubKey, label: e.label, ops: [...e.ops], reads: e.reads ?? null }));
    },

    /** The views holding a READ grant — what the mirror side reconciles its lanes against. */
    readGrants() {
      return [...granted.entries()]
        .filter(([, e]) => e.reads)
        .map(([viewPubKey, e]) => ({ viewPubKey, label: e.label, reads: e.reads, laneId: viewLaneId(viewPubKey) }));
    },
  };
}
