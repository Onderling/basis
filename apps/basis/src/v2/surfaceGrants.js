/**
 * surfaceGrants — the SURFACE role: a paired view/device's standing authority to act
 * through this agent's waist.
 *
 * A surface is not a circle member: it holds no roster row, signs no spine statements, and
 * appears in no fold. What it holds is a materialized role bundle — one signed
 * `CapabilityToken` per op the owner picked — and every act it sends is verified against
 * exactly those tokens at this agent's dispatch door. The view's own code is untrusted by
 * construction: a modified view can SEND anything; nothing beyond its picks VERIFIES here.
 *
 * THE REGISTRY IS A PROJECTION (V1 closing wave, row 1 — decided 2026-08-19): a connection
 * belongs to the PERSON, not the device it was paired on. Every grant and revoke is a signed
 * statement on the device log's grants lane (`grantsRail.js`); the active-grant set — and the
 * revoked-token set the dispatch door consults — is FOLDED from that lane, never read from a
 * second store. Consequences, by construction:
 *   • revocation survives a restart (the log is the durable home; there is no snapshot file
 *     to lose or to go stale);
 *   • the grant set is per-person: statements fan live between the owner's own devices and
 *     ride restore, so unpairing the tablet on the phone closes the laptop's door too;
 *   • REVOKE WINS on any ordering (principle 10): a grant stands only when every revoke of
 *     that view is in its causal past — a concurrent re-grant loses to the revoke it never saw,
 *     and re-admitting the view takes a deliberate NEW grant made after the revoke.
 *
 * Reuse, not a new subsystem: the bundle vocabulary is core's `defineRoleBundle`, the token
 * substrate is `materializeBundle`'s standalone half (`CapabilityToken.issue`), the lane is the
 * same rail every circle rider enters through. Tokens verify on EVERY device of the profile
 * because all devices derive the same issuer identity from the profile seed — so the lane
 * carries grant metadata + token ids only, never re-issuable key material.
 *
 * FAIL CLOSED: `isRevoked` answers only after the lane's first fold has completed; while the
 * revocation state is unknown it answers "revoked". A door that guesses during boot is a race
 * in a security gate.
 */
import { CapabilityToken, defineRoleBundle } from '@onderling/core';
import { OWN_DEVICES_SCOPE } from './grantsManifest.js';

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

/** Stable comparison key for a view's read sections (the change-hook diff). */
const readsKeyOf = (reads) => (reads ? JSON.stringify(reads) : null);

/**
 * The issuer-side grant registry for this agent's surfaces — a PROJECTION of the grants lane:
 * mint, rotate, revoke, and answer the revocation question the dispatch door asks per token.
 *
 * @param {object} a
 * @param {{pubKey: string, sign: Function}} a.identity  the granting identity (token issuer —
 *   the profile's chat identity, which every device of the profile derives identically, so a
 *   token minted here verifies at every device's door)
 * @param {string} [a.agentId]  the token `agentId` binding; defaults to identity.pubKey
 * @param {(viewPubKey: string) => void} [a.onReadGrantChange]  fired after any fold in which a
 *   view's READ sections changed — locally or by a statement arriving from a sibling device —
 *   the mirror side reconciles its view lanes on this
 * @param {object} a.rail  the grants rail (`makeGrantsRail`) — REQUIRED: the lane IS the store
 * @param {(statement: object) => void} [a.fan]  hands a freshly appended statement to the
 *   sibling fan (best-effort; never blocks the local write)
 * @param {object|null} [a.delegationRecord]  this device's root-signed delegation record,
 *   carried on every statement so a sibling can verify the chain without the owner's registry
 */
export function createSurfaceGrants({ identity, agentId, onReadGrantChange, rail, fan = null, delegationRecord = null } = {}) {
  if (!identity || typeof identity.sign !== 'function') {
    throw new Error('createSurfaceGrants: a signing identity is required');
  }
  if (!rail || typeof rail.append !== 'function' || typeof rail.readVerifiedBodies !== 'function') {
    throw new Error('createSurfaceGrants: the grants rail is required — the registry is a projection of the grants lane');
  }
  const boundAgentId = agentId ?? identity.pubKey;

  /** The folded state: viewPubKey → { label, ops, reads, tokens: [{id, expiresAt}] } + the door's set. */
  let folded = { granted: new Map(), revokedIds: new Set() };
  let readsSnapshot = new Map();   // viewPubKey → readsKey, for the change-hook diff
  let ready = false;               // flips after the first successful fold — the door refuses until then
  let started = false;
  let chain = Promise.resolve();   // folds are serialised; a failed fold never wedges the lane

  const readsChanged = (viewPubKey) => { try { onReadGrantChange?.(viewPubKey); } catch { /* observer only */ } };
  const statementPayload = (payload) => ({ ...payload, ...(delegationRecord ? { delegation: delegationRecord } : {}) });

  /**
   * THE FOLD — revoke-wins, causally: for each view, a grant is ALIVE only when every
   * revoke of that view is in its causal past (parent/deps ancestry); among alive grants the
   * causally newest wins (concurrent grants tie-break deterministically by hash — convergent on
   * every device); every other grant's tokens are revoked, as are all ids revoke statements name.
   */
  async function foldOnce() {
    const { bodies } = await rail.readVerifiedBodies(OWN_DEVICES_SCOPE);
    const byView = new Map();   // viewPubKey → { grants: [], revokes: [] }
    const byHash = new Map(bodies.map((b) => [b.hash, b]));
    // Plain token cancellations (task grants etc.) — no view semantics, no causal contest:
    // a named id is dead, full stop. Collected here, folded into the door's set below.
    const tokenRevokes = [];
    for (const b of bodies) {
      if (b.kind === 'token-revoke') { tokenRevokes.push(b); continue; }
      if (typeof b.subject !== 'string' || !b.subject) continue;
      const slot = byView.get(b.subject) ?? { grants: [], revokes: [] };
      if (b.kind === 'grant') slot.grants.push(b);
      else if (b.kind === 'grant-revoke') slot.revokes.push(b);
      byView.set(b.subject, slot);
    }

    // Ancestry over the lane's own DAG (parentHash + deps), memoised per statement.
    const ancestorsMemo = new Map();
    const ancestors = (hash) => {
      const memo = ancestorsMemo.get(hash);
      if (memo) return memo;
      const seen = new Set();
      const stack = [];
      const pushLinks = (b) => {
        if (!b) return;
        if (typeof b.parentHash === 'string' && b.parentHash) stack.push(b.parentHash);
        for (const d of Array.isArray(b.deps) ? b.deps : []) stack.push(d);
      };
      pushLinks(byHash.get(hash));
      while (stack.length) {
        const h = stack.pop();
        if (seen.has(h)) continue;
        seen.add(h);
        pushLinks(byHash.get(h));
      }
      ancestorsMemo.set(hash, seen);
      return seen;
    };

    const granted = new Map();
    const revokedIds = new Set();
    const addTokenIds = (list) => {
      for (const t of Array.isArray(list) ? list : []) {
        if (typeof t?.id === 'string' && t.id) revokedIds.add(t.id);
        else if (typeof t === 'string' && t) revokedIds.add(t);
      }
    };
    for (const b of tokenRevokes) addTokenIds(b.payload?.tokenIds);
    for (const [viewPubKey, { grants, revokes }] of byView) {
      for (const r of revokes) addTokenIds(r.payload?.tokenIds);
      // Alive = the grant causally saw EVERY revoke of this view (deny wins on any ordering).
      const alive = grants.filter((g) => revokes.every((r) => ancestors(g.hash).has(r.hash)));
      // Causally newest among the alive; concurrent grants tie-break by hash (deterministic).
      const maximal = alive.filter((g) => !alive.some((o) => o !== g && ancestors(o.hash).has(g.hash)));
      const winner = maximal.length ? maximal.reduce((a, b) => (a.hash > b.hash ? a : b)) : null;
      for (const g of grants) {
        if (g !== winner) addTokenIds(g.payload?.tokens);
      }
      if (winner) {
        const p = winner.payload ?? {};
        granted.set(viewPubKey, Object.freeze({
          label: typeof p.label === 'string' ? p.label : null,
          ops: Object.freeze((Array.isArray(p.ops) ? p.ops : []).filter((o) => typeof o === 'string' && o)),
          reads: normaliseReads(p.reads),
          tokens: Object.freeze((Array.isArray(p.tokens) ? p.tokens : [])
            .filter((t) => typeof t?.id === 'string' && t.id)
            .map((t) => Object.freeze({ id: t.id, expiresAt: t.expiresAt }))),
        }));
      }
    }

    // The change-hook diff: any view whose READ sections differ from the previous fold.
    const nextReads = new Map();
    for (const [v, e] of granted) { if (e.reads) nextReads.set(v, readsKeyOf(e.reads)); }
    const touched = new Set();
    for (const [v, key] of nextReads) { if (readsSnapshot.get(v) !== key) touched.add(v); }
    for (const v of readsSnapshot.keys()) { if (!nextReads.has(v)) touched.add(v); }

    folded = { granted, revokedIds };
    readsSnapshot = nextReads;
    ready = true;
    for (const v of touched) readsChanged(v);
  }

  /** Serialised refold. Public: the ingest side (peer handler / catch-up batch) kicks it. */
  function recompute() {
    started = true;
    const run = () => foldOnce();
    chain = chain.then(run, run);
    const result = chain;
    chain = chain.catch(() => { /* a failed fold never wedges the next one; ready stays as it was */ });
    return result;
  }

  /** Await the projection's current state (kicking the first fold if nothing has yet). */
  async function settled() {
    if (!started) recompute();
    try { await chain; } catch { /* the fold's failure is reflected in `ready` */ }
  }

  return {
    /** First fold over the (already-hydrated) device log. The door refuses until it lands. */
    async hydrate() {
      try { await recompute(); } catch { /* ready stays false — the door stays closed */ }
      return ready;
    },

    /** Whether the first fold has landed. The door refuses while this is false. */
    isReady: () => ready,

    /** Refold from the lane — the ingest side's change hook. */
    recompute,

    /**
     * Grant (or re-grant) a view: mint one token per picked op and append the grant statement
     * to the lane. Rotation is the fold's causal supersession — the previous grant becomes an
     * ancestor of this one and its tokens stop verifying, here and on every sibling device.
     * @param {object} g
     * @param {string} g.viewPubKey   the view's public key (token subject)
     * @param {string[]} g.ops        picked skill ids
     * @param {string} [g.label]      display label for the surface
     * @param {number} [g.expiresIn=SURFACE_GRANT_TTL_MS]
     */
    async grant({ viewPubKey, ops, reads = null, label = null, expiresIn = SURFACE_GRANT_TTL_MS } = {}) {
      if (typeof viewPubKey !== 'string' || viewPubKey.length === 0) {
        throw new Error('surfaceGrants.grant: viewPubKey required');
      }
      const bundle = compileSurfaceBundle(ops, { actingAs: identity.pubKey, label });
      const normReads = normaliseReads(reads);
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
      // The lane carries METADATA + token ids; the signed token blobs go to the VIEW alone.
      const res = await rail.append(OWN_DEVICES_SCOPE, {
        kind: 'grant',
        subject: viewPubKey,
        payload: statementPayload({
          viewPubKey, label, ops: [...ops], reads: normReads,
          tokens: tokens.map((t) => ({ id: t.id, expiresAt: t.expiresAt })),
        }),
      });
      if (!res) throw new Error('surfaceGrants.grant: the grants lane refused the append (no device signer)');
      await recompute();
      if (typeof fan === 'function') { try { fan(res.statement); } catch { /* fan is best-effort */ } }
      return { viewPubKey, label, ops: [...ops], reads: normReads, laneId: normReads ? viewLaneId(viewPubKey) : null, tokens: tokens.map((t) => t.toJSON()) };
    },

    /**
     * Revoke a view's standing: append the revoke statement — every token materialized for the
     * view stops verifying at this door and, over the fan/catch-up, at every sibling's door,
     * even if the view still holds the blobs.
     * @returns {Promise<boolean>} whether the view had a grant to revoke
     */
    async revoke(viewPubKey) {
      await settled();
      const entry = folded.granted.get(viewPubKey);
      if (!entry) return false;
      const res = await rail.append(OWN_DEVICES_SCOPE, {
        kind: 'grant-revoke',
        subject: viewPubKey,
        payload: statementPayload({ viewPubKey, tokenIds: (entry.tokens ?? []).map((t) => t.id) }),
      });
      if (!res) return false;
      await recompute();
      if (typeof fan === 'function') { try { fan(res.statement); } catch { /* fan is best-effort */ } }
      return true;
    },

    /**
     * Cancel named tokens by id, whatever minted them — the cross-device half of an issuer-side
     * revoke (a task grant ending, say): the statement lands on the lane, fans to the owner's
     * other devices, and every door consulting this fold refuses the ids from then on. No view
     * semantics and no causal contest — a named id is simply dead.
     * @returns {Promise<boolean>} whether a statement was appended
     */
    async revokeTokens(tokenIds, { reason = null } = {}) {
      await settled();
      const ids = (Array.isArray(tokenIds) ? tokenIds : [tokenIds]).filter((t) => typeof t === 'string' && t);
      if (!ids.length) return false;
      const res = await rail.append(OWN_DEVICES_SCOPE, {
        kind: 'token-revoke',
        subject: boundAgentId,
        payload: statementPayload({ tokenIds: ids, ...(reason ? { reason } : {}) }),
      });
      if (!res) return false;
      await recompute();
      if (typeof fan === 'function') { try { fan(res.statement); } catch { /* fan is best-effort */ } }
      return true;
    },

    /**
     * The dispatch door's revocation question. FAIL CLOSED: until the lane's first fold has
     * landed the answer is "revoked" — a door that cannot know what was revoked refuses.
     */
    async isRevoked(tokenId) {
      await settled();
      if (!ready) return true;
      return folded.revokedIds.has(tokenId);
    },

    /** Await any in-flight fold — for a caller that wants the revoke reflected before replying. */
    flush: () => settled(),

    /** Current grants, for a settings surface: [{viewPubKey, label, ops, reads}]. */
    list() {
      return [...folded.granted.entries()].map(([viewPubKey, e]) => ({ viewPubKey, label: e.label, ops: [...e.ops], reads: e.reads ?? null }));
    },

    /** The views holding a READ grant — what the mirror side reconciles its lanes against. */
    readGrants() {
      return [...folded.granted.entries()]
        .filter(([, e]) => e.reads)
        .map(([viewPubKey, e]) => ({ viewPubKey, label: e.label, reads: e.reads, laneId: viewLaneId(viewPubKey) }));
    },
  };
}
