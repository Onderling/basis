/**
 * secureMeshEnvelopeAdapter — a `@onderling/notify-envelope` transport adapter that
 * routes over basis's REAL cross-peer wire (the secure-mesh chat agent),
 * instead of an app meshAgent's in-process bus.
 *
 * OBJ-2 keystone (2026-06-18). The tasks/stoop substrate mirror builds its
 * notify-envelope transport with `createAgentTransportAdapter(agent)`, which
 * fans out per-recipient via `agent.transportFor(addr)`. In basis the app
 * agents are InternalTransport(bus)-only, so that adapter never crosses devices.
 * This adapter implements the SAME `{ publishEnvelope, subscribeEnvelopes }`
 * contract but sends each envelope through `sendPeerMessage(to, …)` — the chat
 * agent's `sa.peer.sendTo` (NKN/relay/mdns/rendezvous, routed by the unified
 * RoutingStrategy) — and receives via `handleInbound`, which the chat agent's
 * single inbound peer-message router calls for every message. So the unchanged
 * `wireXSubstrateMirror` (household, and later tasks/stoop) syncs across real
 * devices. Transport-agnostic by construction: the mirror doesn't know which
 * wire it's on.
 *
 * Wire shape matches `createAgentTransportAdapter`'s exactly, so notify-envelope
 * (which validates `transport.publishEnvelope`/`subscribeEnvelopes` and reads
 * `kind`/`ref`/`payload`/`etag`/`_v`/`fromActor` off the inbound envelope) is a
 * drop-in. Envelopes are namespaced under a `tag` key on the peer-message
 * payload so the router can tell them apart from DMs / circle-posts / calendar
 * invites that share the same `sendPeerMessage` channel.
 *
 * @param {object} args
 * @param {(to:string, payload:object)=>Promise<void>} args.sendPeerMessage
 *   the chat agent's fire-and-forget cross-peer send (e.g. realAgent.sendPeerMessage).
 * @param {string} [args.tag='__ntfyEnv']  peer-message key that carries the wire envelope.
 * @param {string} [args.selfAddress]      this agent's address; filtered out of fan-out (no self-send).
 * @returns {{ publishEnvelope:Function, subscribeEnvelopes:Function, handleInbound:Function }}
 */
export function createSecureMeshEnvelopeAdapter({ sendPeerMessage, tag = '__ntfyEnv', selfAddress = null } = {}) {
  if (typeof sendPeerMessage !== 'function') {
    throw new Error('createSecureMeshEnvelopeAdapter: sendPeerMessage required');
  }
  const subscribers = new Set();

  function toWire(env) {
    return {
      v:         1,
      kind:      env.kind,
      timestamp: env.timestamp ?? new Date().toISOString(),
      ...(env.ref        !== undefined ? { ref: env.ref }             : {}),
      ...(env.etag       !== undefined ? { etag: env.etag }           : {}),
      ...(typeof env._v === 'number'   ? { _v: env._v }               : {}),
      ...(env.fromActor  !== undefined ? { fromActor: env.fromActor } : {}),
      ...(env.payload    !== undefined ? { payload: env.payload }     : {}),
    };
  }

  return {
    async publishEnvelope({ recipients, ...env } = {}) {
      if (!Array.isArray(recipients) || recipients.length === 0) return;
      if (typeof env.kind !== 'string' || env.kind.length === 0) {
        throw Object.assign(
          new Error('publishEnvelope: `kind` is required'),
          { code: 'INVALID_ARGUMENT' },
        );
      }
      const msg = { [tag]: toWire(env) };
      await Promise.all(recipients.map(async (to) => {
        if (!to || (selfAddress && to === selfAddress)) return;   // never fan out to self
        try { await sendPeerMessage(to, msg); }
        catch { /* best-effort fan-out — local write is the source of truth */ }
      }));
    },

    subscribeEnvelopes(callback) {
      if (typeof callback !== 'function') return () => {};
      subscribers.add(callback);
      return () => subscribers.delete(callback);
    },

    /**
     * The chat agent's inbound peer-message router calls this for EVERY inbound
     * message. Returns true iff the payload was a notify-envelope (consumed);
     * false lets the router fall through to its other handlers (DMs, etc.).
     */
    handleInbound(fromAddress, payload) {
      const wire = payload && typeof payload === 'object' ? payload[tag] : null;
      if (!wire || typeof wire !== 'object' || typeof wire.kind !== 'string') return false;
      // Stamp the sender when the publisher didn't carry an explicit fromActor,
      // so the mirror can attribute the write (and self-heal back to source).
      if (wire.fromActor === undefined && fromAddress) wire.fromActor = fromAddress;
      for (const cb of subscribers) { try { cb(wire); } catch { /* swallow — UI reflects next sync */ } }
      return true;
    },
  };
}
