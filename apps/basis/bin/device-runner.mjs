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
 *   TG_BOT_TOKEN             optional — also answer on Telegram (from the environment only; empty = no Telegram)
 *   TG_ALLOWED_CHAT_IDS      Telegram ids let in without a code (a bootstrap); everyone else needs an admin's code
 *   ONDERLING_PROFILE_KIND   `function` on a household bot's own node: its profile is the bot's, its inbox a door
 *   TG_ADMIN_UID             optional — the Telegram user id of the bot's admin; unset → the first person admitted
 *   ONDERLING_WALK_LOG_TURNS off|redacted|full — conversation turns in the walk log (default off; the flag wins)
 *   PRIVATEMODE_API_KEY      optional — the confidential LLM route for free text
 *   BASIS_APP_URL            optional — the web app, so a printed enrolment offer is also a link
 *   ONDERLING_PRIMARY_DEVICE  optional — `1`: this device is the person's PRIMARY contact address (sync-policy
 *                            §12): it registers the profile and person addresses as primary on every relay, and
 *                            its per-circle addresses take the primary slot on the roster, so a direct message
 *                            lands HERE and not on the phone. The headless form of the tap on Mij / My data;
 *                            enrolling alone never makes a box primary. Claimed once per start, carried to the siblings.
 *
 * Flags: --data-dir · --lang · --walk-log · --walk-log-turns off|redacted|full (default off) · --show-offer (print an add-a-device offer and exit) ·
 *        --enrol (phone-first: paste the phone's offer, type the phrase, exit; then start as usual)
 *
 * The recovery phrase is NEVER read from the environment or a file here. A device is enrolled by a
 * ceremony that asks for it, once (`--enrol`, on stdin, echo off on a terminal); storing it beside the
 * machine that runs unattended would hand the whole account to anyone who reads that machine's disk.
 */
import { readFileSync, writeFileSync, existsSync, mkdirSync, appendFileSync, rmSync, statSync, readdirSync, renameSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import { homedir } from 'node:os';
import path from 'node:path';
import { parseArgs } from 'node:util';

import { VaultNodeFs } from '@onderling/vault';

import { createRealHouseholdAgent } from '../src/web/realAgent.js';
import { initLocalisation, t } from '../src/localisation.js';
import { createTelegramRunner } from '../src/telegram/runner.js';
import { loadAssistantItems } from '../src/v2/assistantEngine.js';
import { interpretToCommand } from '../src/v2/interpretCommand.js';
import { createBotUsers, contactBookStore, createDoorAdmit } from '../src/v2/botUsers.js';
import { createBotThreads, dataSourceRowStore, ASSISTANT_MEMORY_DEFAULT_KEY } from '../src/v2/botThreads.js';
import { withAssistantOps } from '../src/v2/assistantOps.js';
import { createBotAdmission } from '../src/v2/botAdmission.js';
import { createInboxDoor } from '../src/v2/inboxDoor.js';
import { createPersonReach } from '../src/v2/doorReach.js';
import { createBotScreens } from '../src/v2/botScreens.js';
import { createScreenStepUp, SCREEN_STEP_UP_SUBTYPE } from '../src/v2/screenStepUp.js';
import { SCREEN_OFFER_SUBTYPE, SCREEN_REFUSED_SUBTYPE } from '../src/v2/screenView.js';
import { SURFACE_GRANT_TTL_MS } from '../src/v2/surfaceGrants.js';
import { screenColumnFor, exposeDoorToScreens } from '../src/v2/screenActing.js';
import { parsePairingOffer } from '../src/v2/connectionPairing.js';
import { createReminderTick } from '../src/v2/botReminderTick.js';
import { botHelpLines } from '../src/v2/botHelp.js';
import { welcomeLines, basicModeLines } from '../src/v2/botWelcome.js';
import { exportFromHost, importHousehold } from '../src/v2/householdExport.js';
import { createExportShelf, EXPORT_KEY_FILE, UNLOCKED_KEY_FILE, unlockedSecret } from '../src/v2/householdExportShelf.js';
import { REMINDERS_KEY, QUIET_KEY, remindersModeFrom, quietHoursFrom, REMINDER_LEAD_KEY, reminderLeadFrom } from '../src/v2/botSettings.js';
import { ensureHouseholdLists, HOUSEHOLD_TEMPLATE, withTemplateApps, templateLists, botPromptLines, loadListItems, expandAdds } from '../src/v2/householdTemplate.js';
import { botOpLevel, botRoleAllows, scopeCatalogueToRole, roleHintsFor } from '../src/v2/botOpMap.js';
import { listsGateRules } from '../src/v2/circleGate.js';
import { multiplexBridges } from '../src/v2/doorBridges.js';
import { turnLogFor } from '../src/v2/turnLog.js';
import { buildAssistantLlm } from '../src/telegram/assistantLlm.js';
import { createDoorCatalogue } from '../src/telegram/assistantCatalogue.js';
import { ASSISTANT_APPS_PARAM_KEY } from '../src/v2/assistantApps.js';

import { EventLog } from '../src/eventLog.js';
import { fileKeyValueStorage } from '../src/v2/eventLogPersistence.js';
import { boxStores } from '../src/v2/boxStorage.js';
import { stashEnrollOffer, consumeEnrollOffer, consumeCircleEntry } from '../src/v2/enrollOffer.js';
import { primeCircleSecurity, announceCircleAddresses } from '../src/v2/circleSecurityPriming.js';
import { registerCircleAddressesOnRelays } from '../src/v2/circleAddressRegistration.js';
import { makePeerRouter } from '../src/core/handlers/peerRouter.js';
import { buildCircleLanes } from '../src/v2/circleLanes.js';
import { createNodeFsBackend } from '@onderling/pseudo-pod/node';
import { createContactThreadChannel } from '../src/v2/contactThreadChannel.js';
import { createContactDmStore } from '../src/v2/contactDmStore.js';
import { makeHandleThreadedChat } from '../src/core/handlers/threadedChat.js';
import { shareDisclosureToCircle } from '../src/core/handlers/personaPropsUpdate.js';
import { makeCircleAddressAnnouncePeerHandler, announceOwnCircleAddress, propagateCircleAddressesAfterJoin } from '../src/v2/circleAddressAnnounce.js';
import { makeHandleGroupRedeemRequest, makeHandleGroupRedeemResponse, makeSendGroupRedeemRequest } from '../src/core/handlers/groupRedeem.js';
import { createPairRoster } from '../src/v2/pairRoster.js';
import { makeCircleReachable } from '../src/v2/householdRosterPairing.js';
import { applyRulesUpdates, preservedRulesStatementsFor } from '../src/v2/rulesUpdateLane.js';
import { makeCirclePolicyLane, makePolicyHeadStore, adminsOfViaSkill } from '../src/v2/policyUpdateLane.js';
import { createCirclePolicyStore, localStoragePolicyIo } from '../src/v2/circlePolicyStore.js';
import { makeGovernanceRail } from '../src/v2/governanceAppWiring.js';
import { runPendingForget } from '../src/v2/enrolForgets.js';

const { values } = parseArgs({ options: {
  'data-dir':   { type: 'string',  default: path.join(homedir(), '.basis-device') },
  // The door's language; the box's .env sets it as ASSISTANT_LANG (roles/assistant.yml).
  lang:         { type: 'string',  default: process.env.ASSISTANT_LANG || 'nl' },
  'walk-log':   { type: 'string' },
  // Whether conversation turns go into the walk log: off (default) · redacted · full.
  'walk-log-turns': { type: 'string' },
  'show-offer': { type: 'boolean', default: false },
  enrol:        { type: 'boolean', default: false },
} });

const dataDir = path.resolve(values['data-dir']);
mkdirSync(dataDir, { recursive: true });
await initLocalisation({ lng: values.lang });

const relayUrl = (process.env.ONDERLING_RELAY_URL ?? '').trim();
const appUrl   = (process.env.BASIS_APP_URL ?? '').trim();
// A screen's offer (`/scherm`) arrives on the peer router, which is up before the door that answers it exists.
const screenOffer = { handle: null };

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

// The content this shell composes — named once, because the enrol ceremony needs the list: an install
// that booted unenrolled first (every box does; the service starts before anyone can enrol it) holds the
// content of a throwaway identity, and that content does not carry over.
const contentPaths = {
  registry:  path.join(dataDir, 'registry'),
  stoop:     path.join(dataDir, 'stoop-items.json'),
  household: path.join(dataDir, 'household-items.json'),
  tasks:     path.join(dataDir, 'tasks-items.json'),
  settings:  path.join(dataDir, 'settings.json'),
  outbox:    path.join(dataDir, 'outbox.json'),
};
// The stores that are not item stores — the device log, the contact DM state, the circle policy — sealed at rest
// like the item stores, composed once in `boxStores` (the at-rest test uses the same function).
const stores = boxStores(dataDir);
contentPaths.deviceLog = stores.paths.deviceLog;
contentPaths.contactDm = stores.paths.contactDm;
// The device log is the record every lane rides: a device that forgets it on restart would re-admit a connection
// its owner revoked, and would come back to its circles as if it had never been in them. It is SEALED, so the agent
// hydrates it (`deviceLogIo`) the moment its content key exists and before anything appends — as on web.
const deviceLog = new EventLog({ initial: [], muted: [] });

// Where an add-a-device offer waits between the enrol ceremony and the next start — the node shape of
// what the shells keep in plain storage. Public data (the offer grants nothing without the phrase).
const offerStash = fileKeyValueStorage(path.join(dataDir, 'enroll-offer.json'));

// ── FINISH A CEREMONY'S CLEAR, if one is owed (web ≡ mobile ≡ box: the same note, read at each boot) ──────
// `--enrol` leaves a `forget-pending` note in the vault rather than sweeping inline, so every shell clears by
// one path and the one a person walks is the one a walk can prove. Before the agent, so nothing has opened a
// store yet. This shell supplies only the translation: a shared store name → one of THIS disk's paths. A name
// it does not know is a no-op, so the blast radius is exactly `contentPaths` — the vault and the offer stash
// are not in that object and cannot be reached from here even by mistake.
{
  const boxPathFor = {
    'cc-agent-registry': contentPaths.registry,
    'cc-device-log': [contentPaths.deviceLog, path.join(dataDir, 'device-log.json')],   // + the plain file a box kept before
    'cc-contact-dm-state': contentPaths.contactDm,
    'cc-outbox-state': contentPaths.outbox,
    'cc-outbox-cache': contentPaths.outbox,
    'cc-settings-state': contentPaths.settings,
    'cc-settings-cache': contentPaths.settings,
    'cc-stoop-state': contentPaths.stoop,
    'cc-stoop-cache': contentPaths.stoop,
    'cc-household-state': contentPaths.household,
    'cc-household-cache': contentPaths.household,
    'cc-tasks-cache': contentPaths.tasks,
  };
  try {
    const forgot = await runPendingForget({
      markerVault: vault,
      shell: {
        dropStore: (name) => {
          const p = boxPathFor[name];
          if (!p) return;                                  // a store only the painting shells have
          for (const one of [].concat(p)) rmSync(one, { recursive: true, force: true });   // a throw counts as a refusal: the note stays
        },
        dropKey: () => {},                                  // no flat key-value store: settings are a file
      },
    });
    if (forgot.ran) console.log(`device-runner: forgot the throwaway self — ${forgot.stores} store(s)`
      + `${forgot.failed ? `, ${forgot.failed} refused (the note stays; the next start retries)` : ''}`);
  } catch { /* a clear that cannot run never blocks a start */ }
}

// EVERYTHING A SHELL KEEPS, this device keeps — on disk, under the data dir, sealed like the shells seal
// it. Until 2026-09-14 only the household items and the log were kept; the registry (which circles this
// device is in, which devices the person has), the item store (rosters, contacts, the trail) and the
// settings were memory, and a restart — every deploy of a box — came back to no circles at all. The
// same descriptors the web app passes, with a file where it has an IndexedDB store.
// A household bot's install (a function profile) runs its tasks engine in its household circle, so a task on one of its
// lists is the engine's — one store per circle. A person's node keeps its tasks where they are. (The profile record is
// only readable once the agent is up, so this reads the install's own input; the door below reads the record.)
const botInstall = String(process.env.ONDERLING_PROFILE_KIND ?? '').trim() === 'function';
const agent = await createRealHouseholdAgent({
  // …and its door holds the bot's map at the gate: an op off the map is refused, an admin's op needs the admin.
  ...(botInstall ? { tasksCircleId: 'household', calendarInCircle: true, doorOpLevel: botOpLevel, doorRoleAllows: botRoleAllows, trustOwnGrants: true, acceptPeerSkillCalls: true } : {}),
  ownerRootVault: vault,
  chatVault,
  registryBackend: createNodeFsBackend({ dir: contentPaths.registry }),
  stoopPersistDb:     { path: contentPaths.stoop },
  householdPersistDb: { path: contentPaths.household },
  tasksPersistDb:     { path: contentPaths.tasks },
  settingsPersistDb:  { path: contentPaths.settings },
  outboxPersistDb:    { path: contentPaths.outbox },
  deviceLog,
  deviceLogIo: stores.deviceLogIo,
  // The lists' default table (and basis's) speak through this translator: a reply to Telegram is a sentence,
  // not a locale key.
  t,
  seedDemoData: false,
  seedHousehold: false,
  enrollOfferStorage: offerStash,
});
// `ctx` carries a door's person (`{caller}`) to the host gate — dropping it here would run every door call as the owner.
const callSkill = (app, op, args, ctx) => agent.callSkill(app, op, args, ctx);

// The walk log — one JSON line per event, so a run can be read afterwards rather than retold.
// `--walk-log` names a FILE (stamped before its extension) or a DIRECTORY (a trailing slash, or one that
// exists) — the box says "/data/assistant/walks/", and the file goes in it under the runner's own name.
// The directory is made: a log whose directory is missing is a log that is never written.
const stamp = new Date().toISOString().replace(/[:.]/g, '-').replace('T', '_').slice(0, 19);
const walkLogFile = (() => {
  const given = values['walk-log'];
  if (!given) return path.join(dataDir, `walk-log-${stamp}.jsonl`);
  const isDir = /[\\/]$/.test(given) || (existsSync(given) && statSync(given).isDirectory());
  if (isDir) return path.join(given, `walk-log-${stamp}.jsonl`);
  return /\.jsonl$/.test(given) ? given.replace(/\.jsonl$/, `-${stamp}.jsonl`) : `${given}-${stamp}.jsonl`;
})();
try { mkdirSync(path.dirname(walkLogFile), { recursive: true }); } catch { /* said below, once, if the first write fails */ }
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

// ── The enrol ceremony, phone-first ─────────────────────────────────────────────────────────────
// The phone already has the circles and shows an add-a-device offer. Run ONCE with `--enrol`: the offer
// is pasted (stashed for the next start — public data), the phrase is typed (used for the ceremony and
// never written anywhere), and the process exits. The next ordinary start consumes the offer the way
// both shells do after a scanned one. Two lines on stdin, in this order, so a pipe can drive it too.
async function enrolOnce() {
  const { createInterface } = await import('node:readline/promises');
  const tty = process.stdin.isTTY === true;
  const rl = createInterface({ input: process.stdin, output: tty ? process.stdout : undefined, terminal: tty });
  const ask = async (label, { hidden = false } = {}) => {
    if (!tty) { const line = (await rl[Symbol.asyncIterator]().next()).value; return String(line ?? '').trim(); }
    if (hidden) {
      // Echo off for the phrase: the readline writes nothing while the person types it.
      const orig = rl._writeToOutput;
      rl._writeToOutput = () => {};
      process.stdout.write(label);
      const line = await rl.question('');
      rl._writeToOutput = orig;
      process.stdout.write('\n');
      return String(line ?? '').trim();
    }
    return String((await rl.question(label)) ?? '').trim();
  };
  try {
    // An install enrols ONCE. Its vault is re-keyed to the enrolled root at the ceremony, so a second
    // ceremony in the same data dir cannot open it ("wrong unlock secret") — and after a replace
    // ceremony on the owner's new phone this device IS the retired one: its keys are gone from every
    // roster. The way back is a fresh data dir; its contact threads are on the owner's other devices by
    // the fan. Said here, before the phrase is asked for.
    if (agent.isEnrolledDevice?.()) {
      console.error('device-runner: this install is already an enrolled device. To enrol it again (after a replace ceremony on');
      console.error('  your new phone, say), start it with a fresh --data-dir; the old one keeps its threads sealed, and your');
      console.error('  other devices hold them anyway.');
      return 2;
    }
    const offerLine = await ask('The offer from your phone (onderling-enroll://… or the link): ');
    const stashed = await stashEnrollOffer(offerStash, offerLine);
    if (!stashed.ok) { console.error(`device-runner: that is not an add-a-device offer (${stashed.reason}).`); return 2; }
    const mnemonic = await ask('Your recovery phrase (24 words, not shown): ', { hidden: true });
    const r = await callSkill('household', 'enrollDevice', { mnemonic, label: 'box' });
    if (!r?.ok) {
      await offerStash.removeItem('onderling.enrollOffer').catch(() => {});
      console.error(`device-runner: not enrolled — ${r?.outcome === 'invalid-phrase' ? 'that is not a valid recovery phrase' : (r?.error ?? 'the ceremony failed')}.`);
      return 2;
    }
    // This install was nobody's until now: it had booted unenrolled, as a throwaway profile of its own — the
    // way every box comes up, since the service starts before anyone can enrol it. What that identity kept
    // on this disk (its member map with itself in it, its registry record, its settings, held messages) is
    // not the person's, and the ceremony's vault reset has already dropped the content key it was sealed
    // under — left in place, the next boot would greet a former self in every circle and warn about rows it
    // cannot open. So the content starts empty; the vaults the ceremony wrote and the offer stash stay.
    //
    // The clear itself no longer happens HERE. The ceremony leaves a `forget-pending` note in the vault and
    // the runner's own start reads it — one path for all three shells, and the one a person actually walks. A
    // clear at the end of `--enrol` was fine for this shell (it is a separate CLI run) but not for the others,
    // where it hung off a button the walk never pressed; two shapes is how a walk proves one thing and a person
    // gets another. `restoreOwnerRoot` writes the note, with the throwaway self's circle ids on it.
    console.log(`device-runner: enrolled as device ${String(r.deviceId ?? '').slice(0, 12)}… for ${stashed.circles.length} circle(s).`);
    console.log('  Now start the runner as usual; on that start it joins the circles the offer names.');
    return 0;
  } finally { rl.close(); }
}
if (values.enrol) { process.exit(await enrolOnce()); }

// ── The wire ────────────────────────────────────────────────────────────────────────────────────
let contactChannel = null;
// The bot's inbox door (a function profile only), late-bound: the contact channel is composed below, the door after it.
let inboxDoor = { bridge: null, feed: () => false };
let pairRoster = null;         // the pair roster for contacts (L105) — composed with the contact channel
if (relayUrl) {
  // The durable home of 1:1 threads, file-backed so a restart is the same conversations. Same
  // constructor both shells use; only the backing differs, which is the whole of what a shell decides.
  const dmSource = await stores.contactDmSource().catch(() => null);
  // THE PAIR ROSTER (L105), composed as both shells compose it: the hidden two-member circle every written-to
  // contact gets, made on the first exchange from the circle mechanics — the redeem sender, the admitting side's
  // hook, the post-join reachability. The box did not speak it until 2026-09-19: a visitor's second message rode
  // the pair route to a per-circle address the box never registered (the shell-seams guard's first finding).
  // The redeem sender and the post-join step are composed further down — late-bound here, as on mobile.
  const pairSeams = { sendPeerRedeem: null, onJoined: null };
  const pendingPeerRedeems = new Map();
  pairRoster = createPairRoster({
    selfWebid: agent.identity?.chat?.pubKey ?? agent.pubKey ?? agent.identity?.pubKey,
    callSkill,
    sendPeerRedeem: (...a) => (pairSeams.sendPeerRedeem ? pairSeams.sendPeerRedeem(...a) : Promise.reject(new Error('peer redeem not ready'))),
    circleAddressFor: (cid) => agent.circleAddressFor?.(cid) ?? null,
    signCircleLink: (cid, gid, addr) => agent.signCircleLink?.(cid, gid, addr) ?? null,
    onJoined: (a) => pairSeams.onJoined?.(a),
    announceOwn: (cid) => announceOwnCircleAddress({ agent, circleId: cid }),
    identityOf: (addr) => agent.identityOfAddress?.(addr) ?? addr,
    myHandle: async () => { try { return (await callSkill('stoop', 'whoAmI', {}))?.handle ?? null; } catch { return null; } },
    relayUrl: () => relayUrl,
    // the lens (shell parity): the box founds a pair circle as any shell does and says what the persona discloses there
    shareRelease: (cid, personaId) => shareDisclosureToCircle({
      callSkill, emitMemberProps: (a) => agent.emitMemberProps?.(a), circleId: cid, personaId, lastShared: null, resealMediaForCircle: null,
    }),
  });
  contactChannel = createContactThreadChannel({
    pair: pairRoster,
    sendToPeer: (addr, payload, opts) => (opts ? agent.sendPeerMessage(addr, payload, opts) : agent.sendPeerMessage(addr, payload)),
    itemStore:  createContactDmStore({ dataSource: dmSource, localActor: 'me' }),
    identityOf: (addr) => agent.identityOfAddress?.(addr) ?? addr,
    // A contact the person hid (on any device — the mark rides the own-devices carry) who writes again comes
    // back: here that is the book row unhidden, so the carry says so on every device; the screens paint the
    // marker themselves when the turn reaches them. Hiding is Contacten only — the thread, the pair roster
    // and their circles never change, so this device stores the turn exactly as it would any other.
    isHidden: async (contactId) => {
      const rows = (await callSkill('stoop', 'listContacts', {}))?.contacts ?? [];
      return rows.some((c) => (c.webid ?? c.pubKey) === contactId && c.hidden === true);
    },
    onReturned: async (contactId) => {
      await callSkill('stoop', 'setContactHidden', { webid: contactId, hidden: false });
      walkLog({ kind: 'contact-returned', contactId: String(contactId).slice(0, 12) });
    },
    // The first message to a contact carries the person's card; one that arrives (naming its sender) goes into the
    // book here — and the book carry names that person on the phone and the laptop (2026-09-21).
    myCard: async () => { try { return (await callSkill('stoop', 'getContactShareQr', {}))?.payload ?? null; } catch { return null; } },
    onCard: async ({ contactId, card }) => {
      const r = await callSkill('stoop', 'addContactFromQr', { payload: card });
      walkLog({ kind: 'contact-card', contactId: String(contactId).slice(0, 12), name: r?.contact?.displayName ?? r?.contact?.handle ?? null });
    },
    localActor: 'me',
    // Direct messages are sealed to the PERSON's current key; an enrolled box holds it, handed over at enrol.
    sealFor: agent.contactSeal?.sealFor ?? null,
    openFor: agent.contactSeal?.openFor ?? null,
    // A turn that arrives here is meant for the PERSON, so it goes on to their other devices.
    // …and the log says where it went: per device of the person's, delivered, held for its presence,
    // or failed. A revoked device's fan lands nowhere, and the log is where that is legible.
    fanToOwnDevices: async (turn) => {
      const r = await agent.contactTurnFan(turn);
      walkLog({ kind: 'own-device-fan', attempted: r?.attempted ?? 0, outcomes: (r?.outcomes ?? []).map((o) => ({ ...o, to: String(o.to).slice(0, 12) })) });
      return r;
    },
  });

  // What a shell would repaint, this device only stores. Every reaction below is that substitution and
  // nothing more — if one of them starts making a decision, it belongs in the shared table instead.
  const govRail = agent.circleIdentityFor
    ? makeGovernanceRail({ eventLog: deviceLog, circleIdentityFor: agent.circleIdentityFor, myRef: '', callSkill })
    : null;
  // THE CIRCLE'S POLICY, folded here like on every shell (web ≡ mobile ≡ box). Nothing on this device reads the
  // posture today — but this is the always-on member a joiner catches up from, and after the governance lane's audit
  // window only a device that kept the winning statement can hand it over. So the box folds it and serves the head.
  const circlePolicyKv = stores.circlePolicyKv;
  const circlePolicyStore = createCirclePolicyStore(localStoragePolicyIo(circlePolicyKv));
  const circlePolicyLane = makeCirclePolicyLane({
    emitter: () => agent.emitPolicyUpdate ?? null,
    headStore: makePolicyHeadStore(circlePolicyKv),
    readPolicy: (cid) => circlePolicyStore.get(cid),
    writePolicy: (cid, policy) => circlePolicyStore.update(cid, policy),
    adminsOf: adminsOfViaSkill(callSkill),
  });
  const lanes = buildCircleLanes({
    agent,
    govRail,
    eventLog: deviceLog,
    // The durable heads a member offline past the audit window still needs: the rules and the policy.
    extraGovStatementsFor: async (cid) => [
      ...await preservedRulesStatementsFor({ callSkill, circleId: cid }),
      ...await circlePolicyLane.preserved(cid),
    ],
    on: {
      govChange: (cid) => {
        if (!govRail) return;
        applyRulesUpdates({ rail: govRail, callSkill, circleId: cid }).catch(() => {});
        circlePolicyLane.apply(cid, govRail)
          .then((r) => { if (r?.applied) walkLog({ kind: 'policy-applied', circleId: cid, version: r.version }); })
          .catch(() => {});
      },
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
      // A circle message landed. Nothing to paint — but said in the log, because "did the circle reach
      // this device" is the one question an operator (and the walk) has.
      chatLanded: ({ msgId, circleId, source }) => walkLog({ kind: 'chat-landed', msgId, circleId, source: source ?? null }),
      // …and a catch-up that brought statements in (the pull at connect, the enrol consume's content pull).
      chatChange: (circleId) => walkLog({ kind: 'chat-change', circleId }),
      // …and one it could NOT take: a pulled statement refused at the rail is dropped, and only a later
      // pull brings it back — said in the log with its reason, so "behind" is never a mystery.
      chatRefused: async ({ circleId, fromPeerAddr, reason, statement }) => {
        // With the roster as this device holds it at that moment: a refusal is almost always "the
        // author's address is not on the row yet", and the row says whether that is so.
        let roster = null;
        try {
          const r = await callSkill('stoop', 'listGroupMembers', { groupId: circleId });
          roster = (r?.members ?? []).map((m) => ({ webid: String(m.webid).slice(0, 8), primary: m.circleAddress ? String(m.circleAddress).slice(0, 8) : null, set: (m.circleAddresses ?? []).map((a) => String(a).slice(0, 8)) }));
        } catch { roster = null; }
        let trail = null;
        try {
          const all = await callSkill('stoop', 'listOpen', { type: 'membership-redemption' });
          const items = Array.isArray(all?.items) ? all.items : (Array.isArray(all) ? all : []);
          trail = items.filter((it) => it?.source?.groupId === circleId).map((it) => ({ id: String(it.id).slice(0, 10), by: String(it.source?.redeemedBy ?? it.source?.confirmedBy ?? '').slice(0, 8), addr: it.source?.circleAddress ? String(it.source.circleAddress).slice(0, 8) : null, set: (it.source?.circleAddresses ?? []).map((p) => String(p?.address ?? p).slice(0, 8)), etag: it.etag ?? it._etag ?? null }));
        } catch { trail = null; }
        walkLog({ kind: 'chat-refused', circleId, from: String(fromPeerAddr).slice(0, 12), reason, author: String(statement?.body?.author ?? statement?.author ?? '').slice(0, 8), roster, trail });
      },
    },
  });

  // The thread is keyed by IDENTITY, as on both shells: a turn from a contact's person-key address or their
  // per-circle address lands in the same thread as one from their profile address — and the key this device
  // carries to its siblings is one they open too (2026-09-19: keyed by the wire address, the carried turn sat
  // on the maker's web app under a key its Contacten row never opened).
  const landTurn = ({ fromAddr, text, buttons, messageId, replyTo, ts }) => {
    const contactId = agent.identityOfAddress?.(fromAddr) ?? fromAddr;
    return contactChannel.persistInbound({ contactId, fromAddr, text, buttons, messageId, replyTo, ts })
      ?.then((r) => { if (!r?.deduped) walkLog({ kind: 'contact-turn', from: String(fromAddr).slice(0, 12), text }); return r; })
      ?.catch(() => { /* durability is best-effort, as in the shells */ });
  };
  // A person's MESSAGE (never a bot's reply: two bots must not answer each other) lands in the inbox like any other,
  // and on a function profile's node it then goes to the assistant.
  const landMessage = (m) => {
    const landed = landTurn(m);
    Promise.resolve(landed).then((r) => {
      if (r?.deduped) return;
      inboxDoor.feed({ contactId: agent.identityOfAddress?.(m.fromAddr) ?? m.fromAddr, fromAddr: m.fromAddr, text: m.text, admission: m.admission, messageId: m.messageId });
    }).catch(() => {});
  };

  // The redeem pair (the join's wire), as both shells wire it — here for the pair roster: the box founds or joins
  // the hidden two-member circle with a contact, and admits the contact into one it founded.
  const sendPeer = (addr, payload, opts) => (opts ? agent.sendPeerMessage(addr, payload, opts) : agent.sendPeerMessage(addr, payload));
  pairSeams.sendPeerRedeem = makeSendGroupRedeemRequest({
    sendPeer,
    currentPersonKey: () => agent.personKey?.() ?? null,   // the first person key rides the join
    isPeerConnected: () => agent.isPeerReachable?.() ?? (agent.peer?.status === 'connected'),
    pendingMap:      pendingPeerRedeems,
    // this device's per-circle address on the redeem path, proven with its own key (source circle == the circle joined)
    circleAddressFor: (gid) => agent.circleAddressFor?.(gid) ?? null,
    signCircleAddress: (gid, addr) => agent.signCircleLink?.(gid, gid, addr) ?? null,
  });
  // After a join: presence in the new circle (the per-circle address on the relay, the announce) and the lanes'
  // catch-up — `registerCirclePresence` is defined below and runs at connect; a join later re-runs it for the one circle.
  pairSeams.onJoined = ({ circleId } = {}) => makeCircleReachable({
    agent, circleId,
    registerCirclePresence: () => registerCirclePresence([circleId]),
    pullLanes: (cid) => Promise.allSettled(['membership', 'gov', 'key'].map((k) => lanes.catchUps[k]?.requestCircle?.(cid, { callSkill }))),
  });

  const router = makePeerRouter({
    handlers: {
      ...lanes.handlers,
      [contactChannel.subtypes.in]:  contactChannel.replyHandler(landTurn),
      [contactChannel.subtypes.out]: contactChannel.messageHandler(landMessage),
      // A join request — for the box, a contact joining the pair circle it founded: admit, promote to co-admin
      // (the pair roster's rule), return the box's proven per-circle address, hand the circle the newcomer's.
      'group-redeem-request': makeHandleGroupRedeemRequest({
        callSkill, sendPeer,
        publishEvent: (e) => walkLog({ kind: 'redeem', ...(e?.type ? { type: e.type } : {}), circleId: e?.circleId ?? e?.groupId ?? null }),
        onAdmitted: (a) => pairRoster?.onAdmitted?.(a),
        circleAddressFor: (gid) => agent.circleAddressFor?.(gid) ?? null,
        signCircleAddress: (gid, addr) => agent.signCircleLink?.(gid, gid, addr) ?? null,
        propagateCircleAddresses: ({ circleId, newMemberWebid }) => propagateCircleAddressesAfterJoin({ agent, circleId, newMemberWebid }),
        logger: { info: () => {}, warn: console.warn, error: console.error, debug: () => {} },
      }),
      'group-redeem-response': makeHandleGroupRedeemResponse({ pendingMap: pendingPeerRedeems }),
      // A member — above all this owner's OTHER device — says where it answers in a circle. Without
      // this the box never learns a sibling's address, its sibling set stays empty, and the fan above
      // has nowhere to go: the one message this device exists to pass on would stop here.
      'circle-address-announce': makeCircleAddressAnnouncePeerHandler({ agent, logger: { info: () => {}, warn: console.warn, error: console.error, debug: () => {} } }),
      // A roster owner says a row changed; the values are re-read, never carried on this wire.
      // A reply to one of this device's noticeboard posts lands in that replier's thread, as on both shells.
      // A screen a person asked to connect (`/scherm`) sends its offer; the door, once up, grants it.
      [SCREEN_OFFER_SUBTYPE]: (from, payload) => screenOffer.handle?.(from, payload),
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

  // ── Presence in every circle: the per-circle addresses on the relay, then the announce ─────────
  // The same three acts both shells perform on connect (`registerCirclePresence`): prime the signing
  // identities and the sender authorization, register each per-circle address on the relay (signed —
  // an address IS a key), and only then announce. Without this the box was reachable at its profile
  // address alone: a circle's fan to its per-circle address went to a relay that had never heard of
  // it, and "a full member of your circles" was true of the lanes and false of the wire.
  const registerCirclePresence = async (extraCircleIds = []) => {
    let ids = [];
    try { ids = ((await callSkill('stoop', 'listMyCircles', {}))?.circles ?? []).map((c) => (typeof c === 'string' ? c : (c?.groupId ?? c?.id))).filter(Boolean); } catch { ids = []; }
    const circleIds = [...new Set([...ids, ...(Array.isArray(extraCircleIds) ? extraCircleIds.filter(Boolean) : [])])];
    if (circleIds.length === 0) return;
    await primeCircleSecurity({ agent, circleIds }).catch((err) => console.warn('device-runner: circle security priming failed:', err?.message ?? err));
    if (!agent.relay?.supportsAliases) return;
    const circlesForPoint = () => circleIds;   // one relay here: every circle rides it
    circlesForPoint.pointsFor = () => [relayUrl];
    await registerCircleAddressesOnRelays({
      relays: agent.relays?.list?.() ?? [],
      circleIds,
      circleAddressFor: (cid) => agent.circleAddressFor?.(cid) ?? null,
      circleAddressSignerFor: (cid) => agent.circleAddressSignerFor?.(cid) ?? null,
      alsoAddresses: agent.ownAddressBindings?.() ?? [],   // the person address beside the per-circle ones
      circlesForPoint,
      defaultRelayUrl: relayUrl,
      onError: (err, cid) => console.warn(`device-runner: circle-address register failed (${String(cid).slice(0, 12)}…):`, err?.message ?? err),
    }).then(() => announceCircleAddresses({ agent, circleIds }))
      .catch((err) => console.warn('device-runner: circle-address registration failed:', err?.message ?? err));
    // …and the rosters as this device holds them now — who is in each circle and at which addresses.
    // A box that fans to nobody, or to an address nobody holds, is read from this line.
    const rosters = {};
    for (const cid of circleIds) {
      try {
        const r = await callSkill('stoop', 'listGroupMembers', { groupId: cid });
        rosters[cid] = (r?.members ?? []).map((m) => ({ who: String(m.webid ?? '').slice(0, 8), set: (m.circleAddresses ?? []).map((a) => String(a).slice(0, 8)) }));
      } catch { rosters[cid] = null; }
    }
    walkLog({ kind: 'presence', circles: circleIds.length, rosters });
  };
  await registerCirclePresence();

  // The stashed offer (from `--enrol`, or a re-try from an earlier start): consumed exactly as both
  // shells consume a scanned one — registry record, presence, the roster seed from the sibling, the
  // announce, every lane's catch-up. No-op when nothing is stashed.
  const enrolDeps = {
    agent, callSkill,
    sendPeerMessage: (to, payload, o) => agent.sendPeerMessage(to, payload, o),
    storage: offerStash,
    registerCirclePresence: (ids) => registerCirclePresence(ids),
    contentPulls: (circleId, siblingAddress) => Promise.allSettled([
      lanes.catchUps.task?.requestFrom(siblingAddress, circleId),
      lanes.catchUps.chat?.requestFrom(siblingAddress, circleId),
    ]),
  };
  // A circle another device of the person founded or joined (a kring joined on the phone): the same per-circle
  // step, run when the sibling's carry lands; the log says so. Asked for on connect with the other kicks below.
  agent.circleFollowSync?.setConsume((entry) => consumeCircleEntry(enrolDeps, entry));
  agent.circleFollowSync?.onLanded?.((r) => walkLog({ kind: 'circle-follow', from: String(r.from).slice(0, 12), circleId: r.circleId, ok: r.ok, steps: r.steps }));
  agent.bootstrapFromStashedOffer = () => consumeEnrollOffer(enrolDeps).then((r) => {
    if (r?.consumed) {
      walkLog({ kind: 'enroll-offer', cleared: r.cleared, circles: r.circles?.map((c) => ({ id: c.circleId, ok: c.ok, steps: c.steps })) });
      console.log(`device-runner: joined ${r.circles?.filter((c) => c.ok).length ?? 0} circle(s) from the offer${r.cleared ? '' : ' — some did not complete; retried on the next start'}.`);
    }
    return r;
  }).catch((err) => { console.warn('device-runner: the offer could not be consumed now — retried on the next start:', err?.message ?? err); });
  agent.bootstrapFromStashedOffer().then(async () => {
    // The operator's word that THIS box is the person's primary contact address — the tap, headless.
    if (/^(1|true|yes)$/i.test(String(process.env.ONDERLING_PRIMARY_DEVICE ?? '').trim())) {
      try {
        const { makeThisDevicePrimary } = await import('../src/v2/circleAddressAnnounce.js');
        const r = await makeThisDevicePrimary({ agent, logger: console });
        walkLog({ kind: 'primary-device', circles: r.circles, announced: r.announced, claimed: r.device?.ok === true, personAddress: String(agent.personAddress?.() ?? '').slice(0, 12), profile: String(agent.pubKey ?? '').slice(0, 12) });
        console.log(`device-runner: this device is the primary contact address (${r.announced}/${r.circles} circle(s) told; the relays re-registered).`);
      } catch (err) { console.warn('device-runner: could not claim the primary contact address:', err?.message ?? err); }
    }
  });

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
  kick(agent.knownPeersSync, 'known-peers', 2500);
  // A hidden mark set on another device of the person lands here and the log says so — the one way a walk
  // (and a reader of this box's log) can see that "hidden on the phone" reached the box.
  agent.knownPeersSync?.onLanded?.(({ hiddenChanged }) => {
    for (const c of hiddenChanged ?? []) walkLog({ kind: 'contact-hidden', contactId: String(c.webid).slice(0, 12), hidden: c.hidden });
  });
  kick(agent.personKeySync, 'person-key', 2500);
  // Which device is the primary contact address — a claim made on a phone reaches this box by the carry, and
  // at boot by asking, as both shells do. (Found by the shell-seams guard on its first run, 2026-09-19.)
  setTimeout(() => {
    agent.primaryDevice?.requestFromSiblings?.().catch(() => { /* the carry brings a later claim either way */ });
    walkLog({ kind: 'catch-up-kick', lane: 'primary-device' });
  }, 2600);
  // The circles the person's other devices are in that this box is not (founded or joined while it was down).
  setTimeout(() => {
    agent.circleFollowSync?.requestFromSiblings?.().catch(() => { /* the carry brings a later one either way */ });
    walkLog({ kind: 'catch-up-kick', lane: 'circle-follow' });
  }, 2700);
  kick(lanes.catchUps.task, 'tasks', 3000);
  kick(lanes.catchUps.chat, 'chat', 3500);
  kick(lanes.catchUps.key, 'keys', 3500);
}

// ── Telegram, only if a token is here ───────────────────────────────────────────────────────────
// From the environment only: a file in the home folder once handed a developer's local run the LIVE bot's token.
const tgToken = String(process.env.TG_BOT_TOKEN ?? '').trim() || null;
// ── Whose node this is: a bot's install names its profile a function's, once (refused on a person's profile) ────
if (String(process.env.ONDERLING_PROFILE_KIND ?? '').trim() === 'function') {
  try { await agent.markFunctionProfile(); } catch (err) { console.warn(`device-runner: ${err?.message ?? err}`); }
}
// The bot's inbox door follows the profile: a person's node never answers its inbox.
if (contactChannel) {
  inboxDoor = await createInboxDoor({ profileKind: () => agent.profileKind(), sendTurn: (turn) => contactChannel.sendTurn(turn) });
}

// ── The assistant: its doors (Telegram, the bot's inbox), ONE engine behind them ─────────────────────────────
let tgRunner = null;
if (tgToken || inboxDoor.bridge) {
  const { TelegramBridge } = tgToken ? await import('@onderling/chat-agent/bridges/telegram') : {};
  // Who gets in without a code: the admin named at start and a configured allow-list (the bootstrap). Everyone else
  // needs a code the admin hands out (`/cohort`, `/invite`). There is no open door any more.
  const adminUid = String(process.env.TG_ADMIN_UID ?? '').trim() || null;
  const bootstrapUids = [adminUid, ...String(process.env.TG_ALLOWED_CHAT_IDS ?? '').split(',')]
    .map((s) => String(s ?? '').trim()).filter((s) => s && s !== '*');

  // Scope, then interpret: the apps this bot acts in are the owner's setting, read at boot, and the catalogue
  // every surface of the door projects — the model's tools included — holds only theirs.
  // The admin switches apps from the door (`/apps on tasks`): the parameter is written and the catalogue recomposed.
  const isFunctionProfile = (await agent.profileKind?.()) === 'function';
  const doorCatalogue = createDoorCatalogue({
    householdManifest: agent.manifest,
    // A household bot composes exactly its map (`botOpMap.js`); a person's box its app list, as before.
    slim: isFunctionProfile,
    getApps: () => agent.getParamValue?.(ASSISTANT_APPS_PARAM_KEY),
    setApps: (list) => callSkill('params', 'set-param', { key: ASSISTANT_APPS_PARAM_KEY, value: list }),
  });
  const apps = doorCatalogue.apps();
  // The model is the optional half of this optional half: a key without its SDK is a warning and a
  // Telegram that answers without a model, never a device that is not there.
  const built = await buildAssistantLlm({
    model: process.env.PRIVATEMODE_MODEL,
    // One retry on the fallback model after a timeout — said in the walk log, so a slow route is visible.
    onFallback: (e) => walkLog({ kind: 'llm-fallback', ...e }),
  });
  const llm = built?.llm ?? null; const llmModel = built?.model ?? null;
  // The flag wins; the box's .env can set it without touching the container's command (a fixture-collecting week).
  // A long-poll that stopped or stalled (a sleep, a network change, an error Telegraf does not retry) leaves the bot
  // running and deaf: the box says so and exits, and the container's restart policy starts it fresh.
  const tgBridge = tgToken ? new TelegramBridge({
    botToken: tgToken, mode: 'long-polling',
    onPollingDown: ({ reason, error }) => {
      console.error(`device-runner: Telegram's long-poll ${reason}${error ? ` (${error?.message ?? error})` : ''} — exiting so the box restarts it`);
      try { walkLog({ kind: 'telegram-down', reason }); } catch { /* the exit below is what matters */ }
      setTimeout(() => process.exit(1), 500).unref?.();
    },
  }) : null;
  // the household's reminder settings as the admin set them (the welcome says them; the tick obeys them)
  const reminderSettings = () => ({ reminders: remindersModeFrom(agent.getParamValue?.(REMINDERS_KEY)), quiet: quietHoursFrom(agent.getParamValue?.(QUIET_KEY)), lead: reminderLeadFrom(agent.getParamValue?.(REMINDER_LEAD_KEY)) });
  const turnLogMode = values['walk-log-turns'] ?? (process.env.ONDERLING_WALK_LOG_TURNS || undefined);
  // Every person is a contact with a role, and their calls carry them to the host gate.
  const botUsers = createBotUsers({ store: contactBookStore(callSkill), adminUid });
  // Admission by code: the signing secret in the bot's sealed vault, the cohort and spent codes in a sealed store.
  const admission = createBotAdmission({
    secretVault: chatVault,
    store: dataSourceRowStore(await stores.botAdmissionSource(), 'mem://basis/bot-admission/'),
  });
  // The door's admission, once: who is let in, their tier in the gate, and the role their thread's tools follow.
  const doorAdmit = createDoorAdmit({ users: botUsers, admission, bootstrapUids, setDoorCaller: agent.setDoorCaller, clearDoorCaller: agent.clearDoorCaller });
  // Everyone in the book is in the gate from the start: the reminder tick and the Sunday overview act AS a person, and
  // after a restart nobody has written yet. A book the gate cannot take is said, not fatal (the door still tiers on the
  // next message).
  const inGate = await doorAdmit.atStart().catch((e) => { console.warn(`device-runner: could not put the bot's people in the gate at start: ${e?.message ?? e}`); return null; });
  walkLog({ kind: 'gate-at-start', people: inGate });
  // A bot nobody can get into: no admin yet and no bootstrap id. One code for one person, printed HERE (the box's
  // console, never a chat or the walk log) — the first person admitted is the bot's admin.
  let bootstrapCode = null;
  if (!bootstrapUids.length && !(await botUsers.list()).some((u) => u.role === 'admin')) {
    await admission.openCohort({ ceiling: 1, days: 1 });
    bootstrapCode = await admission.code();
    console.log(`device-runner: this bot has no admin yet — send it, within a day:  /start ${bootstrapCode}`);
    // A code the door hands out on a node that is NOT a household bot admits people into a person's assistant: no bot map,
    // no roles' columns, no reminders. Said where the operator reads the code (seen on the tablet, 2026-10-02: the
    // profile kind was left empty in the box's .env).
    if (!isFunctionProfile) {
      console.warn('device-runner: ⚠ this node is not a household bot (ONDERLING_PROFILE_KIND is not "function") — the code admits people into a PERSON\'s assistant. Set ONDERLING_PROFILE_KIND=function in the box\'s .env for a household bot.');
      walkLog({ kind: 'not-a-household-bot', admission: 'codes' });
    }
  }
  // Each person's thread: its turns on the (sealed) device log, its settings in a sealed store — kept across restarts.
  const threads = createBotThreads({
    eventLog: deviceLog,
    store: dataSourceRowStore(await stores.botThreadsSource()),
    memoryDefault: () => agent.getParamValue?.(ASSISTANT_MEMORY_DEFAULT_KEY),
  });
  await threads.load();
  // The door's call: the assistant's own ops answered here (each after the host gate), the rest on to the agent — the
  // same call a typed line and a scheduled overview take.
  // The household's export (the one format kept readable across versions): one a night into the bot's data dir, the
  // last few kept, so the box's snapshot carries it off; the admin reads one back with /import.
  const exportsDir = path.join(dataDir, 'exports');
  // An unlocked export key does not outlive its hour (an admin who unlocked and then said No, or never imported):
  // removed when it is read past its time, and swept every minute.
  const sweepUnlocked = () => {
    const p = path.join(dataDir, UNLOCKED_KEY_FILE);
    try { if (!unlockedSecret(readFileSync(p, 'utf8'))) rmSync(p, { force: true }); } catch { /* none */ }
  };
  sweepUnlocked();
  setInterval(sweepUnlocked, 60_000).unref?.();
  const exportShelf = createExportShelf({
    files: {
      list: async () => { try { return readdirSync(exportsDir); } catch { return []; } },
      // written whole or not at all: a crash mid-write leaves a temp file, never a cut-off export under its own name
      write: async (name, text) => {
        mkdirSync(exportsDir, { recursive: true, mode: 0o700 });
        const tmp = path.join(exportsDir, `.${name}.tmp`);
        writeFileSync(tmp, text, { mode: 0o600 });
        renameSync(tmp, path.join(exportsDir, name));
      },
      read: async (name) => readFileSync(path.join(exportsDir, name), 'utf8'),
      remove: async (name) => rmSync(path.join(exportsDir, name), { force: true }),
    },
    exportNow: async () => {
      // beside it, the bot's own recovery file (its circles and their members, sealed to its recovery phrase — the
      // existing carrier): one snapshot of the folder then holds all a restore needs besides the phrase
      try {
        const rec = await callSkill('household', 'exportRecoveryFile', {});
        if (rec?.ok && typeof rec.file === 'string') { mkdirSync(exportsDir, { recursive: true, mode: 0o700 }); writeFileSync(path.join(exportsDir, 'recovery-file.txt'), rec.file, { mode: 0o600 }); }
      } catch { /* the export goes on without it */ }
      return exportFromHost({
        items: () => agent.householdItems(),
        people: () => botUsers.list(),
        params: async () => (await callSkill('params', 'list-user-params', {}).catch(() => null))?.params ?? [],
      });
    },
    // sealed to the admin's export key once one is set (`bin/export-key.mjs set`, on the box)
    // no key set → plain; a key that cannot be read (permissions, a cut-off file) → the write FAILS, never goes out plain
    sealWith: async () => {
      let text;
      try { text = readFileSync(path.join(dataDir, EXPORT_KEY_FILE), 'utf8'); } catch (e) { if (e?.code === 'ENOENT') return null; throw e; }
      return JSON.parse(text);
    },
    onWritten: (e) => walkLog({ kind: 'export', ok: e.ok, sealed: Boolean(e.sealed), ...(e.name ? { name: e.name } : {}), ...(e.error ? { error: e.error } : {}) }),
  });
  // A household bot's people connect screens (`/scherm`): the grant is their role column, each token acting as them.
  const reach = createPersonReach({ bridges: { telegram: tgBridge, web: inboxDoor.bridge }, users: botUsers, threads });
  const screens = isFunctionProfile ? createBotScreens({
    threads,
    isAdmitted: async (person) => (await botUsers.list()).some((u) => u.id === person),
    sendPrivately: (person, text, rememberAs) => reach.sendToPerson(person, { text, rememberAs, noPreview: true }),
    // the offer's question, in the person's own language, with the code their screen shows; Ja / Nee buttons send
    // `/koppelen`, which counts only from this private door
    ask: (person, { codes, replaced }) => {
      const lang = threads.langOf(person) ?? undefined;
      const tp = (k, p) => t(k, p, lang);
      const text = [tp('circle.bot.screen_confirm_question'), ...(replaced ? [tp('circle.bot.screen_confirm_replaced')] : [])].join('\n');
      // the person PICKS the code their screen shows; "none of these" when it is not there (or they did not ask)
      return reach.sendToPerson(person, {
        text, rememberAs: tp('circle.bot.screen_confirm_remembered'),
        buttons: [...codes.map((c) => ({ id: `/koppelen ${c}`, label: c })), { id: '/koppelen geen', label: tp('circle.bot.screen_confirm_none') }],
      });
    },
    // a screen whose offer was not taken is told, so it says so instead of waiting
    tellRefused: (viewPubKey) => agent.sendPeerMessage(viewPubKey, { subtype: SCREEN_REFUSED_SUBTYPE }),
    columnOf: async (person) => screenColumnFor(doorCatalogue.catalogue(), (await botUsers.list()).find((u) => u.id === person)?.role ?? null),
    grant: (g) => agent.callSkill('household', 'grantSurface', { viewPubKey: g.viewPubKey, ops: g.ops, actingAs: g.actingAs, label: g.label, nonce: g.nonce }),
    revokeView: async (viewPubKey) => (await agent.callSkill('household', 'revokeSurface', { viewPubKey }))?.revoked === true,
    listGrants: async () => (await agent.callSkill('household', 'listSurfaceGrants', {}))?.surfaces ?? [],
    notify: async (person, key, params) => {
      const lang = threads.langOf(person);
      await reach.sendToPerson(person, { text: t(key, { ...params, days: Math.round(SURFACE_GRANT_TTL_MS / 86_400_000) }, lang ?? undefined) });
    },
    where: () => ({ appUrl: appUrl || null, botAddress: agent.identity?.chat?.pubKey ?? null, relayUrl: relayUrl || null, botName: tgBridge?.botUsername ? `@${tgBridge.botUsername}` : null }),
  }) : null;
  // What admits, removes or re-roles people runs from a screen only after a yes in the person's private chat; the
  // screen hears the outcome (the answer itself — an invite link — is said in that chat).
  const stepUp = screens ? createScreenStepUp({
    ask: (person, { text, buttons }) => reach.sendToPerson(person, { text, buttons, rememberAs: text }),
    tell: (viewPubKey, o) => agent.sendPeerMessage(viewPubKey, { subtype: SCREEN_STEP_UP_SUBTYPE, ...o }),
  }) : null;
  const doorCall = withAssistantOps({
    callSkill, threads, t, refusal: agent.doorRefusal,
    admin: {
      screens,
      stepUp,
      catalogue: doorCatalogue,
      users: () => botUsers.list(),
      admission,
      revoke: (who) => botUsers.revoke(who),
      setRole: (who, role) => botUsers.setRole(who, role),
      exports: exportShelf,
      // a sealed file opens with the key the admin unlocked on the box (`bin/export-key.mjs unlock`); the import closes it
      unlockedKey: async () => { sweepUnlocked(); try { return unlockedSecret(readFileSync(path.join(dataDir, UNLOCKED_KEY_FILE), 'utf8')); } catch { return null; } },
      lockKey: async () => rmSync(path.join(dataDir, UNLOCKED_KEY_FILE), { force: true }),
      // the file's things written back through their own ops, each as its person (the host vouches, as its door does)
      importFile: (file) => importHousehold(file, { call: (app, op, args, ctx) => agent.callSkill(app, op, args, ctx), tier: agent.setDoorCaller }),
      // Telegram's own link: tapping it opens the bot and sends `/start <code>`.
      inviteLink: (code) => (tgBridge?.botUsername ? `https://t.me/${tgBridge.botUsername}?start=${code}` : null),
      status: async () => ({
        model: llm ? llmModel : null, door: 'codes', turns: turnLogMode ?? 'off',
        memory: agent.getParamValue?.(ASSISTANT_MEMORY_DEFAULT_KEY), users: (await botUsers.list()).length,
        unreachable: (await botUsers.list()).filter((u) => threads.unreachableOf(u.id)).length,
      }),
    },
  });
  if (screens) {
    // The door's ops, to a connected screen: each call runs as the person its token names, through this door's own
    // call — the same gate as their typed line — and what a screen never gets is withheld at the kernel's door.
    const exposed = exposeDoorToScreens({ agent, catalogue: doorCatalogue.catalogue(), manifests: Object.values(doorCatalogue.manifestsByOrigin()), doorCall, users: botUsers });
    screenOffer.handle = async (from, payload) => {
      const offer = parsePairingOffer(payload?.offer);
      const r = offer.ok ? await screens.offer({ from, viewPubKey: offer.viewPubKey, nonce: offer.nonce, label: offer.label }) : { ok: false, reason: offer.reason };
      walkLog({ kind: 'screen-offer', ok: r.ok, ...(r.ok ? { to: String(r.person).slice(-4), ops: r.ops.length } : { reason: r.reason }) });
    };
    walkLog({ kind: 'screens', exposed });
  }
  tgRunner = createTelegramRunner({
    bridge: multiplexBridges([tgBridge, inboxDoor.bridge]),
    catalogue: doorCatalogue.catalogue,
    manifestsByOrigin: doorCatalogue.manifestsByOrigin,
    // The door's own ops — a person's memory mode and language, the admin's app list, status and users — are
    // answered here, each after the host gate said yes at the op's level; the rest go on to the agent.
    t, lang: values.lang,
    callSkill: doorCall,
    admit: doorAdmit,
    threads,
    // What the model may draw on: a household bot's list entries, a person's household items.
    loadItems: isFunctionProfile ? loadListItems({ callSkill }) : loadAssistantItems({ callSkill }),
    ...(llm ? { llm, interpret: interpretToCommand } : {}),
    // Turns go into the walk log only when the operator asks, and then the people in the house are told.
    walkLog: turnLogFor(turnLogMode, walkLog),
    turnLogMode,
    // A household bot: its model is told about its household's lists (the template's words), each person sees their
    // own tools (a member's or the admin's), and the deterministic gate speaks the lists.
    ...(isFunctionProfile ? {
      // the model's lines and the gate's rules, generated from the template's lists (their names, their words)
      promptLines: botPromptLines(t),
      roleFor: (threadId) => doorAdmit.roleOf(threadId),
      scopeToRole: scopeCatalogueToRole,
      hintsFor: (threadId) => roleHintsFor(doorAdmit.roleOf(threadId), t),
      // one add per thing named ("melk en kaas" → two), whether the gate or the model chose the add
      expand: expandAdds({ t }),
      gateRules: listsGateRules(values.lang, templateLists(t)),
      // the first message says what this bot does for this person, and how the reminders stand and change
      welcomeFor: ({ role, ops, t: tp }) => welcomeLines({ ops, role, lists: templateLists(t), t: tp ?? t, settings: reminderSettings() }),
      // without the model (off, or not answering): what does work, for this person — the word rules and the commands
      basicHelpFor: ({ ops, t: tp }) => basicModeLines({ ops, lists: templateLists(t), t: tp ?? t }),
      // `/help` for a person: their language, grouped, the admin's commands last (their level on the bot's map)
      helpLines: ({ commandMenu, opsById, t: tp }) => botHelpLines({
        commandMenu, opsById, t: tp,
        isAdmin: (entry) => (entry.appOrigin === 'assistant' ? entry.op?.visibility === 'trusted' : botOpLevel(entry.op?.id) === 'trusted'),
      }),
    } : {}),
  });
  await tgRunner.start();
  // A household bot writes first, too: reminders of what people dated, on each person's own door (the tick asks the
  // projection every few minutes; the household's switch and quiet hours are the admin's settings).
  if (isFunctionProfile) {
    const reminderTick = createReminderTick({
      sources: () => agent.reminderSources(), users: botUsers, threads, reach, t,
      tz: process.env.TZ || Intl.DateTimeFormat().resolvedOptions().timeZone,
      settings: reminderSettings,
      // the walk log keeps that a reminder went out (to whom, as the last digits; how many things) — never its words
      onSent: (e) => walkLog({ kind: 'reminder', to: String(e.personId).slice(-4), items: e.items, ok: e.ok, ...(e.reason ? { reason: e.reason } : {}) }),
      // the Sunday overview is the weekOverview op asked AS the person — the gate, the role and the names apply
      overviewFor: async (id) => (await doorCall('assistant', 'weekOverview', {}, { caller: id, threadId: id }))?.message ?? null,
    });
    reminderTick.start();
    exportShelf.start();
    walkLog({ kind: 'reminders', on: remindersModeFrom(agent.getParamValue?.(REMINDERS_KEY)) === 'on' });
  }
  // A household bot (a function profile) starts with the household's lists — made once, when it has none. Never on a
  // person's node: their circle is theirs, and four lists would appear on every device of theirs.
  if (isFunctionProfile) {
    ensureHouseholdLists({ callSkill, t })
      .then(async (made) => {
        // Every start: the template's plugins are in the bot's app list (lists hold, tasks move, the calendar keeps the
        // Agenda) — also on a bot whose list was set before the template grew; the owner's own apps stay.
        const next = withTemplateApps(doorCatalogue.apps());
        if (next) await doorCatalogue.setApps(next).catch(() => {});
        if (made.length || next) walkLog({ kind: 'household-template', lists: made.length, apps: next ?? doorCatalogue.apps() });
      })
      .catch((err) => console.warn(`device-runner: the household lists were not made (${err?.message ?? err})`));
  }
  if (bootstrapCode && tgBridge?.botUsername) console.log(`device-runner: …or open  https://t.me/${tgBridge.botUsername}?start=${bootstrapCode}`);
  walkLog({ kind: 'assistant', doors: [tgBridge ? 'telegram' : null, inboxDoor.bridge ? 'inbox' : null].filter(Boolean), admission: 'codes', bootstrap: bootstrapUids.length, llm: llm ? llmModel : null, apps, turns: turnLogMode ?? 'off' });
}

// ── What the operator needs to see ──────────────────────────────────────────────────────────────
const card = await callSkill('stoop', 'getContactShareQr', {}).catch(() => null);
// `clock`: the zone the household's times are read and shown in (the role's TZ; a bare container is UTC).
walkLog({ kind: 'run', ts: new Date().toISOString(), shell: 'device', relay: relayUrl || null, telegram: !!tgToken, clock: process.env.TZ || Intl.DateTimeFormat().resolvedOptions().timeZone });
console.log(`\ndevice-runner: up — data in ${dataDir}`);
console.log(`  log       ${deviceLog.size} entr${deviceLog.size === 1 ? 'y' : 'ies'} restored from disk`);
console.log(`  wire      ${relayUrl || 'LOCAL ONLY (set ONDERLING_RELAY_URL to join the relay)'}`);
console.log(`  telegram  ${tgToken ? 'on' : 'off (no token)'}`);
if (card?.payload) {
  console.log('\n  This device as a contact — hand this to whoever should be able to write to you:\n');
  console.log(`    ${card.payload}\n`);
}
console.log(`  walk log  ${walkLogFile}\n`);

const stop = async () => {
  try { await tgRunner?.stop?.(); } catch { /* stopping is best-effort */ }
  // The stores write behind a short debounce (200 ms in the file adapters, 400 ms for the device log,
  // whose timer is unref'd and would not hold the process either). A stop that exits inside that window
  // loses the last change — a roster row learned a moment before a deploy's restart, and the box came
  // back not knowing a device it had just met (2026-09-14). The stores expose no flush through the
  // agent yet; until they do, the window is waited out, with margin for the write itself.
  await new Promise((resolve) => { setTimeout(resolve, 700); });
  process.exit(0);
};
process.on('SIGINT', stop);
process.on('SIGTERM', stop);
