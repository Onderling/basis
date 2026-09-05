#!/usr/bin/env node
/**
 * walk-feedback-contact — the live walk of "an external bot reached as a contact" (plan step 5).
 *
 * Boots ONE headless basis node, connects it to a relay, discovers a bot by its card URL, and sends
 * it a turn through the shared contact-thread channel — so the whole seam runs for real: the card
 * (with its `redact: 'pre-send'` ask) → the peer record → the roster row → the pre-send floor on
 * THIS side → the relay → the bot → its reply back over the same channel.
 *
 *   FEEDBACK_BOT_URL=http://localhost:8794 RELAY_URL=ws://localhost:8791 node scripts/walk-feedback-contact.mjs
 *
 * Exits 0 when a reply came back; prints what left the device (redacted) versus what was typed.
 */
import { discoverA2A, PeerGraph } from '@onderling/core';
import { bootRealAgentNode, teardown, until } from '../test/support/pairRealAgents.js';
import { createContactThreadChannel } from '../src/v2/contactThreadChannel.js';
import { peerToContactRow } from '../src/v2/contactsSource.js';
import { presendFloorFor } from '../src/v2/presendFloor.js';

const botUrl = process.env.FEEDBACK_BOT_URL;
const relayUrl = process.env.RELAY_URL;
if (!botUrl || !relayUrl) { console.error('walk: set FEEDBACK_BOT_URL and RELAY_URL'); process.exit(2); }
const typed = process.env.WALK_TEXT || 'De wachtlijst bij de GGZ is veel te lang. Mijn nummer is 06 12345678, bel me.';

const node = await bootRealAgentNode('walker');
const replies = [];
const channel = createContactThreadChannel({ sendToPeer: (addr, payload) => node.agent.sendPeerMessage(addr, payload) });
const onReply = channel.replyHandler((r) => replies.push(r));
await node.agent.connectPeerTransport({
  relayUrl, awaitRelayReady: true,
  onPeerMessage: (env) => { onReply(env.from, env.payload); node._routerRef?.fn?.(env); },
});

// 1. the card → the peer record (with the bot's ask) → the roster row → the floor
const peerGraph = new PeerGraph();
const rec = await discoverA2A({}, botUrl, { peerGraph });
const row = peerToContactRow(rec);
const floor = presendFloorFor(row);
console.log(`card     ${rec.name} · pubKey ${String(rec.pubKey).slice(0, 12)}… · redact ${JSON.stringify(rec.redact)}`);
console.log(`floor    ${floor ? 'ON (pre-send, on this device)' : 'off'}`);
if (!rec.pubKey) { console.error('walk: the card carries no pubKey — the bot is not reachable over the peer link'); await teardown(node); process.exit(1); }

// 2. the turn — redacted here when the floor applies; the bot never sees the raw line
const { sent, text: left, redacted } = channel.sendTurn({ peerAddr: rec.pubKey, threadId: 'walk', text: typed, floor });
await sent;
console.log(`typed    ${typed}`);
console.log(`left     ${left}   (${redacted} redacted)`);

// 3. the reply, back over the same channel (the bot's LLM turn can take a while on a local model)
const timeoutMs = Number(process.env.WALK_TIMEOUT_MS || 180_000);
try {
  await until(() => replies.length > 0, { timeout: timeoutMs, step: 200 });
  console.log(`reply    ${replies[0].text}${replies[0].buttons?.length ? `  [${replies[0].buttons.map((b) => b.label).join(' · ')}]` : ''}`);
  await teardown(node);
  process.exit(0);
} catch {
  console.error(`walk: no reply within ${timeoutMs} ms`);
  await teardown(node);
  process.exit(1);
}
