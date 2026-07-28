/**
 * messaging.js — simple message send/receive.
 *
 * sendMessage: tries AS (acknowledged), falls back to OW on timeout.
 * handleMessage: dispatches inbound OW/AS to agent 'message' event.
 */
import { Parts } from '../Parts.js';

/**
 * Send a message to a peer. Tries acknowledged delivery; falls back to OW.
 *
 * @param {import('../Agent.js').Agent} agent
 * @param {string}   peerId
 * @param {Array|*}  partsOrValue
 * @param {object}   [opts]
 * @param {number}   [opts.ackTimeout=5000]
 * @param {boolean}  [opts.requireAck=false]  — throw if no ACK received
 */
export async function sendMessage(agent, peerId, partsOrValue, opts = {}) {
  const parts = Parts.wrap(partsOrValue);
  const { ackTimeout = 5_000, requireAck = false, onDelivery = null } = opts;
  // Per-peer routing — `agent.transport` is the primary slot which on
  // mobile is the InternalTransport (self-loop only).
  const t = await agent.transportFor(peerId);
  // `onDelivery` reports what ACTUALLY happened, so a caller can show the truth instead of "sent".
  // Three outcomes, and the middle one is the whole reason this exists:
  //   acked          → the peer's transport confirmed  ('reached-device')
  //   downgraded     → we asked, heard nothing, sent it anyway. It may well have arrived and the ack may
  //                    have been lost, so this is neither success nor failure ('maybe-received')
  //   requireAck     → the caller wants the throw, and gets it; nothing is claimed
  const report = (outcome) => {
    if (typeof onDelivery !== 'function') return;
    try { onDelivery(outcome); } catch { /* reporting must never break a send */ }
  };

  try {
    await t.sendAck(peerId, { type: 'message', parts }, ackTimeout);
    report({ acked: true, downgraded: false });
  } catch (err) {
    if (requireAck) throw err;
    // Fall back to fire-and-forget over the same transport.
    await t.sendOneWay(peerId, { type: 'message', parts });
    report({ acked: false, downgraded: true });
  }
}

/**
 * Handle an inbound OW or AS message envelope.
 * Emits 'message' on the agent.
 *
 * @param {import('../Agent.js').Agent} agent
 * @param {object} envelope
 */
export function handleMessage(agent, envelope) {
  const parts = envelope.payload?.parts ?? [];
  agent.emit('message', {
    from:  envelope._from,
    parts,
  });
}
