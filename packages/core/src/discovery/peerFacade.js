/**
 * peerFacade — a pure, read-only projection that presents the three peer
 * stores as ONE per-(circle,member) `Peer` record, keyed by the member's
 * per-circle `circleAddress`.
 *
 * Connectivity Phase 4, Wave B (plans/DESIGN-connectivity-phase4-handshake-consistency.md §3,
 * governed by plans/NOTE-identity-and-linkability.md Decision A, 2026-07-22).
 *
 * Today the same peer's data is held three ways, keyed three ways:
 *   - the redemption trail / roster — keyed by `webid`, the SOURCE OF
 *     MEMBERSHIP; carries the per-circle crypto (`circleAddress`, signing
 *     `pubKey`, `sealingPublicKey`) + the disclosed `personaProperties`
 *     (see apps/stoop/src/lib/deriveRoster.js).
 *   - MemberMap — keyed by `webid`, the DISPLAY / identity-projection cache;
 *     carries `relation`, `trustLevel`, `nknAddr`, handle/displayName, etc.
 *     (see packages/identity-resolver/src/MemberMap.js).
 *   - PeerGraph — keyed by signing `pubKey`, the LIVENESS layer; carries
 *     `transports` (name → address), `reachable`, `tier`, `latency`
 *     (see ./PeerGraph.js).
 *
 * This projection LEFT-JOINS the trail (membership) with PeerGraph (liveness,
 * matched on the trail's `pubKey`) and MemberMap (display, matched on `webid`)
 * and returns, per member, ONE `Peer` keyed by the per-circle `circleAddress`.
 *
 * Per-circle by construction — the pinned model (Decision A):
 *   - There is NO global cross-circle id and NO cross-circle identity book.
 *     A member who is in circle X and circle Y yields TWO independent `Peer`
 *     records (different `circleAddress` each), computed from two separate
 *     trails. Sameness across circles exists ONLY when the joiner deliberately
 *     presented the same key at join — it is never manufactured here.
 *   - Keying by the per-circle address preserves the unlinkability spine
 *     (packages/core/src/identity/circleAddress.js) by construction, not by
 *     policy: the projection never introduces a correlatable cross-circle key.
 *
 * READ-ONLY. This does not change how any of the three stores are written;
 * it is a view the app reads THROUGH. No crypto, no I/O, fully synchronous.
 *
 * LAYERING (invariant 5, `apps → substrates → core`): this file lives in
 * `core` (alongside PeerGraph) and imports NOTHING from identity-resolver or
 * apps/stoop. The MemberMap list and the trail roster arrive as plain injected
 * arrays, so the projection can be imported by an app without an up-dependency.
 */

/**
 * @typedef {object} Peer
 * @property {string}                  circleAddress  — THE id: the member's per-circle unlinkable address.
 * @property {string}                  webid          — the member's WebID (the trail's membership key).
 * @property {Record<string,string>}   transports     — transportName → wire address (flattened from PeerGraph; may be empty).
 * @property {string|null}             sealingKey     — the at-rest sealing public key (trail `sealingPublicKey`).
 * @property {boolean|null}            reachability    — PeerGraph liveness; null when the member has no PeerGraph record yet.
 * @property {string}                  relation       — 'group-member' | 'contact' | 'agent' (from MemberMap; default 'group-member').
 * @property {string|null}             trust          — network trust tier (PeerGraph `tier`), falling back to the per-contact `trustLevel`.
 * @property {object} revealState                      — the member's per-circle reveal-state: a `disclosure.js`
 *   policy (`{ perContext: { [circleId]: { key: {enabled,rung,matchable,requestable} } } }`), context = the
 *   circleId, default-withhold. The C7 reveal-state collapse (Wave B): the persona card reads this via
 *   `isDisclosed(peer.revealState, circleId, key)` instead of re-inferring from the raw `reveals[]`.
 * @property {Record<string,string>} [props]          — the coarse background values this member disclosed in THIS circle (`personaProperties`).
 */

/**
 * Project one circle's membership into per-(circle,member) `Peer` records.
 *
 * @param {object} o
 * @param {Array<object>} o.trailRoster
 *   The derived roster for ONE circle (deriveRoster output / listGroupMembers).
 *   The SOURCE OF MEMBERSHIP + per-circle crypto. One entry per member.
 * @param {Array<object>} [o.memberMap]
 *   `MemberMap.list()` output — the display/identity cache, joined by `webid`.
 *   Display-only; never consulted for member existence.
 * @param {Array<object>} [o.peerGraph]
 *   `PeerGraph.all()` / `.export()` output — liveness records, joined by the
 *   trail member's signing `pubKey` (PeerGraph's primary key).
 * @param {string} [o.circleId]
 *   The circle this projection is for. The trail is already scoped to it (not
 *   used to filter — the trail is the membership authority); it IS the CONTEXT id
 *   under which each `Peer.revealState` disclosure policy is keyed.
 * @param {'open'|'pairwise'} [o.revealPolicy='pairwise']
 *   The circle's real-name reveal policy, an injected per-circle scalar (keeps the
 *   projection pure). Under `'open'` the circle discloses real names to members, so
 *   `revealState` marks `realName` enabled for every member; under `'pairwise'` a
 *   member's `realName` is enabled only when they've revealed it to ≥1 peer (the
 *   per-row `reveals[]` list). The per-PEER selection (revealed to whom) is not a
 *   per-circle bit and stays with the viewer/view-as gate, not here.
 * @returns {Peer[]} one `Peer` per trail member, keyed by `circleAddress`.
 */
export function peerFacade({ trailRoster = [], memberMap = [], peerGraph = [], circleId, revealPolicy = 'pairwise' } = {}) {

  // Index the display cache by webid.
  const displayByWebid = new Map();
  for (const m of memberMap ?? []) {
    if (m && typeof m.webid === 'string' && m.webid) displayByWebid.set(m.webid, m);
  }

  // Index liveness by every key PeerGraph records itself under (pubKey and/or url).
  const liveByKey = new Map();
  for (const p of peerGraph ?? []) {
    if (!p || typeof p !== 'object') continue;
    if (typeof p.pubKey === 'string' && p.pubKey) liveByKey.set(p.pubKey, p);
    if (typeof p.url === 'string' && p.url) liveByKey.set(p.url, p);
  }

  const out = [];
  for (const row of trailRoster ?? []) {
    if (!row || typeof row !== 'object') continue;
    const webid = typeof row.webid === 'string' ? row.webid : null;
    // circleAddress is THE id. A member who joined before the per-circle
    // substrate shipped may lack one — fall back to the display cache, then
    // (last resort) to webid so the member still appears. No cross-circle key
    // is ever invented.
    const disp = (webid && displayByWebid.get(webid)) || {};
    const circleAddress = row.circleAddress ?? disp.circleAddress ?? webid ?? null;

    // Liveness: match the trail's signing pubKey against PeerGraph. A trail
    // member with no PeerGraph record still appears (membership is from the
    // trail) — with unknown reachability + empty transports.
    const live = (row.pubKey && liveByKey.get(row.pubKey)) || null;

    const peer = {
      circleAddress,
      webid,
      transports: _flattenTransports(live, disp),
      sealingKey: row.sealingPublicKey ?? disp.sealingPublicKey ?? null,
      reachability: live ? (live.reachable !== false) : null,
      relation: disp.relation === 'contact' || disp.relation === 'agent'
        ? disp.relation
        : 'group-member',
      trust: live?.tier ?? disp.trustLevel ?? null,
    };

    // props — the coarse disclosed background values (opt-in; often absent).
    const props = _pickObject(row.personaProperties) ?? _pickObject(disp.personaProperties);
    if (props) peer.props = props;

    // revealState — the member's per-circle disclosure as a `disclosure.js` policy
    // (context = circleId), read downstream via `isDisclosed(peer.revealState, circleId, key)`.
    // `handle` is the always-shown floor; `realName` is disclosed for the circle iff the policy
    // is 'open' OR the member RELEASED it here (their own per-circle persona release — revealing
    // is the discloser's act, never a viewer preference). Built as a plain policy object (core
    // cannot import the agent-registry `disclosure.js` — it sits a layer up — but the policy is
    // a plain serialisable object, so the shape IS the contract).
    peer.revealState = _revealState({ circleId, released: props?.realName != null, revealPolicy });

    out.push(peer);
  }
  return out;
}

/**
 * Flatten PeerGraph's `transports` ({ name → {address,…} | string }) to
 * { name → address }, mirroring `PeerGraph.addressesOf`. When the peer has no
 * PeerGraph record but the display cache knows an NKN address, expose that so
 * a just-joined-not-yet-gossiped member is still routable.
 */
function _flattenTransports(live, disp) {
  const out = {};
  const transports = live?.transports ?? {};
  for (const [name, cfg] of Object.entries(transports)) {
    const addr = typeof cfg === 'string' ? cfg : (cfg?.address ?? cfg?.url ?? null);
    if (typeof addr === 'string' && addr) out[name] = addr;
  }
  if (!out.nkn && typeof disp?.nknAddr === 'string' && disp.nknAddr) out.nkn = disp.nknAddr;
  return out;
}

/**
 * Build a member's per-circle reveal-state — a `disclosure.js`-shaped policy
 * (`{ perContext: { [ctx]: { key: {enabled,rung,matchable,requestable} } } }`),
 * default-withhold on every axis but `enabled`. `handle` is the pseudonym FLOOR
 * (always enabled); `realName` is enabled iff the circle policy is 'open' OR the
 * member RELEASED it to this circle (their release carries the value itself).
 * Only the disclosed (`enabled`) axis carries a value here; `matchable`/`requestable`
 * stay withheld.
 */
function _revealState({ circleId, released, revealPolicy }) {
  const ctx = (typeof circleId === 'string' && circleId) ? circleId : 'circle';
  const realNameShared = revealPolicy === 'open' || released === true;
  const entry = (enabled) => ({ enabled: enabled === true, rung: null, matchable: false, requestable: false });
  return { perContext: { [ctx]: { handle: entry(true), realName: entry(realNameShared) } } };
}

/** Return a shallow copy of a non-empty plain object, else null. */
function _pickObject(v) {
  if (v && typeof v === 'object' && !Array.isArray(v) && Object.keys(v).length > 0) {
    return { ...v };
  }
  return null;
}

export default peerFacade;
