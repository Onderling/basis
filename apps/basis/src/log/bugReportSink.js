// Anonymous bug-report SINK — the injected `sendReport` for the feedback surface's "Report a problem"
// panel (feedbackSurface.js `emitReportSend`). It DELIVERS the already-anonymous envelope
// (buildReportEnvelope — see bugReport.js) over the host's existing relay/peer transport to a
// config-driven dev "bug-report bot" address. Shared, pure glue: web ≡ mobile — each shell injects
// `send` (its `agent.sendPeerMessage`) + the `target` address at boot; nothing platform-specific lives here.
//
// ANONYMITY GUARANTEE (by construction): this sink adds NO identity. It forwards the envelope EXACTLY as the
// surface built it — the envelope is anonymous by construction (no chatId, no participant pseudonym / agent
// public key, no webid, no handle, no device id, and no field any of those could ride; see bugReport.js) —
// wrapped only in a transport `type` tag. There is NO code path here that reads an identity, a signing key,
// the sender's own address, or the transport's return value into the outgoing message. `send`'s own routing
// (which address this device sends FROM) is the transport's concern, not part of the payload.
//
// FOLLOW-UP (out of scope): the dev-pod bug-report BOT that RECEIVES + stores these, and the real dev-pod
// address, are a follow-up — here we only forward to a configured target and prove the interface with a fake
// in-memory receiver in the test. Sharing a circle may later imply sharing this relay (a per-circle relay),
// not built here.

/**
 * Build the injected `sendReport(envelope)` sink for `createFeedbackSurface`.
 * @param {object} a
 * @param {(target:string, msg:object)=>Promise<any>} [a.send]  the host's fire-and-forget peer/relay send
 *                                                              (e.g. `agent.sendPeerMessage`)
 * @param {string|null} [a.target]  the dev bug-report bot address (config/env driven; null → copy-only)
 * @param {()=>number} [a.clock]    optional `at` source, used ONLY to stamp a timestamp the caller omitted
 * @param {string} [a.app]          non-identifying app name, used ONLY to backfill an envelope missing it
 * @param {string} [a.version]      non-identifying app/build version, used ONLY to backfill a missing one
 * @returns {(envelope:object)=>Promise<{ok:boolean, reason?:string}>}
 */
export function createBugReportSink({ send, target, clock, app, version } = {}) {
  // Graceful degrade to today's copy-only behaviour: with no transport OR no configured target, the panel's
  // Send button reports "not set up here" (the surface's `no-target`/no-sink line) instead of failing. The
  // real dev-pod address is not built yet, so this is the default in shipped config. NEVER throws.
  if (typeof send !== 'function' || !target) {
    return async () => ({ ok: false, reason: 'no-target' });
  }
  return async function sendReport(envelope) {
    const env = envelope || {};
    // Forward the ANONYMOUS envelope AS-IS — never re-shape or enrich it with identity. The surface already
    // stamps `at`; `clock`/`app`/`version` are pure defensive backfill for a caller that didn't (they carry
    // no identity). Spread the envelope AFTER the type tag so its own fields always win.
    const at = (env.at != null) ? env.at : (typeof clock === 'function' ? clock() : undefined);
    const msg = { type: 'bug-report', ...env };
    if (msg.at == null && at != null) msg.at = at;
    if (msg.app == null && app != null) msg.app = app;
    if (msg.version == null && version != null) msg.version = version;
    try {
      await send(target, msg);
      return { ok: true };
    } catch (e) {
      // Caught (never propagated) so the surface degrades to its localised "sending failed — copy the notes"
      // bubble. The reason carries the transport error class/message only (PII-safe — no user data).
      return { ok: false, reason: String(e?.message || e?.name || 'send-failed') };
    }
  };
}
