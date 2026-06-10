// signalRouting.js — route CONFIRMED signals (crisis / safety / …) to their configured destinations
// at release. Destinations come from the project config's `signal.destinations` map (e.g.
// `{ crisis: '113 / gemeentelijk meldpunt', safety: 'afdeling Openbare Ruimte' }`); the actual delivery
// (a meldpunt API, an email, a pod write) is the INJECTED `send` — this module is the routing mechanism,
// not the transport.
//
// Best-effort + RECORDED: a routing failure never blocks the release (the report still publishes), but
// is returned as `{ routed:false, error }` so the curator can see + retry it. NOTE: the crisis TIMING /
// escalation protocol (how fast, on what consent, duty-to-act) is M15 — this wires the destinations.

/**
 * @param {object} a
 * @param {Array<{signal?:string, severity?:string, confirmed?:boolean}>} a.signals  aggregate.signals
 * @param {Record<string,string>} [a.destinations]   signal/severity → destination (config.signal.destinations)
 * @param {(d:{destination:string, signal:object, reportId?:string, now?:string})=>any|Promise<any>} [a.send]
 * @param {string} [a.reportId]
 * @param {string} [a.now]
 * @returns {Promise<Array<{signal, severity, destination, routed, reason?, error?}>>}
 */
export async function routeSignals({ signals, destinations = {}, send, reportId, now } = {}) {
  const out = [];
  for (const s of (Array.isArray(signals) ? signals : [])) {
    if (!s || !s.confirmed) continue;                          // only route CONFIRMED signals
    const destination = destinations[s.signal] ?? destinations[s.severity] ?? destinations['*'] ?? null;
    if (!destination) {
      out.push({ signal: s.signal, severity: s.severity, destination: null, routed: false, reason: 'no-destination' });
      continue;
    }
    try {
      if (typeof send === 'function') await send({ destination, signal: s, reportId, now });
      out.push({ signal: s.signal, severity: s.severity, destination, routed: true });
    } catch (err) {
      out.push({ signal: s.signal, severity: s.severity, destination, routed: false, error: err?.message ?? String(err) });
    }
  }
  return out;
}
