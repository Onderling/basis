/**
 * basis v2 — connection points (Nearby step I, §7).
 *
 * Today a relay is one URL in the vault (`/set-relay`), there is no list, and removing one is not something
 * a person can do — they can only overwrite it. This turns that into a surface.
 *
 * ── Why "connection point" and not "relay" ───────────────────────────────────────────────────────────────
 * A relay is an implementation detail. What it *does for you* is keep a circle reachable when nobody is on
 * your Wi-Fi, and the name should say that — because the only question anyone actually asks about one is
 * **"if I remove this, what breaks?"** So the model is built around answering that question rather than
 * around listing servers.
 *
 * ── The four rules from §7 ───────────────────────────────────────────────────────────────────────────────
 *
 *   1. **Joining populates it.** The invite carries the circle's endpoint and redeeming adds it. You never
 *      hand-configure a relay in order to join something — that is the step that loses people.
 *   2. **The mapping is shown BOTH ways** — which circles ride a point, and which points a circle has.
 *      One direction alone cannot answer the removal question.
 *   3. **Removal is honest.** It names the circles that lose reachability instead of silently degrading
 *      them. A circle with a second point is inconvenienced; a circle with none is cut off, and those are
 *      not the same event.
 *   4. **The circle SUGGESTS, the device DECIDES.** A circle can propose an endpoint; it cannot install one.
 *      Same shape as the disclosure ceiling/floor — the suggestion is recorded, the adoption is a choice.
 */

/** How a point came to be here. Kept because "I added this" and "a circle brought this" read differently. */
export const POINT_SOURCE = Object.freeze({ JOIN: 'join', MANUAL: 'manual', SUGGESTED: 'suggested' });

/** Provenance → locale key. Shared, so web and mobile cannot describe the same point differently. */
export const POINT_SOURCE_LABELS = Object.freeze({
  join:      'circle.nearbyScreen.point_from_join',
  manual:    'circle.nearbyScreen.point_from_manual',
  suggested: 'circle.nearbyScreen.point_suggested',
});

/**
 * Build the connection-point store.
 *
 * Pure and injectable: `load`/`save` are the host's persistence, so the same model runs on web and mobile
 * and in tests with no storage at all.
 *
 * @param {object} [deps]
 * @param {object} [deps.initial]   `{ [url]: {source, addedAt, circles: string[], adopted} }`
 * @param {(state: object) => any} [deps.save]
 * @param {() => number} [deps.now]
 */
export function createConnectionPoints({ initial = {}, save = null, now = () => Date.now() } = {}) {
  /** url → { url, source, addedAt, circles: Set<string>, adopted: boolean } */
  const points = new Map();

  for (const [url, rec] of Object.entries(initial ?? {})) {
    if (!isUrl(url)) continue;
    points.set(url, {
      url,
      source: rec?.source ?? POINT_SOURCE.MANUAL,
      addedAt: typeof rec?.addedAt === 'number' ? rec.addedAt : now(),
      circles: new Set(Array.isArray(rec?.circles) ? rec.circles.filter(Boolean) : []),
      // A suggested point is listed but not used until adopted — rule 4.
      adopted: rec?.adopted !== false,
    });
  }

  const watchers = new Set();
  const snapshot = () => Object.fromEntries([...points.values()].map((p) => [p.url, {
    url: p.url, source: p.source, addedAt: p.addedAt, circles: [...p.circles], adopted: p.adopted,
  }]));

  function commit() {
    const state = snapshot();
    try { save?.(state); } catch { /* persistence is best-effort; the list still works this session */ }
    for (const w of watchers) { try { w(list()); } catch { /* one bad watcher */ } }
    return state;
  }

  function upsert(url, { source, circleId = null, adopted = true }) {
    const existing = points.get(url);
    if (existing) {
      if (circleId) existing.circles.add(circleId);
      // An explicit adoption sticks; it never silently reverts to "suggested".
      if (adopted) existing.adopted = true;
      return existing;
    }
    const rec = { url, source, addedAt: now(), circles: new Set(circleId ? [circleId] : []), adopted };
    points.set(url, rec);
    return rec;
  }

  /** Every point, newest first, with the circles that ride it. */
  function list() {
    return [...points.values()]
      .sort((a, b) => b.addedAt - a.addedAt)
      .map((p) => ({
        url: p.url, source: p.source, addedAt: p.addedAt, adopted: p.adopted, circles: [...p.circles],
      }));
  }

  return {
    list,
    snapshot,

    /** Rule 2, one direction: which points does this circle have? */
    pointsFor(circleId) {
      return list().filter((p) => p.circles.includes(circleId));
    },

    /** Rule 2, the other direction: which circles ride this point? */
    circlesFor(url) {
      return [...(points.get(url)?.circles ?? [])];
    },

    /**
     * Rule 1 — redeeming an invite adds the circle's endpoint automatically.
     * Adopted on arrival: you chose to join, and joining is the consent.
     */
    addFromJoin(url, circleId) {
      if (!isUrl(url) || !circleId) return { ok: false, reason: 'invalid' };
      upsert(url, { source: POINT_SOURCE.JOIN, circleId, adopted: true });
      commit();
      return { ok: true };
    },

    /** A point the user typed in themselves. */
    addManually(url) {
      if (!isUrl(url)) return { ok: false, reason: 'invalid-url' };
      upsert(url, { source: POINT_SOURCE.MANUAL, adopted: true });
      commit();
      return { ok: true };
    },

    /**
     * Rule 4 — a circle SUGGESTS a point. It is recorded and listed, and it is NOT used until adopted.
     *
     * This is the difference between a circle telling you where it can be reached and a circle changing
     * how your device connects. The first is information; the second would be a circle reconfiguring a
     * device it does not own.
     */
    suggest(url, circleId) {
      if (!isUrl(url) || !circleId) return { ok: false, reason: 'invalid' };
      const existing = points.get(url);
      if (existing) { existing.circles.add(circleId); commit(); return { ok: true, alreadyKnown: true }; }
      upsert(url, { source: POINT_SOURCE.SUGGESTED, circleId, adopted: false });
      commit();
      return { ok: true, alreadyKnown: false };
    },

    /** Adopt a suggestion — the device deciding. */
    adopt(url) {
      const rec = points.get(url);
      if (!rec) return { ok: false, reason: 'unknown-point' };
      rec.adopted = true;
      commit();
      return { ok: true };
    },

    /**
     * Rule 3 — what removing this point would cost, WITHOUT removing it.
     *
     * The distinction is the whole point: a circle that has another adopted point is inconvenienced; a
     * circle left with none is cut off. Presenting those as one list of "affected circles" is how a user
     * clicks through a warning that mattered.
     *
     * @returns {{known: boolean, circles: string[], losesReachability: string[], stillReachable: string[]}}
     */
    impactOfRemoving(url) {
      const rec = points.get(url);
      if (!rec) return { known: false, circles: [], losesReachability: [], stillReachable: [] };

      const circles = [...rec.circles];
      const losesReachability = [];
      const stillReachable = [];
      for (const circleId of circles) {
        const others = [...points.values()].filter(
          (p) => p.url !== url && p.adopted && p.circles.has(circleId),
        );
        (others.length ? stillReachable : losesReachability).push(circleId);
      }
      return { known: true, circles, losesReachability, stillReachable };
    },

    /**
     * Remove a point. Returns the same impact report, so a caller that skipped the preview still gets the
     * truth back rather than a bare success.
     */
    remove(url) {
      const impact = this.impactOfRemoving(url);
      if (!impact.known) return { ok: false, reason: 'unknown-point', ...impact };
      points.delete(url);
      commit();
      return { ok: true, ...impact };
    },

    /** Watch the list; returns an unsubscribe. */
    subscribe(fn) {
      if (typeof fn !== 'function') return () => {};
      watchers.add(fn);
      return () => watchers.delete(fn);
    },
  };
}

/** A connection point is a websocket endpoint. Anything else is a typo, not a point. */
function isUrl(url) {
  return typeof url === 'string' && /^wss?:\/\/\S+$/.test(url.trim());
}
