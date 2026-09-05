#!/usr/bin/env node
/**
 * The Telegram shell of basis — the same agent, reached from Telegram.
 *
 * Boots a headless basis node (the production factory the web and mobile shells use), composes the
 * same manifests, and hands a Telegram bridge to the shared runner (`src/telegram/runner.js`): a
 * slash command or a button tap goes through the SAME compilers as a typed line in the app. No
 * command table of its own; no LLM route yet (free text answers with the help hint until a
 * confidential route is configured).
 *
 * Usage:
 *   TG_BOT_TOKEN=…  TG_ALLOWED_CHAT_IDS=123,456  node bin/telegram-runner.mjs [--data-dir ./.basis-telegram] [--lang nl]
 *   (the token may also live in ~/.canopy-tg-token; TG_ALLOWED_CHAT_IDS pairs the owner's chats —
 *    an unpaired chat is told its chat id so it can be added.)
 */
import { readFileSync, writeFileSync, existsSync, mkdirSync, appendFileSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import { homedir } from 'node:os';
import path from 'node:path';
import { parseArgs } from 'node:util';

import { TelegramBridge } from '@onderling/chat-agent/bridges/telegram';
import { VaultNodeFs } from '@onderling/vault';

import { createRealHouseholdAgent } from '../src/web/realAgent.js';
import { mergeManifests } from '../src/manifestMerge.js';
import { initLocalisation, t } from '../src/localisation.js';
import { createTelegramRunner } from '../src/telegram/runner.js';
import { createTokenGate } from '../src/v2/tokenGate.js';
import { interpretToCommand } from '../src/v2/interpretCommand.js';
import { LlmClient } from '@onderling/llm-client';
import { privatemodeProvider, readPrivatemodeKey } from '@onderling/llm-client/providers/privatemode';
import { circleGateRules } from '../src/v2/circleGate.js';
import { listsManifest } from '../../lists/manifest.js';

const { values } = parseArgs({ options: {
  'data-dir': { type: 'string', default: path.join(homedir(), '.basis-telegram') },
  lang:       { type: 'string', default: 'nl' },
  'walk-log': { type: 'string' },   // default <data-dir>/walk-log.jsonl — one JSON record per turn, readable after a walk
} });

function readToken() {
  if (process.env.TG_BOT_TOKEN) return process.env.TG_BOT_TOKEN.trim();
  try { return readFileSync(path.join(homedir(), '.canopy-tg-token'), 'utf8').trim(); } catch { return null; }
}
const token = readToken();
if (!token) { console.error('telegram-runner: set TG_BOT_TOKEN (or put the token in ~/.canopy-tg-token)'); process.exit(2); }
// TG_ALLOWED_CHAT_IDS=123,456 pairs exactly those chats; unset (or '*') is the OPEN DOOR: anyone who finds the
// bot can use it — fine for a first try on a test bot, not for a bot that holds anything of yours.
const rawAllow = String(process.env.TG_ALLOWED_CHAT_IDS ?? '').trim();
const allowedChatIds = rawAllow && rawAllow !== '*' ? rawAllow.split(',').map((s) => s.trim()).filter(Boolean) : '*';
if (allowedChatIds === '*') console.warn('telegram-runner: OPEN DOOR — no TG_ALLOWED_CHAT_IDS, every chat is admitted');

const dataDir = path.resolve(values['data-dir']);
mkdirSync(dataDir, { recursive: true });
await initLocalisation({ lng: values.lang });

// The node keeps its identity in an encrypted file vault under the data dir and its list items in a
// file-backed store, so a restart is the same assistant with the same lists. The vault passphrase
// comes from BASIS_VAULT_PASSPHRASE or, failing that, a random one generated once beside the vault
// (the machine that runs the assistant holds it — same trust as the token file).
function vaultPassphrase() {
  if (process.env.BASIS_VAULT_PASSPHRASE) return process.env.BASIS_VAULT_PASSPHRASE;
  const f = path.join(dataDir, 'vault.passphrase');
  if (!existsSync(f)) writeFileSync(f, randomBytes(32).toString('base64url'), { mode: 0o600 });
  return readFileSync(f, 'utf8').trim();
}
const vault = new VaultNodeFs(path.join(dataDir, 'vault.json'), vaultPassphrase());
const agent = await createRealHouseholdAgent({
  ownerRootVault: vault,
  householdPersistDb: { path: path.join(dataDir, 'household-items.json') },
  seedDemoData: false,
});
const householdManifest = agent.manifest;
const sources = [{ manifest: householdManifest }, { manifest: listsManifest }];
const catalogue = mergeManifests(sources);
const manifestsByOrigin = Object.fromEntries(sources.map((s) => [s.manifest.appId ?? s.manifest.name, s.manifest]));

// The confidential route: with a Privatemode key on this machine the assistant understands free text
// (the SDK attests the enclave and encrypts end-to-end here); without one it runs in basic mode —
// commands and the deterministic gate only. PRIVATEMODE_MODEL picks the model (default gpt-oss-120b).
let llm = null; let llmModel = null;
if (readPrivatemodeKey()) {
  const provider = await privatemodeProvider({ model: process.env.PRIVATEMODE_MODEL || undefined, timeoutMs: 60_000 });
  llm = new LlmClient({ provider }); llmModel = provider.model;
}
const bridge = new TelegramBridge({ botToken: token, mode: 'long-polling' });
// The walk log: one JSON line per turn (in, path, dispatch, replies, ms) after a header that says what
// this run IS (model, route, language, apps) — so a walk can be read afterwards instead of retold.
const walkLogFile = values['walk-log'] || path.join(dataDir, 'walk-log.jsonl');
const walkLog = (entry) => appendFileSync(walkLogFile, JSON.stringify(entry) + '\n');
walkLog({ kind: 'run', ts: new Date().toISOString(), shell: 'telegram', lang: values.lang, apps: sources.map((s) => s.manifest.appId ?? s.manifest.name),
  commands: catalogue.commandMenu?.length ?? 0, llm: llm ? { provider: 'privatemode', model: llmModel } : null, door: allowedChatIds === '*' ? 'open' : 'allow-list' });
const runner = createTelegramRunner({
  bridge, catalogue, manifestsByOrigin, allowedChatIds, t,
  callSkill: (app, op, args) => agent.callSkill(app, op, args),
  // The deterministic gate the circle composer uses ("add X" / "done X" route without a model).
  // The interpreter (an LLM route) is wired once a confidential route is configured.
  gate: createTokenGate({ rules: circleGateRules(values.lang) }),
  ...(llm ? { llm, interpret: interpretToCommand } : {}),
  walkLog,
});
await runner.start();
console.log(`telegram-runner: walk log → ${walkLogFile}`);
console.log(`telegram-runner: up — data in ${dataDir}, ${allowedChatIds === '*' ? 'open door' : `${allowedChatIds.length} paired chat(s)`}, ${catalogue.commandMenu?.length ?? 0} commands, ${llm ? `smart chat via Privatemode (${llmModel})` : 'basic mode (no Privatemode key)'}`);

const stop = async () => { try { await runner.stop(); } finally { process.exit(0); } };
process.on('SIGINT', stop); process.on('SIGTERM', stop);
