/**
 * reachablePeers skill — exposes this agent's signed reachability claim.
 *
 * Every call to `reachable-peers` returns { body, sig } for the current
 * direct-peer set. The producer caches the claim in memory and only
 * re-signs when:
 *   (a) the cached direct-peer set no longer matches reality, OR
 *   (b) the cached claim's TTL has less than `refreshBeforeMs` left, OR
 *   (c) there is no cached claim yet.
 *
 * ── DISCLOSURE (2026-07-27, audit item G7) ───────────────────────────────────
 * The claim's body is **this device's contact graph**: the pubKey of every peer it is directly connected
 * to, signed. That is not neutral routing metadata — in a social product it is who someone knows.
 *
 * The skill is `authenticated`, so before this change any known peer could ask a device "who are you
 * connected to?" and receive a signed answer. Acceptable in a mesh demo with no social graph to protect;
 * not acceptable in an app with users in neighbourhood circles.
 *
 * So the ANSWER is now scoped per caller, not just the gate. `peerScope(callerPubKey, peers)` decides what
 * a given caller may learn — the same lesson as the report-visibility fix (`docs/decisions.md` 2026-07-26
 * §2): a gate controls WHO ASKS, never WHAT THEY LEARN, so the narrowing has to happen at the data.
 *
 * **Deny-by-default:** with no `peerScope` the claim discloses NOTHING and a warning is logged once. A
 * caller that wants the old open behaviour states it (`peerScope: (_c, peers) => peers`), which is the
 * honest thing for a mesh demo to say out loud. Core stays circle-agnostic (invariant 5) — the scoper is
 * injected by whoever knows what a circle is.
 *
 * See Design-v3/oracle-bridge-selection.md §3 and CODING-PLAN.md Group T3.
 */
import { DataPart }                        from '../Parts.js';
import { signReachabilityClaim }            from '../security/reachabilityClaim.js';
import { param, PARAM_SCOPE, PARAM_KIND }   from '../params.js';

// Parameter register (#36) — reachable-peers cache tuning (scope:device, kind:internal). Caller-overridable
// via opts. `param()` returns each default unchanged.
export const DEFAULT_TTL_MS             = param({ key: 'reachablePeers.ttlMs',          scope: PARAM_SCOPE.DEVICE, kind: PARAM_KIND.INTERNAL, default: 5 * 60_000 });
export const DEFAULT_REFRESH_BEFORE_MS  = param({ key: 'reachablePeers.refreshBeforeMs', scope: PARAM_SCOPE.DEVICE, kind: PARAM_KIND.INTERNAL, default: 60_000 });
export const DEFAULT_MAX_PEERS          = param({ key: 'reachablePeers.maxPeers',        scope: PARAM_SCOPE.DEVICE, kind: PARAM_KIND.INTERNAL, default: 256 });

/**
 * Register the `reachable-peers` skill on `agent`.
 *
 * Resolution for each option: explicit arg → `agent.config.get('oracle.<name>')`
 * → built-in default.
 *
 * @param {import('../Agent.js').Agent} agent
 * @param {object}  [opts]
 * @param {number}  [opts.ttlMs]
 * @param {number}  [opts.refreshBeforeMs]
 * @param {number}  [opts.maxPeers]
 * @param {object}  [opts.seqStore]          — forwarded to signReachabilityClaim
 * @param {(callerPubKey: string, peers: string[]) => string[]|Promise<string[]>} [opts.peerScope]
 *   Which of this device's direct peers THIS caller may learn about. Absent ⇒ none are disclosed (see the
 *   disclosure note above). Pass `(_caller, peers) => peers` to opt into the old open behaviour.
 */
export function registerReachablePeersSkill(agent, opts = {}) {
  if (agent.skills.get('reachable-peers')) return;  // idempotent

  const resolve = (key, fallback) => {
    if (opts[key] !== undefined)                    return opts[key];
    const fromCfg = agent.config?.get?.(`oracle.${key}`);
    if (fromCfg !== undefined && fromCfg !== null)  return fromCfg;
    return fallback;
  };

  const ttlMs           = resolve('ttlMs',           DEFAULT_TTL_MS);
  const refreshBeforeMs = resolve('refreshBeforeMs', DEFAULT_REFRESH_BEFORE_MS);
  const maxPeers        = resolve('maxPeers',        DEFAULT_MAX_PEERS);
  const seqStore        = opts.seqStore;   // undefined → helper's default store
  const peerScope       = typeof opts.peerScope === 'function' ? opts.peerScope : null;
  let warnedNoScope     = false;

  /**
   * Cache keyed by CALLER, not global. A single-slot cache would hand a claim minted for one caller to the
   * next one — which under per-caller scoping is precisely the leak this change exists to prevent.
   * @type {Map<string, { claim: object, signedAt: number, peerSetKey: string }>}
   */
  const cacheByCaller = new Map();

  agent.register('reachable-peers', async ({ from } = {}) => {
    const all      = await _directPeerPubKeys(agent, maxPeers);

    // Scope the ANSWER. No scoper ⇒ disclose nothing, and say so once: an empty claim degrades hop routing
    // quietly, so the operator needs to know it is a configuration choice and not a network condition.
    let peers;
    if (peerScope) {
      // AWAITED: a real scope is a membership question ("peers I share a circle with"), and membership
      // lives behind an async roster lookup. A sync-only seam would have forced every host to keep a
      // hand-rolled cache just to answer it. `await` on a plain array is free, so sync scopes still work.
      const scoped = await peerScope(from ?? null, all);
      peers = Array.isArray(scoped) ? scoped.filter((p) => all.includes(p)) : [];
    } else {
      peers = [];
      if (!warnedNoScope) {
        warnedNoScope = true;
        console.warn('[reachable-peers] no `peerScope` configured — disclosing no peers. '
          + 'Pass peerScope(callerPubKey, peers) to choose what each caller may learn.');
      }
    }

    const cacheKey = from ?? '<anonymous>';
    const setKey   = peers.join(',');
    const now      = Date.now();
    const ageLimit = ttlMs - refreshBeforeMs;
    const cached   = cacheByCaller.get(cacheKey);

    const stale =
      !cached
      || cached.peerSetKey !== setKey
      || (now - cached.signedAt) >= ageLimit;

    if (stale) {
      const claim = await signReachabilityClaim(
        agent.identity,
        peers,
        { ttlMs, seqStore },
      );
      cacheByCaller.set(cacheKey, { claim, signedAt: now, peerSetKey: setKey });
      return [DataPart(claim)];
    }

    return [DataPart(cached.claim)];
  }, {
    visibility:  'authenticated',
    description: 'Return a signed list of directly reachable peers',
  });
}

// ── Helpers ───────────────────────────────────────────────────────────────────

/**
 * Read the current direct-peer pubKey set from the PeerGraph, sorted and
 * truncated to `maxPeers`. Self is implicitly excluded (agent's own pubkey
 * is never in its own PeerGraph).
 */
async function _directPeerPubKeys(agent, maxPeers) {
  if (!agent.peers) return [];
  const all = await agent.peers.all();
  const pks = all
    .filter(p => p.pubKey && p.pubKey !== agent.pubKey)
    .filter(p => (p.hops ?? 0) === 0)
    .filter(p => p.reachable !== false)
    .map(p => p.pubKey);
  pks.sort();
  return pks.slice(0, maxPeers);
}
