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
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
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
import { circleGateRules } from '../src/v2/circleGate.js';
import { listsManifest } from '../../lists/manifest.js';

const { values } = parseArgs({ options: {
  'data-dir': { type: 'string', default: './.basis-telegram' },
  lang:       { type: 'string', default: 'nl' },
} });

function readToken() {
  if (process.env.TG_BOT_TOKEN) return process.env.TG_BOT_TOKEN.trim();
  try { return readFileSync(path.join(homedir(), '.canopy-tg-token'), 'utf8').trim(); } catch { return null; }
}
const token = readToken();
if (!token) { console.error('telegram-runner: set TG_BOT_TOKEN (or put the token in ~/.canopy-tg-token)'); process.exit(2); }
const allowedChatIds = String(process.env.TG_ALLOWED_CHAT_IDS ?? '').split(',').map((s) => s.trim()).filter(Boolean);
if (!allowedChatIds.length) console.warn('telegram-runner: TG_ALLOWED_CHAT_IDS is empty — every chat will be told its id and refused');

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

const bridge = new TelegramBridge({ botToken: token, mode: 'long-polling' });
const runner = createTelegramRunner({
  bridge, catalogue, manifestsByOrigin, allowedChatIds, t,
  callSkill: (app, op, args) => agent.callSkill(app, op, args),
  // The deterministic gate the circle composer uses ("add X" / "done X" route without a model).
  // The interpreter (an LLM route) is wired once a confidential route is configured.
  gate: createTokenGate({ rules: circleGateRules(values.lang) }),
});
await runner.start();
console.log(`telegram-runner: up — data in ${dataDir}, ${allowedChatIds.length} paired chat(s), ${catalogue.commandMenu?.length ?? 0} commands`);

const stop = async () => { try { await runner.stop(); } finally { process.exit(0); } };
process.on('SIGINT', stop); process.on('SIGTERM', stop);
