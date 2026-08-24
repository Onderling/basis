/**
 * pubSub.js — topic-based publish/subscribe over PB envelopes.
 *
 * Native-to-native only. A2A peers use the 'subscribe' skill (streaming task).
 *
 * Agent keeps a subscriber registry: topic → Set<peerAddress>
 * When a peer sends { type:'subscribe', topic } as OW, we add them.
 * When a peer sends { type:'unsubscribe', topic } as OW, we remove them.
 * publish() fans out to all registered subscribers.
 *
 * THE REGISTRY IS A MEMBERSHIP LIST, and it lives on the PUBLISHER. That is the useful part: who
 * receives what we broadcast is our decision, not the subscriber's. It is also the part that was
 * never maintained — a subscribe was registered unconditionally and nothing ever removed one, so a
 * person removed from a circle kept receiving everything that circle broadcast, and a stranger who
 * could reach our address could register for a circle topic and have its history replayed to them.
 * Two things follow, and neither works without the other:
 *
 *   - `authorizeSubscribe` — an injected port, because the kernel does not know what a circle is.
 *     Same shape and same rationale as the SecurityLayer's sender authorizer.
 *   - `dropSubscriber` — so a removal reaches this list. Without the port a dropped subscriber
 *     simply re-registers; without the drop the port only binds people who have not subscribed yet.
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
 * Install the subscribe-authorization port: `(context) => boolean|Promise<boolean>`, asked of
 * every inbound subscribe with `{topic, from}`. Returning false refuses the registration silently — the caller
 * learns nothing about why, which is the same posture the sender authorizer takes.
 *
 * The kernel has no opinion about which topics are sensitive; an app that scopes topics to circles
 * installs one that says so.
 *
 * @param {import('../Agent.js').Agent} agent
 * @param {((c: {topic: string, from: string}) => boolean|Promise<boolean>)|null} authorizer
 */
export function setSubscribeAuthorizer(agent, authorizer) {
  agent._authorizeSubscribe = typeof authorizer === 'function' ? authorizer : null;
}

/**
 * Ask the port, failing OPEN when none is installed — and saying so once, loudly.
 *
 * Open is the right default for a kernel that is also used by test rigs and single-peer tools, and
 * it is the wrong state for an app with circles. The SecurityLayer settled this exact question the
 * same way, for the same reason, and the difference is invisible unless something says it out loud.
 */
async function askSubscribeAuthorizer(agent, context) {
  const fn = agent._authorizeSubscribe;
  if (typeof fn !== 'function') {
    if (!agent._warnedNoSubscribeAuthorizer) {
      agent._warnedNoSubscribeAuthorizer = true;
      console.warn(
        '[pubsub] NO SUBSCRIBE AUTHORIZER INSTALLED — any address that can reach this agent may '
        + 'register for any topic and have its history replayed. Install one with '
        + 'setSubscribeAuthorizer(agent, fn). This warning appears once per agent.',
      );
    }
    return true;
  }
  try { return (await fn(context)) !== false; }
  catch { return false; }   // a throwing authorizer refuses; it must never fail open
}

/**
 * Remove one address from the subscriber registry — every topic, or only those under a prefix.
 *
 * `topicPrefix` is how a removal stays LOCAL to one circle. Circle topics are named
 * `<circleId>/<suffix>`, so passing `` `${circleId}/` `` drops the departed from that circle's
 * broadcasts and leaves every other circle you share with them untouched. Dropping them everywhere
 * would repeat the mistake the per-circle exit was built to undo: tidying up one circle severing
 * the relationship in all of them.
 *
 * @param {import('../Agent.js').Agent} agent
 * @param {string} address
 * @param {{topicPrefix?: string|null}} [opts]
 * @returns {number} how many topic registrations were dropped
 */
export function dropSubscriber(agent, address, { topicPrefix = null } = {}) {
  const reg = agent?._pubSubSubscribers;
  if (!reg || typeof address !== 'string' || !address) return 0;
  let dropped = 0;
  for (const [topic, subs] of reg) {
    if (topicPrefix && !String(topic).startsWith(topicPrefix)) continue;
    if (subs.delete(address)) dropped += 1;
  }
  return dropped;
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
      // THE GATE. `_authorizeSubscribe` answers "may this address receive what we publish here",
      // and it is asked BEFORE the registration and therefore before the history replay — a refusal
      // that happened after the replay would have handed over exactly what it was refusing.
      //
      // Handled either way; the DECISION may be asynchronous, because the honest answer to "is this
      // address still a member" is a roster read, and pretending otherwise would force the app to
      // keep a second membership copy — which is the shape of the bug this closes. Subscribes
      // happen at setup, not per message, so the cost lands where it does not matter.
      (async () => {
        if (!(await askSubscribeAuthorizer(agent, { topic, from: envelope._from }))) return;
        if (!agent._pubSubSubscribers) agent._pubSubSubscribers = new Map();
        if (!agent._pubSubSubscribers.has(topic)) agent._pubSubSubscribers.set(topic, new Set());
        agent._pubSubSubscribers.get(topic).add(envelope._from);
        // Replay history to new subscriber.  Same per-peer routing
        // fix as publish() — pick the right transport for the
        // subscriber rather than blindly using the primary slot.
        const history = agent._pubSubHistory?.get(topic);
        if (history?.length) {
          for (const parts of history) {
            try {
              const t = await agent.transportFor(envelope._from);
              await t.publishOneWay(envelope._from, topic, { type: 'publish', topic, parts });
            } catch (err) {
              agent.emit('error', err);
            }
          }
        }
      })().catch((err) => agent.emit('error', err));
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
