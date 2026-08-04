/**
 * basis v2 — the address-fallback setting, and the offer that makes it findable.
 *
 * **The setting** (Frits, 2026-07-28): per user, not per circle — per circle was judged too technical —
 * and **OFF by default**. Off means we route to a member's per-circle address or not at all; on means we
 * may fall back to their one global key, which is what lets a relay see that your circles belong to the
 * same person.
 *
 * ── Why this file is mostly about the OFFER ──────────────────────────────────────────────────────────────
 * A setting whose default is "more private" is easy. The hard part is that **its failure mode is silence.**
 * Off does not produce an error, a bounce, or a red icon — it produces messages that nobody answers, which
 * is indistinguishable from being ignored. Nobody goes looking in settings for that.
 *
 * So the setting is only a real choice if something notices and offers it. We already have the detector:
 * `resolveMemberAddress` reports every time it refuses to fall back. This turns that stream into an offer,
 * and Frits' call is that **the chat makes it** — which is right, because it arrives at the moment the
 * person is actually confused about why nobody replied, rather than as a banner nobody reads.
 *
 * Three rules the offer has to follow, and they are the reason this is logic rather than a `if (count > 0)`:
 *
 *   1. **Not on the first failure.** One undelivered message is normal — the person is offline, the app is
 *      closed. Offering immediately trains people to dismiss it.
 *   2. **Not repeatedly.** An offer declined is an answer; asking again is nagging, and nagging a privacy
 *      setting until someone says yes is a dark pattern regardless of intent.
 *   3. **Never the fix without its cost.** The offer names what turning it on gives away, in the same
 *      breath. An offer that only says "this will fix it" is not a choice either.
 */

/** Distinct peers who must be unreachable before we say anything. One is noise; two is a pattern. */
export const OFFER_AFTER_PEERS = 2;
/** And a declined offer stays declined for this long. */
export const OFFER_COOLDOWN_MS = 7 * 24 * 60 * 60_000;

/*
 * (Batch 4) The per-user SETTING itself lives in `deliverySettings.js` (`allowFallback` — one store,
 * both shells' toggles, and the live read the agent now holds). A duplicate store half lived here for
 * a while — the same setting under a second key (`cc.allowAddressFallback`) that no product path ever
 * read. Two stores of one fact is how two views of it come to disagree; the duplicate retired, the
 * OFFER below stayed — it is this file's actual job.
 */

/**
 * Watch the undeliverable reports and decide when to offer.
 *
 * Fed by `resolveMemberAddress`'s `onFallback` — specifically the `blocked: true` reports, which are the
 * ones the setting caused. Ordinary fallbacks (the setting is on, we used the global key) are NOT a reason
 * to offer anything; they are the setting working.
 *
 * @param {object} deps
 * @param {(offer: object) => void} deps.onOffer   fires ONCE per cooldown, with everything needed to render
 * @param {() => number} [deps.now]
 * @param {object} [deps.state]                    `{ declinedAt }` restored from storage
 * @param {(state: object) => any} [deps.save]
 * @param {number} [deps.afterPeers]
 * @param {number} [deps.cooldownMs]
 * @returns {{report, shouldOffer, decline, accept, reset, blockedPeers}}
 */
export function createFallbackOffer({
  onOffer = null, now = () => Date.now(), state = null, save = null,
  afterPeers = OFFER_AFTER_PEERS, cooldownMs = OFFER_COOLDOWN_MS,
} = {}) {
  /** Distinct peers we could not reach because the setting is off. Peers, not messages: ten to one person
   *  is one person being unreachable, and counting messages would fire on a single retry loop. */
  const blocked = new Set();
  let declinedAt = typeof state?.declinedAt === 'number' ? state.declinedAt : 0;
  let offered = false;

  const persist = () => { try { save?.({ declinedAt }); } catch { /* best-effort */ } };

  return {
    /** Feed one report from `resolveMemberAddress`. Ignores anything the setting did not cause. */
    report(info) {
      if (!info?.blocked) return;
      const who = info.webid ?? info.circleId ?? null;
      if (!who) return;
      blocked.add(who);
      if (offered || !this.shouldOffer()) return;
      offered = true;
      try {
        onOffer?.({
          peers: blocked.size,
          // The renderer pairs these two. The cost is not optional — see rule 3.
          messageKey: 'circle.nearbyScreen.delivery_fallback_hint',
          costKey: 'circle.nearbyScreen.delivery_fallback_cost',
          actionKey: 'circle.nearbyScreen.delivery_fallback_enable',
        });
      } catch { /* an offer that throws must not break the send path that produced it */ }
    },

    /** Enough evidence, and not recently declined. */
    shouldOffer() {
      if (blocked.size < afterPeers) return false;          // rule 1
      return now() - declinedAt >= cooldownMs;              // rule 2
    },

    /** They said no. That is an answer — record it so we stop asking. */
    decline() { declinedAt = now(); offered = false; persist(); },

    /** They said yes. Clear the evidence; if it recurs, that is new information. */
    accept() { blocked.clear(); declinedAt = 0; offered = false; persist(); },

    /** Distinct peers currently unreachable because of the setting. */
    blockedPeers: () => blocked.size,

    /** Forget everything (a sign-out, a profile switch). */
    reset() { blocked.clear(); offered = false; },
  };
}
