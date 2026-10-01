#!/usr/bin/env node
/**
 * walk-bot-inbox — talk to a household bot through its contact inbox, as a web contact would.
 *
 * Boots ONE headless basis node with a kept identity (WALK_DIR), connects it to the relay, and sends each line to the
 * bot's address as a contact turn; prints what came back. The bot, its gate and its model are the real ones: the same
 * assistant answers this door and Telegram.
 *
 *   WALK_DIR=/tmp/walker BOT_ADDR=<the bot's peerAddr> node scripts/walk-bot-inbox.mjs            # prints this walker's id
 *   WALK_DIR=/tmp/walker BOT_ADDR=… WALK_LINES='zet melk op de boodschappen|wat staat er op de lijst' node scripts/walk-bot-inbox.mjs
 *
 * WALK_CODE rides the first line as the admission code. A line's replies are collected until WALK_SETTLE_MS after the
 * last one (the bot can answer in more than one message).
 */
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { randomBytes } from 'node:crypto';
import path from 'node:path';
import { VaultNodeFs } from '@onderling/vault';
import { bootRealAgentNode, teardown } from '../test/support/pairRealAgents.js';
import { createContactThreadChannel } from '../src/v2/contactThreadChannel.js';
import { decodeContactCard } from '../src/v2/contactCardLink.js';

const dir = process.env.WALK_DIR;
const botAddr = process.env.BOT_ADDR;
const relayUrl = process.env.RELAY_URL || 'wss://relay.onderling.org';
if (!dir || !botAddr) { console.error('walk: set WALK_DIR and BOT_ADDR'); process.exit(2); }
const lines = String(process.env.WALK_LINES ?? '').split('|').map((s) => s.trim()).filter(Boolean);
const settleMs = Number(process.env.WALK_SETTLE_MS || 6000);
const firstMs = Number(process.env.WALK_TIMEOUT_MS || 120_000);

await mkdir(dir, { recursive: true });
const passFile = path.join(dir, 'vault.passphrase');
let pass = await readFile(passFile, 'utf8').catch(() => null);
if (!pass) { pass = randomBytes(32).toString('base64url'); await writeFile(passFile, pass, { mode: 0o600 }); }

const node = await bootRealAgentNode('walker', {
  agentOpts: {
    ownerRootVault: new VaultNodeFs(path.join(dir, 'vault.json'), pass),
    chatVault: new VaultNodeFs(path.join(dir, 'chat-vault.json'), pass),
  },
});
const replies = [];
const channel = createContactThreadChannel({ sendToPeer: (addr, payload) => node.agent.sendPeerMessage(addr, payload), sealFor: node.agent.contactSeal?.sealFor ?? null, openFor: node.agent.contactSeal?.openFor ?? null });
// The bot answers as a person does (`contact-msg`); a bot-style `contact-reply` is taken too.
// A reply's buttons are printed too (`[id] label`), so a walk can tap one by sending its id.
const take = (r) => {
  replies.push({ at: Date.now(), text: r.text });
  console.log(`< ${String(r.text).replace(/\n/g, '\n  ')}`);
  for (const b of Array.isArray(r.buttons) ? r.buttons : []) console.log(`  [${b.id ?? b.callbackData ?? '?'}] ${b.label ?? b.text ?? ''}`);
};
const onReply = channel.replyHandler(take);
const onMessage = channel.messageHandler(take);
await node.agent.connectPeerTransport({
  relayUrl, awaitRelayReady: true,
  onPeerMessage: (env) => { onReply(env.from, env.payload); onMessage(env.from, env.payload); node._routerRef?.fn?.(env); },
});

const card = decodeContactCard((await node.agent.callSkill('stoop', 'getContactShareQr', {}).catch(() => null))?.payload ?? '');
console.log(`walker   ${card?.webid ?? '?'}`);

const wait = (ms) => new Promise((r) => setTimeout(r, ms));
let code = process.env.WALK_CODE || null;
for (const text of lines) {
  const from = replies.length;
  const started = Date.now();
  await channel.sendTurn({ peerAddr: botAddr, threadId: botAddr, text, ...(code ? { admission: code } : {}) }).sent;
  code = null;
  console.log(`\n> ${text}`);
  while (replies.length === from && Date.now() - started < firstMs) await wait(250);
  if (replies.length === from) { console.log('  (no reply)'); continue; }
  while (Date.now() - replies[replies.length - 1].at < settleMs) await wait(250);
  // the replies were printed as they came; here, how long each took
  for (const r of replies.slice(from)) console.log(`  [${((r.at - started) / 1000).toFixed(1)}s]`);
}
await teardown(node);
process.exit(0);
