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
 *
 * ── One is live; the rest are standby ────────────────────────────────────────────────────────────────────
 * Found while wiring this up: the substrate connects to **one relay at a time** (`sa.relay.connect({relayUrl})`).
 * A list that showed five points as though all were carrying traffic would be a lie, so the store tracks
 * which one is ACTIVE and the renderers say so. The others are real — adopted, known, and a genuine
 * fallback if the active one goes — they are just not carrying anything right now.
 *
 * This is why `impactOfRemoving` still counts a standby point as "still reachable": switching to it is a
 * reconnect, not a re-join. But removing the ACTIVE one is a different event, and the report says that too.
 */

/** How a point came to be here. Kept because "I added this" and "a circle brought this" read differently. */
export const POINT_SOURCE = Object.freeze({ JOIN: 'join', MANUAL: 'manual', SUGGESTED: 'suggested' });

/**
 * What KIND of connection point (2026-07-28, the NKN+pod circle).
 *
 * A `relay` is a websocket endpoint the transport connects to. A `pod` is a circle's shared store — the
 * approved exception to "NKN stays contact-to-contact": everyone reaches the admin over NKN for the join,
 * and from then on the POD is how the circle stays reachable. It belongs in this list because the list
 * answers "if I remove this, what breaks?", and for a pod-backed circle the pod IS the answer — a circle
 * with no relay would otherwise have nothing to point at (journey J-NP1/J-NP6).
 *
 * The two kinds differ in one visible way: exactly one RELAY is live at a time (a socket), while a pod is
 * simply used whenever the circle syncs — so the renderers show active/standby for relays only. Claiming a
 * pod was "standby" would be the same lie in the other direction.
 */
export const POINT_KIND = Object.freeze({ RELAY: 'relay', POD: 'pod' });

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
export function createConnectionPoints({ initial = {}, save = null, now = () => Date.now(), activeUrl = null } = {}) {
  let active = typeof activeUrl === 'string' ? activeUrl : null;
  /** url → { url, source, addedAt, circles: Set<string>, adopted: boolean } */
  const points = new Map();

  for (const [url, rec] of Object.entries(initial ?? {})) {
    const kind = rec?.kind === POINT_KIND.POD ? POINT_KIND.POD : POINT_KIND.RELAY;
    if (!isUrl(url, kind)) continue;
    points.set(url, {
      url,
      kind,
      source: rec?.source ?? POINT_SOURCE.MANUAL,
      addedAt: typeof rec?.addedAt === 'number' ? rec.addedAt : now(),
      circles: new Set(Array.isArray(rec?.circles) ? rec.circles.filter(Boolean) : []),
      // A suggested point is listed but not used until adopted — rule 4.
      adopted: rec?.adopted !== false,
    });
  }

  const watchers = new Set();
  const snapshot = () => Object.fromEntries([...points.values()].map((p) => [p.url, {
    url: p.url, kind: p.kind, source: p.source, addedAt: p.addedAt, circles: [...p.circles], adopted: p.adopted,
  }]));

  function commit() {
    const state = snapshot();
    try { save?.(state); } catch { /* persistence is best-effort; the list still works this session */ }
    for (const w of watchers) { try { w(list()); } catch { /* one bad watcher */ } }
    return state;
  }

  function upsert(url, { source, circleId = null, adopted = true, kind = POINT_KIND.RELAY }) {
    const existing = points.get(url);
    if (existing) {
      if (circleId) existing.circles.add(circleId);
      // An explicit adoption sticks; it never silently reverts to "suggested".
      if (adopted) existing.adopted = true;
      return existing;
    }
    const rec = { url, kind, source, addedAt: now(), circles: new Set(circleId ? [circleId] : []), adopted };
    points.set(url, rec);
    return rec;
  }

  /** Every point, newest first, with the circles that ride it. */
  function list() {
    return [...points.values()]
      .sort((a, b) => b.addedAt - a.addedAt)
      .map((p) => ({
        url: p.url, kind: p.kind, source: p.source, addedAt: p.addedAt, adopted: p.adopted,
        circles: [...p.circles],
        // Exactly one RELAY is connected at a time; a pod has no socket to be "active" on, so the flag is
        // relay-only and renderers skip the active/standby line for pods.
        active: p.kind === POINT_KIND.RELAY && p.url === active,
      }));
  }

  return {
    list,
    snapshot,

    /** Which point is currently connected, if any. */
    activeUrl: () => active,

    /**
     * Record which point the transport is actually connected to.
     *
     * The store does not connect anything — it describes. The host owns the connection and tells the store,
     * so the list can never claim a point is live when the transport disagrees.
     */
    setActive(url) {
      // Relay-only: "active" is a socket fact, and a pod has no socket. Setting a pod active would make
      // the list claim a connection the transport does not have.
      active = url && points.get(url)?.kind === POINT_KIND.RELAY ? url : null;
      commit();
      return active;
    },

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
    addFromJoin(url, circleId, { kind = POINT_KIND.RELAY } = {}) {
      if (!isUrl(url, kind) || !circleId) return { ok: false, reason: 'invalid' };
      upsert(url, { source: POINT_SOURCE.JOIN, circleId, adopted: true, kind });
      commit();
      return { ok: true };
    },

    /**
     * A pod-backed circle's store, as its connection point (the NKN+pod circle, approved 2026-07-28).
     * Sugar over `addFromJoin` so the call site reads as what it is.
     */
    addPodPoint(podUrl, circleId) {
      return this.addFromJoin(podUrl, circleId, { kind: POINT_KIND.POD });
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
      return {
        known: true, circles, losesReachability, stillReachable,
        // Removing the live point drops the connection until another is chosen — a different event from
        // removing a standby, even when no circle ends up cut off.
        wasActive: url === active,
      };
    },

    /**
     * Remove a point. Returns the same impact report, so a caller that skipped the preview still gets the
     * truth back rather than a bare success.
     */
    remove(url) {
      const impact = this.impactOfRemoving(url);
      if (!impact.known) return { ok: false, reason: 'unknown-point', ...impact };
      points.delete(url);
      if (active === url) active = null;
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

/**
 * Is this a usable POD url? — **the one rule**, exported because three places had their own (2026-07-30).
 *
 * They disagreed, and the disagreement was not academic. Walking S4's pod set against a real Community
 * Solid Server found: `circleRealPod.podRootFromWebid` accepts `http://` (with a unit test naming
 * `http://localhost:3000/...`), while the invite builder and this store both demanded `https://`. So a
 * circle could be created on a local pod, stored happily, and then have its pod url silently dropped from
 * its own invite — while the invite went on claiming `podBacked: true`. The joiner was told a pod host
 * could see them and never told which pod.
 *
 * The rule now: **https anywhere, or http on loopback.** That is not a loosening for its own sake — it is
 * the same line browsers draw for secure contexts, and it matches what this product already does one
 * layer down, where a relay point accepts plaintext `ws://`. A pod you are running on your own machine is
 * not a downgrade; a pod reached in cleartext across a network is.
 */
export function isPodUrl(url) {
  if (typeof url !== 'string') return false;
  const u = url.trim();
  if (/^https:\/\/\S+$/.test(u)) return true;
  // Loopback only — never a LAN address. `http://192.168.x.x` crosses a wire someone else can read, and
  // the fact that it is "local" to you is not a property the pod's contents care about.
  return /^http:\/\/(localhost|127\.0\.0\.1|\[::1\])(:\d+)?(\/\S*)?$/.test(u);
}

/**
 * A RELAY point is a websocket endpoint; a POD point is a pod root — see `isPodUrl`.
 * Anything else is a typo, not a point.
 */
function isUrl(url, kind = POINT_KIND.RELAY) {
  if (typeof url !== 'string') return false;
  return kind === POINT_KIND.POD
    ? isPodUrl(url)
    : /^wss?:\/\/\S+$/.test(url.trim());
}

/**
 * Rule 1, applied to a JOIN — record the joined circle's connection point(s) from what the invite
 * carried: its pod (`podBacked`+`podUrl`) and/or its relay (`relayUrl`). One helper so web and mobile
 * record identically (invariants #1/#2). Best-effort by design: the list is a convenience — a malformed
 * or missing url adds nothing and must never break a join. Returns which kinds were recorded.
 *
 * @param {object} a
 * @param {object} a.store     a `createConnectionPoints` store.
 * @param {object} a.invite    the DECODED invite (`podBacked`/`podUrl`/`relayUrl` are the fields read).
 * @param {string} a.circleId  the joined circle.
 * @returns {{recorded: Array<'pod'|'relay'>}}
 */
export function recordJoinedCirclePoints({ store, invite, circleId } = {}) {
  const recorded = [];
  if (!store || !invite || !circleId) return { recorded };
  if (invite.podBacked === true && typeof invite.podUrl === 'string') {
    try { if (store.addPodPoint(invite.podUrl, circleId)?.ok) recorded.push('pod'); } catch { /* best-effort */ }
  }
  if (typeof invite.relayUrl === 'string') {
    try { if (store.addFromJoin(invite.relayUrl, circleId)?.ok) recorded.push('relay'); } catch { /* best-effort */ }
  }
  return { recorded };
}

/**
 * Which relay to connect to at BOOT — the point that closes the reachability hole.
 *
 * A device was only on a circle's relay *while joining it*: the join dials the endpoint the invite names
 * (`endpointToDialForInvite`) and deliberately does not persist it, so joining cannot silently rewrite a
 * relay someone chose. The consequence, observed running the first message round-trip on hardware
 * (2026-07-30): after a restart the device was on no relay, its per-circle addresses were registered
 * nowhere, and every message addressed to it timed out. The connection point was recorded the whole time
 * — nothing reconnected to it.
 *
 * So the boot path now says what the routing scope already says for circles: **unconfigured means the
 * default, never nowhere.** The order is the only interesting part:
 *
 *   1. an explicit stored preference — a person who chose a relay keeps it, always;
 *   2. else the ACTIVE point, if one was live when we last shut down;
 *   3. else the newest adopted RELAY point — in practice the relay of the circle joined most recently,
 *      which is the one a returning user is most likely to want to be reachable in.
 *
 * Never a pod (it has no socket) and never a merely SUGGESTED point — rule 4 says a circle may propose an
 * endpoint and only the device adopts one. Inferring adoption from a boot would take that decision away.
 *
 * @param {object} a
 * @param {string|null} [a.stored]  the persisted relay preference, if any
 * @param {Array<object>} [a.list]  `store.list()` — newest first, carrying `kind`/`adopted`/`active`
 * @returns {string|null}
 */
export function bootRelayUrl({ stored = null, list = [] } = {}) {
  const explicit = typeof stored === 'string' ? stored.trim() : '';
  if (explicit) return explicit;
  const points = Array.isArray(list) ? list : [];
  const usable = points.filter((p) => p?.kind !== POINT_KIND.POD && p?.adopted !== false && isUrl(p?.url, POINT_KIND.RELAY));
  const active = usable.find((p) => p?.active === true);
  if (active) return active.url;
  return usable[0]?.url ?? null;      // `list()` is newest first
}

/**
 * Rule 1, applied EARLIER — the endpoint a joiner must be on **before** the redeem, or `null`.
 *
 * `recordJoinedCirclePoints` above runs from the join callback, which needs a circle id, which only
 * exists once the join has succeeded. That ordering has a hole in it, and S4 walked straight into it
 * (J-CP1, 2026-07-29): the redeem has to reach an admin who is only reachable on the circle's relay, but
 * the joiner does not adopt that relay until after the redeem lands. On real hardware the phone fell back
 * to NKN, waited 15s for an HI that could never come, and the join died — with the relay it needed sitting
 * decoded in the invite the whole time.
 *
 * It stays invisible whenever the two happen to share a transport (both on NKN, or one LAN with mDNS),
 * which is why it survived this long. The realistic case — an admin on a relay, a newcomer on defaults —
 * is the one that breaks.
 *
 * This decides; it never connects. The host owns the socket (see `setActive`), so the join path takes a
 * `dialEndpoint` seam and the shells supply it.
 *
 * @param {object} a
 * @param {object|null} a.invite      the DECODED invite (`relayUrl` is the field read).
 * @param {string|null} [a.activeUrl] the relay this device is already on, if any.
 * @returns {string|null} the url to dial, or null when there is nothing to do.
 */
export function endpointToDialForInvite({ invite, activeUrl = null } = {}) {
  const url = typeof invite?.relayUrl === 'string' ? invite.relayUrl.trim() : '';
  if (!url || !isUrl(url, POINT_KIND.RELAY)) return null;
  // Already there ⇒ nothing to do. A device is on at most one relay (`setActive` is relay-only), so this
  // is a straight comparison rather than a membership test.
  if (typeof activeUrl === 'string' && activeUrl.trim() === url) return null;
  return url;
}

// ── Persistence + migration ─────────────────────────────────────────────────

const POINTS_STORAGE_KEY = 'cc.connectionPoints';

/** localStorage-backed IO (web). Mirrors `relayPref.js` so both settings persist the same way. */
export function localStorageConnectionPointsIo(storage = globalThis.localStorage) {
  return {
    load: () => { try { return JSON.parse(storage?.getItem(POINTS_STORAGE_KEY) ?? '{}'); } catch { return {}; } },
    save: (v) => { try { storage?.setItem(POINTS_STORAGE_KEY, JSON.stringify(v ?? {})); } catch { /* ignore */ } },
  };
}

/** AsyncStorage-backed IO (mobile). */
export function asyncStorageConnectionPointsIo(AsyncStorage) {
  return {
    load: async () => {
      try { return JSON.parse((await AsyncStorage?.getItem(POINTS_STORAGE_KEY)) ?? '{}'); }
      catch { return {}; }
    },
    save: async (v) => {
      try { await AsyncStorage?.setItem(POINTS_STORAGE_KEY, JSON.stringify(v ?? {})); }
      catch { /* ignore */ }
    },
  };
}

/**
 * Fold the OLD single-relay setting into the list.
 *
 * Non-destructive on purpose. The old key (`relayPref`) is what boot still reads to decide what to connect
 * to, so this seeds the list from it rather than replacing it — a migration that broke connectivity to
 * introduce a settings screen would be a bad trade. The old value simply appears as a point you added, and
 * as the active one, because it is what the device is actually connected to.
 *
 * Idempotent: once the url is in the list, running again changes nothing.
 *
 * @param {object} a
 * @param {string|null} a.relayUrl   whatever `resolveRelayUrl` produced
 * @param {object} a.points          a `createConnectionPoints` store
 * @returns {{migrated: boolean}}
 */
export function adoptExistingRelay({ relayUrl, points } = {}) {
  if (!relayUrl || !points?.list) return { migrated: false };
  const known = points.list().some((p) => p.url === relayUrl);
  if (!known) points.addManually(relayUrl);
  // Either way, mark it live — this IS the connection the device has.
  points.setActive?.(relayUrl);
  return { migrated: !known };
}

