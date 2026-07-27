/**
 * DISCOVERABILITY — the three states a discovering transport can be in.
 *
 * Two independent things happen on a local network: you LISTEN for who is around, and you ANNOUNCE that you
 * are. Conflating them is what makes "am I visible?" unanswerable — mDNS today starts both in a single
 * native call, so counting the devices near you costs you being counted by them.
 *
 *   off             — neither. Not started, not constructed.
 *   browse          — listen only. "Ghost mode": you see the room, the room does not see you.
 *   browse+publish  — listen and announce. The only state in which a stranger can find you.
 *
 * There is deliberately no `publish`-without-`browse`. Announcing while refusing to listen is a state with
 * no user, and leaving it out means the three values form a straight LADDER of exposure — which is what
 * makes `maxExposure` below meaningful.
 *
 * ── Why this is a port concept and not an app setting ────────────────────────────────────────────────────
 * `CLAUDE.md`: *go through the surface, never the transport.* An app must not reach into `MdnsTransport` to
 * flip advertising. So the state lives on the `Transport` port, one adapter says HOW, and the mesh surface
 * exposes ONE control over all of them — the same shape as extra addresses (G13).
 */

/** The three states. */
export const DISCOVERABILITY = Object.freeze({
  OFF: 'off',
  BROWSE: 'browse',
  PUBLISH: 'browse+publish',
});

/**
 * Exposure ORDER — low to high. A ladder, so "which of these two is more exposed" is answerable, which is
 * what lets a surface aggregate several transports honestly (see `maxExposure`).
 */
export const DISCOVERABILITY_ORDER = Object.freeze([
  DISCOVERABILITY.OFF,
  DISCOVERABILITY.BROWSE,
  DISCOVERABILITY.PUBLISH,
]);

/** Is `v` one of the three? */
export function isDiscoverability(v) {
  return DISCOVERABILITY_ORDER.includes(v);
}

/**
 * Coerce an untrusted value to a state.
 *
 * An unrecognised value resolves to `off` — deny-by-default, because the failure it guards against is a
 * typo'd setting leaving a device announcing itself. The caller is told (`{ ok: false }`) rather than
 * silently corrected, so a bug does not hide behind the safe answer.
 *
 * @returns {{ ok: boolean, value: string, reason?: string }}
 */
export function normalizeDiscoverability(v) {
  if (isDiscoverability(v)) return { ok: true, value: v };
  return { ok: false, value: DISCOVERABILITY.OFF, reason: 'unknown-discoverability' };
}

/** Does this state announce us to others? */
export function publishes(state) { return state === DISCOVERABILITY.PUBLISH; }

/** Does this state listen for others? */
export function browses(state) {
  return state === DISCOVERABILITY.BROWSE || state === DISCOVERABILITY.PUBLISH;
}

/**
 * The MORE exposed of two states.
 *
 * This is the aggregation rule for a surface that spans several transports, and it points the way it does
 * on purpose: if you ask to be unlisted and one transport cannot comply, the honest answer to "am I
 * visible?" is **yes** — because you are. Reporting the requested state, or the average, or the state of
 * the transport that did comply, would each turn a partial failure into a false assurance.
 */
export function maxExposure(a, b) {
  const ia = DISCOVERABILITY_ORDER.indexOf(a);
  const ib = DISCOVERABILITY_ORDER.indexOf(b);
  if (ia < 0) return isDiscoverability(b) ? b : DISCOVERABILITY.OFF;
  if (ib < 0) return a;
  return ia >= ib ? a : b;
}

/**
 * THE SURFACE — one discoverability control over every transport a device discovers on.
 *
 * This is the object an app talks to. It exists so that "make me discoverable" is a single call with a
 * single answer, rather than the app knowing which transports are present, which of them discover, and
 * which one silently disagreed. Reaching past this to a transport is the signal that the surface is missing
 * an affordance (`CLAUDE.md`).
 *
 * **The aggregate is the MOST exposed transport, not the requested state.** If mDNS cannot go browse-only
 * and BLE can, you are still being announced — so `effective` says `browse+publish` and `degraded` is true.
 * A surface that averaged, or reported the request, would let a user believe they were unlisted while a
 * radio in their pocket said otherwise.
 *
 * @param {object} deps
 * @param {() => Record<string, object|null>} deps.transports  named transports; re-read on every call, so a
 *   transport built later (or dropped) is picked up without re-creating the control
 * @param {(report: object) => void} [deps.onChange]    every applied change, degraded or not
 * @param {(report: object) => void} [deps.onDegraded]  only when the result is more exposed than requested
 * @returns {{set, state, requested, isPublishing, isBrowsing, report}}
 */
export function createDiscoverabilityControl({ transports, onChange = null, onDegraded = null } = {}) {
  if (typeof transports !== 'function') {
    throw new TypeError('createDiscoverabilityControl: `transports` must be a function returning named transports');
  }

  let requested = DISCOVERABILITY.OFF;
  let effective = DISCOVERABILITY.OFF;
  let perTransport = [];

  const notify = (fn, report) => { try { fn?.(report); } catch { /* diagnostics must never break the surface */ } };

  // `degraded` means MORE exposed than asked — the dangerous direction, and the only one worth alarming
  // about. Being LESS exposed (a device with no radio, Wi-Fi off) is a `shortfall`: worth showing in a UI
  // as "Nearby is unavailable", never worth warning about as a privacy failure. Collapsing the two into one
  // flag is what made this surface warn on a laptop that simply has no mDNS.
  const buildReport = () => ({
    requested,
    effective,
    degraded:  effective !== requested && maxExposure(effective, requested) === effective,
    shortfall: effective !== requested && maxExposure(effective, requested) === requested,
    perTransport: perTransport.map((r) => ({ ...r })),
  });

  return {
    /**
     * Apply a state to every discovering transport.
     *
     * A transport that throws does not abort the others — going quiet on two radios out of three is
     * strictly better than going quiet on none, and the failure surfaces in `perTransport` + `effective`.
     */
    async set(state) {
      const norm = normalizeDiscoverability(state);
      requested = norm.value;

      const named = Object.entries(transports() ?? {}).filter(([, t]) => t && t.supportsDiscoverability);
      const results = [];
      for (const [name, t] of named) {
        try {
          const r = await t.setDiscoverability(requested);
          results.push({ name, ...r });
        } catch (err) {
          // An adapter that throws out of setDiscoverability broke its own contract (the base returns a
          // result). Assume it is doing whatever it was doing, or the request — whichever is worse.
          results.push({
            name, ok: false, requested,
            effective: maxExposure(effective, requested),
            degraded: true, reason: err?.message ?? 'threw',
          });
        }
      }

      perTransport = results;
      // No discovering transport at all ⇒ genuinely off. Otherwise: the worst answer anyone gave.
      effective = results.reduce((acc, r) => maxExposure(acc, r.effective), DISCOVERABILITY.OFF);

      const report = buildReport();
      notify(onChange, report);
      if (report.degraded) notify(onDegraded, report);
      return report;
    },

    /**
     * Re-announce on every discovering transport at the state they are already in (Nearby step C).
     *
     * The caller for this is a network change — a Wi-Fi switch, airplane mode off, a long background. The
     * device believes it is discoverable and is technically correct; the announcement is just bound to an
     * interface that is gone. Without this, you are invisible until something happens to restart a
     * transport, and nothing routinely does.
     *
     * It deliberately does NOT change the requested state: a transport resting at `off` stays off. A
     * network event must never be able to make a device that chose invisibility start announcing.
     */
    async reannounce() {
      const named = Object.entries(transports() ?? {}).filter(([, t]) => t && t.supportsDiscoverability);
      const results = [];
      for (const [name, t] of named) {
        try {
          const r = await t.reannounce();
          results.push({ name, requested, ...r, degraded: false });
        } catch (err) {
          results.push({
            name, ok: false, requested, effective: t.discoverability ?? effective,
            degraded: false, reason: err?.message ?? 'threw',
          });
        }
      }
      if (results.length) {
        perTransport = results;
        effective = results.reduce((acc, r) => maxExposure(acc, r.effective), DISCOVERABILITY.OFF);
      }
      const report = buildReport();
      notify(onChange, report);
      if (report.degraded) notify(onDegraded, report);
      return report;
    },

    /** What the device is ACTUALLY doing, across all transports. */
    get state() { return effective; },

    /** What was last asked for — kept separate so a UI can show both when they disagree. */
    get requested() { return requested; },

    /** Is this device announcing itself to anyone, by any transport? */
    get isPublishing() { return publishes(effective); },

    /** Is this device listening for anyone? */
    get isBrowsing() { return browses(effective); },

    /** The full picture, including which transport gave which answer. */
    report() { return buildReport(); },
  };
}
