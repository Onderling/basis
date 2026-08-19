/**
 * pubSub.js — topic-based publish/subscribe over PB envelopes.
 *
 * Native-to-native only. A2A peers use the 'subscribe' skill (streaming task).
 *
 * Agent keeps a subscriber registry: topic → Set<peerAddress>
 * When a peer sends { type:'subscribe', topic } as OW, we add them.
 * When a peer sends { type:'unsubscribe', topic } as OW, we remove them.
 * publish() fans out to all registered subscribers.
 */
import { Parts } from '../Parts.js';

/**
 * Subscribe to a topic on a publisher agent.
 * Sends a subscribe request and listens for PB envelopes from that peer.
 *
 * @param {import('../Agent.js').Agent} agent
 * @param {string}   publisherAddress
 * @param {string}   topic
 * @param {Function} callback — called with (parts) on each published message
 */
export async function subscribe(agent, publisherAddress, topic, callback) {
  // Register listener BEFORE sending the subscribe OW so history replay
  // messages (fired as microtasks by the publisher) are not missed.
  const listener = ({ from, topic: t, parts }) => {
    if (from === publisherAddress && t === topic) callback(parts);
  };
  agent.on('publish', listener);

  // Use `transportFor(peer)` so cross-device routing (mDNS / relay /
  // BLE / etc.) wins; `agent.transport` is the primary slot which on
  // mobile is the InternalTransport (self-loop only).
  const t = await agent.transportFor(publisherAddress);
  await t.sendOneWay(publisherAddress, { type: 'subscribe', topic });

  // Return a cleanup function that fully tears down the subscription:
  // both the local listener AND the publisher-side registration. This
  // is additive — callers that ignore the return value get the same
  // behaviour as before (the listener stays registered).
  return async () => {
    agent.off('publish', listener);
    try { await unsubscribe(agent, publisherAddress, topic); }
    catch { /* publisher may already be gone; local listener removal is what matters */ }
  };
}

/**
 * Unsubscribe from a topic on a publisher agent.
 *
 * @param {import('../Agent.js').Agent} agent
 * @param {string} publisherAddress
 * @param {string} topic
 */
export async function unsubscribe(agent, publisherAddress, topic) {
  // Same routing rationale as subscribe(): pick the right transport
  // for the publisher peer.
  const t = await agent.transportFor(publisherAddress);
  await t.sendOneWay(publisherAddress, { type: 'unsubscribe', topic });
}

/**
 * Publish a message to all local subscribers for a topic.
 * Uses OW (PB envelope type).
 *
 * @param {import('../Agent.js').Agent} agent
 * @param {string}   topic
 * @param {Array|*}  partsOrValue
 */
export async function publish(agent, topic, partsOrValue) {
  const parts = Parts.wrap(partsOrValue);

  // Store in history if the agent has history configured.
  const maxHistory = agent.pubSubHistory ?? 0;
  if (maxHistory > 0) {
    if (!agent._pubSubHistory) agent._pubSubHistory = new Map();
    if (!agent._pubSubHistory.has(topic)) agent._pubSubHistory.set(topic, []);
    const hist = agent._pubSubHistory.get(topic);
    hist.push(parts);
    while (hist.length > maxHistory) hist.shift();
  }

  const subs = agent._pubSubSubscribers?.get(topic);
  if (!subs || subs.size === 0) return;

  // Per-subscriber routing — each subscriber may be reachable via a
  // different transport (mDNS for the LAN peer, relay for the
  // off-network one, etc.). The previous code used `agent.transport`
  // (primary slot) which on mobile is the InternalTransport — never
  // crosses processes, silently dropped every cross-device fan-out.
  await Promise.all([...subs].map(async (addr) => {
    try {
      const t = await agent.transportFor(addr);
      await t.publishOneWay(addr, topic, { type: 'publish', topic, parts });
    } catch (err) {
      agent.emit('error', err);
    }
  }));
}

/**
 * Handle an inbound subscribe/unsubscribe/publish OW envelope.
 * Returns true if handled.
 *
 * @param {import('../Agent.js').Agent} agent
 * @param {object} envelope
 */
export function handlePubSub(agent, envelope) {
  const { type, topic, parts = [] } = envelope.payload ?? {};

  switch (type) {
    case 'subscribe': {
      if (!agent._pubSubSubscribers) agent._pubSubSubscribers = new Map();
      if (!agent._pubSubSubscribers.has(topic)) agent._pubSubSubscribers.set(topic, new Set());
      agent._pubSubSubscribers.get(topic).add(envelope._from);
      // Replay history to new subscriber.  Same per-peer routing
      // fix as publish() — pick the right transport for the
      // subscriber rather than blindly using the primary slot.
      const history = agent._pubSubHistory?.get(topic);
      if (history?.length) {
        for (const parts of history) {
          (async () => {
            try {
              const t = await agent.transportFor(envelope._from);
              await t.publishOneWay(envelope._from, topic, { type: 'publish', topic, parts });
            } catch (err) {
              agent.emit('error', err);
            }
          })();
        }
      }
      return true;
    }
    case 'unsubscribe': {
      agent._pubSubSubscribers?.get(topic)?.delete(envelope._from);
      return true;
    }
    case 'publish': {
      // Inbound publish from a peer (for local subscribers who used subscribe()).
      agent.emit('publish', { from: envelope._from, topic, parts });
      return true;
    }
    default:
      return false;
  }
}
