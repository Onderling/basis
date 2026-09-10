#!/usr/bin/env node
/**
 * A DEVICE OF YOURS THAT NEVER SLEEPS — basis, headless, on a machine you keep running.
 *
 * Not a bot and not a server: the same agent the web and mobile shells boot, composed here with no
 * screen. It holds an identity in a file vault, joins the relay, is a full member of your circles, and
 * takes delivery of what arrives while your phone is in a drawer — then hands each turn to your other
 * devices, so the thread reads the same everywhere.
 *
 * That is the whole idea, and it is why this file is short. The lane table is the SAME one both shells
 * build (`src/v2/circleLanes.js`); the contact thread is the same channel; the router is the same
 * router. What a shell supplies as "repaint this" it supplies as "store this", and nothing else differs.
 * If that stops being true, this file has grown something it should not have.
 *
 * Telegram is optional and secondary. With a token present the same process also answers on Telegram,
 * which is why the personal box runs ONE process rather than two; without one it is simply a device.
 *
 *   ONDERLING_RELAY_URL=wss://relay.onderling.org node bin/device-runner.mjs --data-dir ~/.basis-device
 *
 * Env:
 *   ONDERLING_RELAY_URL      the relay to dial. Absent → local-only (no wire; useful for a first boot)
 *   BASIS_VAULT_PASSPHRASE   the vault key; absent → one is generated once beside the vault
 *   TG_BOT_TOKEN             optional — also answer on Telegram (or ~/.canopy-tg-token)
 *   TG_ALLOWED_CHAT_IDS      which chats may use it; unset/'*' is an OPEN DOOR
 *   PRIVATEMODE_API_KEY      optional — the confidential LLM route for free text
 *   BASIS_APP_URL            optional — the web app, so a printed enrolment offer is also a link
 *
 * Flags: --data-dir · --lang · --walk-log · --show-offer (print an add-a-device offer and exit)
 *
 * The recovery phrase is NEVER read from the environment or a file here. A device is enrolled by a
 * ceremony that asks for it, once; storing it beside the machine that runs unattended would hand the
 * whole account to anyone who reads that machine's disk.
 */
import { readFileSync, writeFileSync, existsSync, mkdirSync, appendFileSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import { homedir } from 'node:os';
import path from 'node:path';
import { parseArgs } from 'node:util';

import { VaultNodeFs } from '@onderling/vault';
import { buildHouseholdDataSource } from '@onderling-app/household';

import { createRealHouseholdAgent } from '../src/web/realAgent.js';
import { mergeManifests } from '../src/manifestMerge.js';
import { initLocalisation, t } from '../src/localisation.js';
import { createTelegramRunner } from '../src/telegram/runner.js';
import { loadAssistantItems } from '../src/v2/assistantEngine.js';
import { interpretToCommand } from '../src/v2/interpretCommand.js';
import { LlmClient } from '@onderling/llm-client';
import { privatemodeProvider, readPrivatemodeKey } from '@onderling/llm-client/providers/privatemode';
import { listsManifest } from '../../lists/manifest.js';

import { EventLog } from '../src/eventLog.js';
import { wireEventLogPersistence, fileSnapshotIo } from '../src/v2/eventLogPersistence.js';
import { makePeerRouter } from '../src/core/handlers/peerRouter.js';
import { buildCircleLanes } from '../src/v2/circleLanes.js';
import { createContactThreadChannel } from '../src/v2/contactThreadChannel.js';
import { createContactDmStore } from '../src/v2/contactDmStore.js';
import { makeHandleThreadedChat } from '../src/core/handlers/threadedChat.js';
import { makeCircleAddressAnnouncePeerHandler } from '../src/v2/circleAddressAnnounce.js';
import { makeRosterUpdatedPeerHandler } from '../src/v2/rosterUpdated.js';
import { applyRulesUpdates } from '../src/v2/rulesUpdateLane.js';
import { makeGovernanceRail } from '../src/v2/governanceAppWiring.js';

const { values } = parseArgs({ options: {
  'data-dir':   { type: 'string',  default: path.join(homedir(), '.basis-device') },
  lang:         { type: 'string',  default: 'nl' },
  'walk-log':   { type: 'string' },
  'show-offer': { type: 'boolean', default: false },
} });

const dataDir = path.resolve(values['data-dir']);
mkdirSync(dataDir, { recursive: true });
await initLocalisation({ lng: values.lang });

const relayUrl = (process.env.ONDERLING_RELAY_URL ?? '').trim();
const appUrl   = (process.env.BASIS_APP_URL ?? '').trim();

/** The vault key: the environment if set, else one generated once beside the vault — the machine that
 *  runs unattended holds it, which is the same trust as the disk the vault itself is on. */
function vaultPassphrase() {
  if (process.env.BASIS_VAULT_PASSPHRASE) return process.env.BASIS_VAULT_PASSPHRASE;
  const f = path.join(dataDir, 'vault.passphrase');
  if (!existsSync(f)) writeFileSync(f, randomBytes(32).toString('base64url'), { mode: 0o600 });
  return readFileSync(f, 'utf8').trim();
}

const vault = new VaultNodeFs(path.join(dataDir, 'vault.json'), vaultPassphrase());
// The CHAT-side vault, durable, because on a box there is no browser storage to fall back to.
//
// Without this the factory falls back to a MEMORY vault (`makeBrowserVault` has no `localStorage` here),
// and this device forgets, every restart, everything that lives on the chat side: the delegation blob
// that says which device it is, and — since content became sealed at rest — the key its own stored items
// are sealed under. A box is the one device that is expected to run for months untouched, so it is the
// worst possible host for a vault that only exists until the process does.
const chatVault = new VaultNodeFs(path.join(dataDir, 'chat-vault.json'), vaultPassphrase());

// The device log is the record every lane rides, so it is hydrated from disk BEFORE the agent boots:
// a device that forgets its log on restart would re-admit a connection its owner revoked, and would
// come back to its circles as if it had never been in them.
const deviceLog = new EventLog({ initial: [], muted: [] });
const { hydrated } = await wireEventLogPersistence({
  eventLog: deviceLog, io: fileSnapshotIo(path.join(dataDir, 'device-log.json')),
});

const agent = await createRealHouseholdAgent({
  ownerRootVault: vault,
  chatVault,
  householdPersistDb: { path: path.join(dataDir, 'household-items.json') },
  deviceLog,
  seedDemoData: false,
  seedHousehold: false,
});
const callSkill = (app, op, args) => agent.callSkill(app, op, args);

// The walk log — one JSON line per event, so a run can be read afterwards rather than retold.
const stamp = new Date().toISOString().replace(/[:.]/g, '-').replace('T', '_').slice(0, 19);
const walkLogFile = values['walk-log']
  ? values['walk-log'].replace(/(\.jsonl)?$/, `-${stamp}$1`)
  : path.join(dataDir, `walk-log-${stamp}.jsonl`);
const walkLog = (entry) => { try { appendFileSync(walkLogFile, JSON.stringify(entry) + '\n'); } catch { /* the log is not the product */ } };

// ── The add-a-device offer ──────────────────────────────────────────────────────────────────────
// Box-first: this machine is set up first and then hands its owner's next device the context it
// cannot derive from the recovery phrase — which circles, and where to reach a sibling. The offer is
// public by design: holding it grants nothing, because enrolling still takes the phrase.
async function printEnrollOffer() {
  const built = await callSkill('household', 'buildEnrollOffer', relayUrl ? { relayUrl } : {}).catch((e) => ({ error: String(e?.message ?? e) }));
  if (!built?.ok || !built.uri) {
    console.log(`device-runner: no offer to show yet — ${built?.reason ?? built?.error ?? 'this device is in no circles'}.`);
    console.log('  An offer names the circles a new device should pick up. Join or create one first.');
    return;
  }
  console.log('\n  Add another device — scan this code, or open the link, then type your recovery phrase there:\n');
  console.log(`    ${built.uri}`);
  if (appUrl) {
    const { enrollOfferLink } = await import('../src/v2/enrollOffer.js');
    const link = enrollOfferLink(appUrl, built.uri);
    if (link.ok) console.log(`    ${link.link}`);
  }
  console.log('');
}

if (values['show-offer']) { await printEnrollOffer(); process.exit(0); }

// ── The wire ────────────────────────────────────────────────────────────────────────────────────
let contactChannel = null;
if (relayUrl) {
  // The durable home of 1:1 threads, file-backed so a restart is the same conversations. Same
  // constructor both shells use; only the backing differs, which is the whole of what a shell decides.
  const dmSource = await buildHouseholdDataSource({ path: path.join(dataDir, 'contact-dm.json') }).catch(() => null);
  contactChannel = createContactThreadChannel({
    sendToPeer: (addr, payload) => agent.sendPeerMessage(addr, payload),
    itemStore:  createContactDmStore({ dataSource: dmSource, localActor: 'me' }),
    localActor: 'me',
    // A turn that arrives here is meant for the PERSON, so it goes on to their other devices.
    fanToOwnDevices: agent.contactTurnFan,
  });

  // What a shell would repaint, this device only stores. Every reaction below is that substitution and
  // nothing more — if one of them starts making a decision, it belongs in the shared table instead.
  const govRail = agent.circleIdentityFor
    ? makeGovernanceRail({ eventLog: deviceLog, circleIdentityFor: agent.circleIdentityFor, myRef: '', callSkill })
    : null;
  const lanes = buildCircleLanes({
    agent,
    govRail,
    eventLog: deviceLog,
    on: {
      govChange: (cid) => { if (govRail) applyRulesUpdates({ rail: govRail, callSkill, circleId: cid }).catch(() => {}); },
      // Nothing here asks a person whether to accept a big catch-up: there is no person at this
      // machine, and what it is catching up on is its owner's own circles. Allowing is therefore the
      // honest default rather than a silent refusal that would leave this device permanently behind —
      // but it is logged with its size, so an operator can see what it took.
      chatCatchUpOffer: ({ circleId, count, approxBytes, allow }) => {
        walkLog({ kind: 'catch-up', circleId, count, approxBytes });
        console.log(`device-runner: catching up ${count} message(s) in ${String(circleId).slice(0, 12)}… (~${(approxBytes / 1e6).toFixed(1)} MB)`);
        Promise.resolve(allow()).catch(() => {});
      },
      ownDeviceTurn: (wire) => contactChannel.applyOwnDeviceTurn(wire).catch(() => {}),
    },
  });

  const landTurn = ({ fromAddr, text, buttons, messageId, replyTo, ts }) => {
    contactChannel.persistInbound({ contactId: fromAddr, fromAddr, text, buttons, messageId, replyTo, ts })
      ?.then((r) => { if (!r?.deduped) walkLog({ kind: 'contact-turn', from: String(fromAddr).slice(0, 12), text }); })
      ?.catch(() => { /* durability is best-effort, as in the shells */ });
  };

  const router = makePeerRouter({
    handlers: {
      ...lanes.handlers,
      [contactChannel.subtypes.in]:  contactChannel.replyHandler(landTurn),
      [contactChannel.subtypes.out]: contactChannel.messageHandler(landTurn),
      // A member — above all this owner's OTHER device — says where it answers in a circle. Without
      // this the box never learns a sibling's address, its sibling set stays empty, and the fan above
      // has nowhere to go: the one message this device exists to pass on would stop here.
      'circle-address-announce': makeCircleAddressAnnouncePeerHandler({ agent, logger: { info: () => {}, warn: console.warn, error: console.error, debug: () => {} } }),
      // A roster owner says a row changed; the values are re-read, never carried on this wire.
      'roster-updated': makeRosterUpdatedPeerHandler({ eventLog: deviceLog, onPull: async () => {} }),
      // A reply to one of this device's noticeboard posts lands in that replier's thread, as on both shells.
      'chat-message': makeHandleThreadedChat({
        deliverToThread: ({ contactId, fromAddr, text, messageId, ts, replyTo }) =>
          landTurn({ fromAddr: contactId ?? fromAddr, text, messageId, ts, replyTo }),
        identityOf: (addr) => agent.identityOfAddress?.(addr) ?? addr,
      }),
    },
    defaultHandler: (from, payload) => walkLog({ kind: 'unrouted', from: String(from).slice(0, 12), subtype: payload?.subtype ?? null }),
    logger: { info: () => {}, warn: console.warn, error: console.error, debug: () => {} },
  });

  await agent.connectPeerTransport({ relayUrl, onPeerMessage: (env) => router(env) });

  // Which lanes this device actually carries. Said out loud because a missing rail is invisible: the
  // device would run, receive nothing on that lane, and look like a quiet network rather than a
  // half-composed agent.
  const live = Object.fromEntries(Object.entries(lanes.catchUps).map(([k, v]) => [k, !!v]));
  walkLog({ kind: 'lanes', ...live });
  const dark = Object.entries(live).filter(([, on]) => !on).map(([k]) => k);
  if (dark.length) console.warn(`device-runner: no rail for ${dark.join(', ')} — this device will not converge on ${dark.length === 1 ? 'that lane' : 'those lanes'}`);

  // The reconnect kicks: pull what arrived while this device was down, on every lane that has one.
  const kick = (cu, label, ms) => {
    if (!cu) return;
    setTimeout(() => {
      const p = typeof cu.requestFromSiblings === 'function'
        ? cu.requestFromSiblings()
        : cu.requestAll({ callSkill });
      Promise.resolve(p).catch(() => { /* the live fan keeps it current either way */ });
      walkLog({ kind: 'catch-up-kick', lane: label });
    }, ms);
  };
  kick(lanes.catchUps.gov, 'governance', 2000);
  kick(lanes.catchUps.membership, 'membership', 2500);
  kick(agent.grantsCatchUp, 'grants', 2500);
  kick(lanes.catchUps.task, 'tasks', 3000);
  kick(lanes.catchUps.chat, 'chat', 3500);
  kick(lanes.catchUps.key, 'keys', 3500);
}

// ── Telegram, only if a token is here ───────────────────────────────────────────────────────────
const tgToken = (() => {
  if (process.env.TG_BOT_TOKEN) return process.env.TG_BOT_TOKEN.trim();
  try { return readFileSync(path.join(homedir(), '.canopy-tg-token'), 'utf8').trim(); } catch { return null; }
})();
let tgRunner = null;
if (tgToken) {
  const { TelegramBridge } = await import('@onderling/chat-agent/bridges/telegram');
  const raw = String(process.env.TG_ALLOWED_CHAT_IDS ?? '').trim();
  const allowedChatIds = raw && raw !== '*' ? raw.split(',').map((s) => s.trim()).filter(Boolean) : '*';
  if (allowedChatIds === '*') console.warn('device-runner: OPEN TELEGRAM DOOR — no TG_ALLOWED_CHAT_IDS, every chat is admitted');

  const sources = [{ manifest: agent.manifest }, { manifest: listsManifest }];
  const catalogue = mergeManifests(sources);
  let llm = null; let llmModel = null;
  if (readPrivatemodeKey()) {
    const provider = await privatemodeProvider({ model: process.env.PRIVATEMODE_MODEL || undefined, timeoutMs: 60_000 });
    llm = new LlmClient({ provider }); llmModel = provider.model;
  }
  tgRunner = createTelegramRunner({
    bridge: new TelegramBridge({ botToken: tgToken, mode: 'long-polling' }),
    catalogue,
    manifestsByOrigin: Object.fromEntries(sources.map((s) => [s.manifest.app, s.manifest])),
    allowedChatIds, t, callSkill, lang: values.lang,
    loadItems: loadAssistantItems({ callSkill }),
    ...(llm ? { llm, interpret: interpretToCommand } : {}),
    walkLog,
  });
  await tgRunner.start();
  walkLog({ kind: 'telegram', door: allowedChatIds === '*' ? 'open' : 'allow-list', llm: llm ? llmModel : null });
}

// ── What the operator needs to see ──────────────────────────────────────────────────────────────
const card = await callSkill('stoop', 'getContactShareQr', {}).catch(() => null);
walkLog({ kind: 'run', ts: new Date().toISOString(), shell: 'device', relay: relayUrl || null, telegram: !!tgToken });
console.log(`\ndevice-runner: up — data in ${dataDir}`);
console.log(`  log       ${hydrated} entr${hydrated === 1 ? 'y' : 'ies'} restored from disk`);
console.log(`  wire      ${relayUrl || 'LOCAL ONLY (set ONDERLING_RELAY_URL to join the relay)'}`);
console.log(`  telegram  ${tgToken ? 'on' : 'off (no token)'}`);
if (card?.payload) {
  console.log('\n  This device as a contact — hand this to whoever should be able to write to you:\n');
  console.log(`    ${card.payload}\n`);
}
console.log(`  walk log  ${walkLogFile}\n`);

const stop = async () => {
  try { await tgRunner?.stop?.(); } catch { /* stopping is best-effort */ }
  process.exit(0);
};
process.on('SIGINT', stop);
process.on('SIGTERM', stop);
