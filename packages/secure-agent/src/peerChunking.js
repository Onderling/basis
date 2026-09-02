/**
 * Chunking OVER the peer façade — how a payload bigger than one envelope rides the sealed wire.
 *
 * Three layers each decide ONE thing (settled with Frits 2026-09-01): the CIRCLE POLICY decides where
 * a payload goes (fan-out · pod-signal · pod-only · ref+blob), seeing the size first; THIS decides how
 * bytes move on a peer route; the TRANSPORT only declares how big one envelope may be
 * (`maxEnvelopeBytes` — each transport answers for itself, NKN's silent ~64 KB ceiling included).
 *
 * The mechanism predates this file: `packages/core/src/protocol/fileSharing.js` chunk/ack/reassemble —
 * written, correct, and never called, because it sits BELOW the secure façade: sending through it would
 * bypass per-peer sealing, hold-forward and the roster authorizer on the way back in. So the WIRE SHAPE
 * is kept (`{type:'bulk-chunk', transferId, seq, data, final, meta}` — one protocol, not a second), and
 * the carry moves up: each chunk is an ordinary façade envelope, sealed and held like any other, and
 * the receiver reassembles just before the app's `onPeerMessage` — apps see the original payload whole
 * and never learn chunking exists. Callers never opt in, which is exactly why nobody called the old one.
 *
 * The doctrine ("the wire is a control plane", envelopeSize.js) is preserved by its own escape hatch:
 * chunks ARE control-sized envelopes. What this does not decide is whether a payload SHOULD travel at
 * all — a caller-side ceiling (a photo, not a video) belongs to the door that reads the file.
 */

/**
 * Sealing headroom: a chunk's `data` slice must survive JSON framing + nacl.box + base64 (~4/3) and
 * still fit the transport's envelope limit. A third of the limit keeps the sealed chunk comfortably
 * under it (the same 2×-plus margin the old fileSharing chose with 32 KB under 64 KB).
 */
const CHUNK_DIVISOR = 3;
/** Floor so a tiny declared limit still makes progress instead of degenerating into confetti. */
const MIN_CHUNK_CHARS = 4 * 1024;

/** Does this payload need chunking for a route with this envelope limit? Returns the serialised form. */
export function payloadOverRouteLimit(payload, maxEnvelopeBytes) {
  if (!Number.isFinite(maxEnvelopeBytes) || maxEnvelopeBytes <= 0) return null;
  if (payload?.type === 'bulk-chunk') return null;      // never chunk a chunk
  let json;
  try { json = JSON.stringify(payload); } catch { return null; }   // unserialisable → the send path's problem
  if (typeof json !== 'string') return null;
  // The same sealing-inflation reasoning as the chunk size, applied to the whole: sealing turns the
  // JSON into box ciphertext then base64 (×4/3) plus framing, so a payload at 3/4 of the limit lands
  // exactly ON it — half the limit is the honest "fits sealed, with room" threshold.
  if (json.length <= Math.floor(maxEnvelopeBytes / 2)) return null;
  return json;
}

/**
 * Split a payload into bulk-chunk envelopes for a route.
 * @returns {Array<object>|null} the chunk payloads in order (the last carries `final: true`),
 *   or null when the payload fits one envelope and no chunking is needed.
 */
export function chunkPayloadForRoute(payload, maxEnvelopeBytes, { transferId = null } = {}) {
  const json = payloadOverRouteLimit(payload, maxEnvelopeBytes);
  if (json === null) return null;
  const size = Math.max(MIN_CHUNK_CHARS, Math.floor(maxEnvelopeBytes / CHUNK_DIVISOR));
  const id = transferId ?? `xfer-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
  const out = [];
  for (let i = 0, seq = 0; i < json.length; i += size, seq += 1) {
    const final = i + size >= json.length;
    out.push({
      type: 'bulk-chunk',
      transferId: id,
      seq,
      data: json.slice(i, i + size),
      final,
      // `encoding:'json'` names THIS carry (a façade payload, reassembled to an object) apart from the
      // kernel fileSharing's base64 file bytes, which share the wire shape.
      meta: final ? { encoding: 'json' } : undefined,
    });
  }
  return out;
}

/**
 * The receiver half. Returns a function `(env) => boolean` — true when the envelope was a chunk and is
 * consumed (buffered, or completed into `onPayload(reconstructed, env)`); false to let it pass.
 *
 * Incomplete transfers are evicted after `ttlMs` (a sender that died mid-transfer must not grow the
 * buffer forever); eviction is lazily swept on arrival, so an idle agent holds no timers.
 */
export function makeChunkReassembler({
  onPayload, ttlMs = 120_000, maxTransfers = 32, maxTransferChars = 24 * 1024 * 1024,
} = {}) {
  const inflight = new Map();   // `${from} ${transferId}` → {chunks: string[], size, touched}
  const sweep = (now) => {
    for (const [k, v] of inflight) {
      if (now - v.touched > ttlMs) inflight.delete(k);
    }
  };
  return function maybeReassemble(env) {
    const p = env?.payload;
    if (p?.type !== 'bulk-chunk' || typeof p.transferId !== 'string') return false;
    const now = Date.now();
    sweep(now);
    // Keyed by SENDER + transfer: another peer cannot append into (or poison) someone else's transfer.
    const key = `${env._from} ${p.transferId}`;
    let entry = inflight.get(key);
    if (!entry) {
      if (inflight.size >= maxTransfers) return true;   // over budget: swallow rather than grow unbounded
      entry = { chunks: [], size: 0, touched: now };
      inflight.set(key, entry);
    }
    entry.touched = now;
    if (Number.isInteger(p.seq) && p.seq >= 0) {
      const data = String(p.data ?? '');
      // A sender streaming endless non-final chunks must not grow this buffer without bound — a photo
      // fits comfortably under the cap; past it the whole transfer is dropped, never truncated.
      entry.size += data.length;
      if (entry.size > maxTransferChars) { inflight.delete(key); return true; }
      entry.chunks[p.seq] = data;
    }
    if (p.final) {
      inflight.delete(key);
      // A gap means a lost chunk — drop the transfer rather than deliver a mutilated payload
      // (envelopeSize.js: refuse, never truncate).
      for (let i = 0; i < entry.chunks.length; i += 1) {
        if (typeof entry.chunks[i] !== 'string') return true;
      }
      const joined = entry.chunks.join('');
      if (p.meta?.encoding === 'json') {
        let whole = null;
        try { whole = JSON.parse(joined); } catch { return true; }   // unparseable → refused, not delivered
        try { onPayload(whole, env); } catch { /* the app's problem, not the wire's */ }
        return true;
      }
      // Not ours (the kernel fileSharing's base64 carry, should it ever ride here): let it pass whole.
      return false;
    }
    return true;
  };
}
