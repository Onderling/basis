/**
 * basis v2 — "did I write this?", for a chat message read back out of storage.
 *
 * A message you send is appended to the log optimistically with `actor: 'me'` — that stamp is
 * what both shells' bubbles test to decide alignment, whether to print a sender name, whether to
 * offer "report this message", and whether a delivery mark belongs on the row at all
 * (`circleView.js` / `CircleLauncherScreen.js`, both `row.actor === localActor`).
 *
 * `'me'` is a purely local stamp: it never leaves the device, so nothing durable records it. What
 * IS stored is the author — stoop's `broadcastCircleMessage` mirrors your outgoing message with
 * `source.fromActor = <you>`, exactly as it stores a peer's with theirs. So on the next launch the
 * rehydrator read your own words back, saw an author instead of `'me'`, and rendered them as
 * somebody else's: left-aligned, with a sender label and a "report" affordance on your own
 * sentence. The conversation you had yesterday came back a conversation with strangers.
 *
 * Seeding the send path's msgId into the inbox's dedup LRU — the other obvious fix — does not
 * address this at all: that LRU is in memory, so on the launch where the mis-attribution happens
 * it is empty by definition. Recognising your own authorship does, and it repairs history that is
 * ALREADY stored rather than only messages sent after the fix.
 *
 * ── "Am I the author" is a PER-CIRCLE question ──────────────────────────────────────────────
 * A device presents a different, unlinkable address in each circle (`circleAddressFor`, identity
 * 5B/C), so there is no single string to compare against. The check therefore asks, in order:
 *
 *   1. is the author this device's address IN THAT CIRCLE?   (`circleAddressFor(circleId)`)
 *   2. is the author one of my canonical identifiers?         (webid / pubKey / stableId)
 *
 * Both are needed. (1) is what a circle-scoped send is authored as; (2) is what the
 * currently-shipped local mirror records, because stoop stamps the caller's webid. Anything
 * older, or written by a device that had not derived its per-circle address yet, is only
 * recoverable through (2).
 *
 * ── Deliberately NOT applied to live inbound messages ───────────────────────────────────────
 * The author travels on the envelope, so a peer can put your identifier in it. Doing so on a LIVE
 * message would make their sentence render as yours — worse than the mis-attribution this fixes.
 * The inbox therefore applies this only to the paths that read messages BACK (rehydrator, pod,
 * catch-up) and never to `source: 'receiver'`, which loses nothing: your own fan-out does not loop
 * back to you, so a live message claiming to be from you is an echo or a forgery either way.
 * (See `chatMessageInbox.js`, which owns that rule.)
 */

/**
 * Build the predicate. Both seams are optional — with neither, it answers `false` for everything,
 * which is exactly today's behaviour, so a shell that cannot resolve its identity degrades to the
 * old rendering rather than to a wrong one.
 *
 * @param {object} deps
 * @param {() => Promise<{webid?:string, webId?:string, pubKey?:string, stableId?:string}|null>} [deps.whoAmI]
 *        resolves this device's canonical identity tuple (stoop's `whoAmI` skill).
 * @param {(circleId: string) => (string|null)} [deps.circleAddressFor]
 *        this device's per-circle address (the agent's `circleAddressFor`).
 * @returns {(envelope: object) => Promise<boolean>}
 */
export function createSelfAuthorCheck({ whoAmI = null, circleAddressFor = null } = {}) {
  /** My canonical identifiers, resolved once. `null` until the first successful read. */
  let canonicalIds = null;
  let inFlight = null;
  /** circleId → my address there. Derived, deterministic, so caching it is free. */
  const addressByCircle = new Map();

  function resolveCanonicalIds() {
    if (canonicalIds) return Promise.resolve(canonicalIds);
    if (typeof whoAmI !== 'function') return Promise.resolve(EMPTY);
    if (!inFlight) {
      inFlight = Promise.resolve()
        .then(() => whoAmI())
        .then((who) => {
          const ids = new Set();
          for (const v of [who?.webid, who?.webId, who?.pubKey, who?.stableId]) {
            if (typeof v === 'string' && v) ids.add(v);
          }
          // Only a non-empty answer is cached: a boot-time read that came back blank must be
          // retried, or every message of the session is attributed on incomplete evidence.
          if (ids.size) canonicalIds = ids;
          inFlight = null;
          return ids;
        })
        .catch(() => { inFlight = null; return EMPTY; });
    }
    return inFlight;
  }

  function addressFor(circleId) {
    if (typeof circleId !== 'string' || !circleId) return null;
    if (typeof circleAddressFor !== 'function') return null;
    if (addressByCircle.has(circleId)) return addressByCircle.get(circleId);
    let address = null;
    try { address = circleAddressFor(circleId) ?? null; } catch { address = null; }
    if (address) addressByCircle.set(circleId, address);   // a failed derivation stays retryable
    return address;
  }

  return async function isSelfAuthored(envelope) {
    const author = pickAuthor(envelope);
    if (!author) return false;   // an unauthored message is not evidence of anything
    if (author === addressFor(envelope?.circleId)) return true;
    return (await resolveCanonicalIds()).has(author);
  };
}

/** The author as the stored/wire envelope spells it. `fromActor` is canonical; `fromWebid` is the
 *  older spelling still present on the wire envelope (`chatEnvelope.js`). */
function pickAuthor(envelope) {
  for (const v of [envelope?.fromActor, envelope?.fromWebid]) {
    if (typeof v === 'string' && v) return v;
  }
  return null;
}

const EMPTY = new Set();
