/**
 * fileSharing.js — smart file dispatch and BT bulk-transfer (Group D).
 *
 * sendFile decides how to deliver a FilePart:
 *   • Small files (< SIZE_THRESHOLD) or A2A peers → inline OW message
 *   • Large files to native peers               → chunked BT bulk transfer
 *
 * BT bulk transfer:
 *   Sender splits the data into CHUNK_SIZE-byte pieces and sends each as an
 *   AS (AckSend) envelope, waiting for the transport-level AK before the next
 *   chunk. The final chunk carries _final:true so the receiver can reassemble.
 *
 * Receiver accumulates chunks in StateManager and emits 'file-received' on the
 * agent once all chunks arrive.
 *
 * Wire payload formats:
 *   OW  { type:'file',       filePart: FilePart, from: string }
 *   AS  { type:'bulk-chunk', transferId, seq, data:base64, final:bool }
 *       → receiver auto-ACKs (Transport sends AK for every AS)
 */
import { DataPart, FilePart as _FilePart, Parts } from '../Parts.js';
import { genId } from '../Envelope.js';

import { param, PARAM_SCOPE, PARAM_KIND } from '../params.js';

// Parameter register (#36) — file-sharing size threshold + chunk size (scope:device, kind:internal).
const SIZE_THRESHOLD = param({ key: 'fileSharing.sizeThresholdBytes', scope: PARAM_SCOPE.DEVICE, kind: PARAM_KIND.INTERNAL, default: 64 * 1024 });   // 64 KB
const CHUNK_SIZE     = param({ key: 'fileSharing.chunkBytes',         scope: PARAM_SCOPE.DEVICE, kind: PARAM_KIND.INTERNAL, default: 32 * 1024 });   // 32 KB per BT chunk

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Send a file to a peer. Chooses inline or bulk-transfer automatically.
 *
 * @param {import('../Agent.js').Agent} agent
 * @param {string}  peerId
 * @param {object}  filePart   — { type:'FilePart', mimeType, name?, data? (base64), url? }
 * @param {object}  [opts]
 * @param {number}  [opts.threshold=65536]   — bytes above which bulk transfer is used
 */
export async function sendFile(agent, peerId, filePart, opts = {}) {
  const threshold = opts.threshold ?? SIZE_THRESHOLD;
  const data      = filePart.data;   // base64 string | undefined
  const byteLen   = data ? Math.ceil(data.length * 0.75) : 0;  // base64 → bytes approx

  if (!data || byteLen < threshold) {
    // Small file or URL-only: send inline as OW message.  Per-peer
    // routing — `agent.transport` is the primary slot.
    const t = await agent.transportFor(peerId);
    await t.sendOneWay(peerId, {
      type:     'file',
      filePart,
      from:     agent.address,
    });
  } else {
    // Large file: chunk it.
    await bulkTransferSend(agent, peerId, null, data, {
      mimeType: filePart.mimeType,
      name:     filePart.name,
    });
  }
}

/**
 * Send arbitrary base64 data as a chunked bulk transfer.
 * Each chunk is sent with sendAck (transport waits for AK before proceeding).
 *
 * @param {import('../Agent.js').Agent} agent
 * @param {string}  peerId
 * @param {string|null}  transferId  — null = auto-generated
 * @param {string}  data             — base64 encoded bytes
 * @param {object}  [meta]           — { mimeType, name } forwarded to receiver
 * @returns {Promise<string>} transferId
 */
export async function bulkTransferSend(agent, peerId, transferId, data, meta = {}) {
  const id     = transferId ?? genId();
  const chunks = _splitBase64(data, CHUNK_SIZE);

  // Per-peer routing — resolve once before the chunk loop so every
  // chunk goes via the same transport (and isn't re-routed if
  // FallbackTable changes mid-transfer).
  const t = await agent.transportFor(peerId);

  for (let seq = 0; seq < chunks.length; seq++) {
    const final = seq === chunks.length - 1;
    await t.sendAck(peerId, {
      type:       'bulk-chunk',
      transferId: id,
      seq,
      data:       chunks[seq],
      final,
      meta:       final ? meta : undefined,
    });
  }

  return id;
}

// ── Inbound handler ───────────────────────────────────────────────────────────

/**
 * Handle an inbound 'file' or 'bulk-chunk' OW/AS envelope.
 * Returns true if handled.
 *
 * @param {import('../Agent.js').Agent} agent
 * @param {object} envelope
 * @returns {boolean}
 */
export function handleBulkChunk(agent, envelope) {
  const payload = envelope.payload ?? {};

  // ── Inline file ────────────────────────────────────────────────────────────
  if (payload.type === 'file') {
    agent.emit('file-received', {
      from:     envelope._from,
      filePart: payload.filePart,
    });
    return true;
  }

  // ── Bulk chunk ─────────────────────────────────────────────────────────────
  if (payload.type !== 'bulk-chunk') return false;

  const { transferId, seq, data, final, meta = {} } = payload;
  if (!transferId) return false;

  // Use StateManager stream registry to accumulate chunks.
  let entry = agent.stateManager.getStream(transferId);
  if (!entry) {
    agent.stateManager.openStream(transferId, { taskId: transferId, peerId: envelope._from });
    entry = agent.stateManager.getStream(transferId);
  }

  // Store this chunk in order.
  if (!entry._chunks) entry._chunks = [];
  entry._chunks[seq] = data;

  if (final) {
    // Reassemble all chunks.
    const assembled = entry._chunks.join('');
    agent.stateManager.closeStream(transferId);

    const filePart = {
      type:     'FilePart',
      mimeType: meta.mimeType ?? 'application/octet-stream',
      name:     meta.name     ?? transferId,
      data:     assembled,
    };

    agent.emit('file-received', {
      from: envelope._from,
      filePart,
      transferId,
    });
  }

  return true;
}

// ── Private helpers ───────────────────────────────────────────────────────────

/**
 * Split a base64 string into roughly equal pieces of at most `chunkBytes` bytes.
 * The split is on base64 characters (4 chars = 3 bytes), so we split at the
 * nearest multiple of 4 for correctness.
 */
function _splitBase64(b64, chunkBytes) {
  // Each base64 char represents 6 bits; chunkBytes * 8 / 6 = chunkBytes * 4/3 chars.
  const chunkChars = Math.ceil(chunkBytes * 4 / 3);
  const aligned    = Math.ceil(chunkChars / 4) * 4;  // round up to multiple of 4
  const chunks     = [];
  for (let i = 0; i < b64.length; i += aligned) {
    chunks.push(b64.slice(i, i + aligned));
  }
  return chunks.length ? chunks : [''];
}
