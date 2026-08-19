/**
 * Community subscriptions — a user's subscribed communities → trust-graph roots
 * (commons-governance G3).
 *
 * The subscribe model, stated plainly: **joining a community = trusting its
 * curation.** A user keeps a simple, explicit list of the communities (circles)
 * they subscribe to. From that list two things are DERIVED for the G2
 * web-of-trust walk:
 *
 *   1. `roots()` — the union of the admin pubKeys of every subscribed
 *      community. These become the curator ROOTS (depth 0) the trust-graph walk
 *      starts from. Subscribe adds a community's admins; unsubscribe removes
 *      them. (Plus any `adoptedEndorsers` a forked community exposes — a fork's
 *      copied statements keep the SOURCE curator as `endorser`, so the source
 *      must be a root for D's subscribers to reach them. See communityCatalogue
 *      `fork`.)
 *   2. `resolveEndorsements(pubKey)` — the per-endorser seam `walkTrustGraph`
 *      consumes: that pubKey's published `recommend`/`flag` records, unioned
 *      across every subscribed community's catalogue resource, PLUS an optional
 *      `resolveEndorsements` fallback for endorsers whose records live in their
 *      OWN pod (transitive curators a community admin vouches for). The walk
 *      itself re-filters `endorser === pubKey` and re-verifies every edge, so a
 *      loose union here is safe.
 *
 * Wire `roots` + `resolveEndorsements` straight into `createCatalogueSource`
 * (`roots` accepts a thunk, so subscribe/unsubscribe take effect live). This is
 * FEDERATION by construction: subscribing to two communities UNIONS their
 * catalogues; the bounded-depth WoT walk still applies WITHIN each community's
 * admin roots. The whole thing is advisory — the power-user override installs
 * off-catalogue regardless — and exit is a right (unsubscribe, or fork + diverge).
 */

/**
 * createCommunitySubscriptions — manage a user's subscribed communities and
 * project them to trust-graph roots + a per-endorser resolver.
 *
 * @param {object} opts
 * @param {(circleId: string) => ({ admins?: string[]|(() => (string[]|Promise<string[]>)), list?: () => (object[]|Promise<object[]>) } | Promise<...>)} opts.resolveCommunity
 *   — for a subscribed circleId, the community's ADMIN pubKeys (the curator
 *     roots) and its catalogue `list()` (the community's endorsements). Typically
 *     `{ admins: circleAdminPubKeys, list: communityCatalogue.list }`.
 * @param {(pubKey: string) => (object[]|Promise<object[]>)} [opts.resolveEndorsements]
 *   — optional fallback per-endorser resolver for endorsers whose records live
 *     outside the community catalogues (personal curator pods → transitive WoT).
 * @param {Iterable<string>} [opts.initial]  — initially-subscribed circleIds.
 * @returns {{ subscribe, unsubscribe, has, list, roots, resolveEndorsements }}
 */
export function createCommunitySubscriptions({ resolveCommunity, resolveEndorsements: fallbackResolver, initial } = {}) {
  if (typeof resolveCommunity !== 'function') {
    throw Object.assign(
      new Error('createCommunitySubscriptions: resolveCommunity(circleId) is required'),
      { code: 'INVALID_ARGUMENT' },
    );
  }
  const subs = new Set();
  for (const id of initial ?? []) if (typeof id === 'string' && id.length > 0) subs.add(id);

  async function _communities() {
    const out = [];
    for (const id of subs) {
      const c = await resolveCommunity(id);
      if (c && typeof c === 'object') out.push({ id, ...c });
    }
    return out;
  }

  async function _adminsOf(c) {
    const a = typeof c.admins === 'function' ? await c.admins() : c.admins;
    return Array.isArray(a) ? a.filter((x) => typeof x === 'string' && x.length > 0) : [];
  }

  return {
    /** Subscribe to a community (circle) — its admins become curator roots. */
    subscribe(circleId) {
      if (typeof circleId === 'string' && circleId.length > 0) subs.add(circleId);
      return this;
    },
    /** Unsubscribe — its admins stop being roots (its curation drops out). */
    unsubscribe(circleId) {
      subs.delete(circleId);
      return this;
    },
    has(circleId)  { return subs.has(circleId); },
    list()         { return [...subs]; },

    /** The union of subscribed communities' admin pubKeys → the walk's roots. */
    async roots() {
      const out = new Set();
      for (const c of await _communities()) {
        for (const a of await _adminsOf(c)) out.add(a);
      }
      return [...out];
    },

    /**
     * The per-endorser records the walk asks for: this pubKey's endorsements
     * across every subscribed community catalogue, plus the optional fallback.
     */
    async resolveEndorsements(pubKey) {
      const acc = [];
      for (const c of await _communities()) {
        const recs = typeof c.list === 'function' ? await c.list() : [];
        for (const r of Array.isArray(recs) ? recs : []) {
          if (r && r.endorser === pubKey) acc.push(r);
        }
      }
      if (typeof fallbackResolver === 'function') {
        const extra = await fallbackResolver(pubKey);
        for (const r of Array.isArray(extra) ? extra : []) if (r && r.endorser === pubKey) acc.push(r);
      }
      return acc;
    },
  };
}
