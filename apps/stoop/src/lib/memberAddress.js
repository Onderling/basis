/**
 * Resolving a circle member to a ROUTABLE address — G13 step C.
 *
 * A member presents a different address in every circle (`deriveCircleAddress`), proven at join and stored
 * on the roster. Until now nothing routed to it: the fan resolved `pubKey`, falling back to the webid, so
 * every message to every circle went to the member's ONE global signing key and a relay saw a single
 * identity across all of them (audit item G13).
 *
 * This is the one place that decides, so the rule cannot drift between the fan paths:
 *
 *   circleAddress  →  pubKey  →  webid
 *
 * **GATED, and off by default (2026-07-27).** Preferring the per-circle address only works once the
 * RECIPIENT is listening on it — step B — and step B currently covers `RelayTransport` ONLY.
 * `InternalTransport` and `NknTransport` have no alias support, so turning this on globally would route
 * messages to an address nobody answers on those paths. Discovered by basis's real-agent tests going red,
 * which is exactly what they are for. `preferCircleAddress` flips on per-caller once B is complete across
 * transports; until then the ladder starts at `pubKey` and behaves as before.
 *
 * **The fallbacks are instrumented on purpose.** They are how we learn when step D — dropping them — is
 * safe. Without a record of "someone is still being reached the old way", D is a guess, and D is the
 * irreversible step. `onFallback` fires once per (circle, member, reason) so a busy circle does not drown
 * the signal it is meant to produce.
 */

/** Why a member was reached the way they were. `circle-address` is the goal; the rest are the old path. */
export const ADDRESS_VIA = Object.freeze({
  CIRCLE: 'circle-address',
  PUBKEY: 'pubkey',
  WEBID: 'webid',
});

/**
 * @param {object} member                      a roster row
 * @param {object} [opts]
 * @param {string} [opts.circleId]             for the fallback report
 * @param {(webid: string) => Promise<object|null>} [opts.resolveByWebid]  MemberMap lookup when the row is lossy
 * @param {(info: {circleId, webid, via}) => void} [opts.onFallback]  called when NOT using the circle address
 * @param {boolean} [opts.preferCircleAddress=false]  G13 step C. OFF until every transport registers
 *   aliases (step B covers RelayTransport only today) — see the note above.
 * @returns {Promise<{addr: string|null, via: string|null, webid: string|null}>}
 */
export async function resolveMemberAddress(member, {
  circleId = null, resolveByWebid = null, onFallback = null, preferCircleAddress = false,
} = {}) {
  const m = member && typeof member === 'object' ? member : null;
  const webid = typeof member === 'string' ? member : (m?.webid ?? m?.webId ?? null);

  // 1. The per-circle address — the whole point. Recorded on the roster ONLY when its proof verified
  //    (`verifyCircleLink`), so anything present here is already trustworthy.
  const circleAddress = typeof m?.circleAddress === 'string' && m.circleAddress ? m.circleAddress : null;
  if (preferCircleAddress && circleAddress) return { addr: circleAddress, via: ADDRESS_VIA.CIRCLE, webid };

  // 2. The global signing key. Correct today, and the reason G13 exists.
  let addr = typeof m?.pubKey === 'string' && m.pubKey ? m.pubKey : null;
  if (!addr && webid && typeof resolveByWebid === 'function') {
    try { addr = (await resolveByWebid(webid))?.pubKey ?? null; } catch { addr = null; }
  }
  if (addr) {
    // Only a FALLBACK when we were trying for the circle address; otherwise this is the configured path
    // and reporting it would be noise about a decision nobody made.
    if (preferCircleAddress) report(onFallback, { circleId, webid, via: ADDRESS_VIA.PUBKEY });
    return { addr, via: ADDRESS_VIA.PUBKEY, webid };
  }

  // 3. basis circles bind webid === the member's chat pubKey, so a webid is routable when the (lossy)
  //    MemberMap captured no pubKey — strictly more reachable than nothing.
  if (webid) {
    if (preferCircleAddress) report(onFallback, { circleId, webid, via: ADDRESS_VIA.WEBID });
    return { addr: webid, via: ADDRESS_VIA.WEBID, webid };
  }

  return { addr: null, via: null, webid };
}

function report(onFallback, info) {
  if (typeof onFallback !== 'function') return;
  try { onFallback(info); } catch { /* reporting must never break a send */ }
}

/**
 * A once-per-(circle, member, reason) reporter — the default `onFallback`.
 *
 * Dedupes so the signal stays readable: the question is *"is anyone still on the old path?"*, which one
 * line per member answers and one line per message buries.
 *
 * @param {(msg: string) => void} [sink]
 * @returns {(info: {circleId, webid, via}) => void}
 */
export function makeFallbackReporter(sink = (msg) => console.info(msg)) {
  const seen = new Set();
  return function reportFallback({ circleId, webid, via }) {
    const key = `${circleId ?? '?'}\n${webid ?? '?'}\n${via}`;
    if (seen.has(key)) return;
    seen.add(key);
    sink(`[addressing] G13 fallback: circle=${circleId ?? '?'} member=${String(webid ?? '?').slice(0, 16)}… `
      + `reached via ${via} (no per-circle address). Step D cannot drop the fallback while this appears.`);
  };
}
