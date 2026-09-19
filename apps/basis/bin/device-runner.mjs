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
 *   ONDERLING_PRIMARY_DEVICE  optional — `1`: this device is the person's PRIMARY contact address (sync-policy
 *                            §12): it registers the profile and person addresses as primary on every relay, and
 *                            its per-circle addresses take the primary slot on the roster, so a direct message
 *                            lands HERE and not on the phone. The headless form of the tap on Mij / My data;
 *                            enrolling alone never makes a box primary. Claimed once per start, carried to the siblings.
 *
 * Flags: --data-dir · --lang · --walk-log · --show-offer (print an add-a-device offer and exit) ·
 *        --enrol (phone-first: paste the phone's offer, type the phrase, exit; then start as usual)
 *
 * The recovery phrase is NEVER read from the environment or a file here. A device is enrolled by a
 * ceremony that asks for it, once (`--enrol`, on stdin, echo off on a terminal); storing it beside the
 * machine that runs unattended would hand the whole account to anyone who reads that machine's disk.
 */
import { readFileSync, writeFileSync, existsSync, mkdirSync, appendFileSync, rmSync, statSync } from 'node:fs';
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
import { buildAssistantLlm } from '../src/telegram/assistantLlm.js';
import { listsManifest } from '../../lists/manifest.js';

import { EventLog } from '../src/eventLog.js';
import { wireEventLogPersistence, fileSnapshotIo, fileKeyValueStorage } from '../src/v2/eventLogPersistence.js';
import { stashEnrollOffer, consumeEnrollOffer } from '../src/v2/enrollOffer.js';
import { primeCircleSecurity, announceCircleAddresses } from '../src/v2/circleSecurityPriming.js';
import { registerCircleAddressesOnRelays } from '../src/v2/circleAddressRegistration.js';
import { makePeerRouter } from '../src/core/handlers/peerRouter.js';
import { buildCircleLanes } from '../src/v2/circleLanes.js';
import { createNodeFsBackend } from '@onderling/pseudo-pod/node';
import { createContactThreadChannel } from '../src/v2/contactThreadChannel.js';
import { createContactDmStore } from '../src/v2/contactDmStore.js';
import { makeHandleThreadedChat } from '../src/core/handlers/threadedChat.js';
import { makeCircleAddressAnnouncePeerHandler, announceOwnCircleAddress, propagateCircleAddressesAfterJoin } from '../src/v2/circleAddressAnnounce.js';
import { makeHandleGroupRedeemRequest, makeHandleGroupRedeemResponse, makeSendGroupRedeemRequest } from '../src/core/handlers/groupRedeem.js';
import { createPairRoster } from '../src/v2/pairRoster.js';
import { makeCircleReachable } from '../src/v2/householdRosterPairing.js';
import { makeRosterUpdatedPeerHandler } from '../src/v2/rosterUpdated.js';
import { applyRulesUpdates } from '../src/v2/rulesUpdateLane.js';
import { makeGovernanceRail } from '../src/v2/governanceAppWiring.js';

const { values } = parseArgs({ options: {
  'data-dir':   { type: 'string',  default: path.join(homedir(), '.basis-device') },
  lang:         { type: 'string',  default: 'nl' },
  'walk-log':   { type: 'string' },
  'show-offer': { type: 'boolean', default: false },
  enrol:        { type: 'boolean', default: false },
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
  deviceLog: path.join(dataDir, 'device-log.json'),
  contactDm: path.join(dataDir, 'contact-dm.json'),
};
// The device log is the record every lane rides, so it is hydrated from disk BEFORE the agent boots:
// a device that forgets its log on restart would re-admit a connection its owner revoked, and would
// come back to its circles as if it had never been in them.
const deviceLog = new EventLog({ initial: [], muted: [] });
const { hydrated } = await wireEventLogPersistence({
  eventLog: deviceLog, io: fileSnapshotIo(contentPaths.deviceLog),
});

// Where an add-a-device offer waits between the enrol ceremony and the next start — the node shape of
// what the shells keep in plain storage. Public data (the offer grants nothing without the phrase).
const offerStash = fileKeyValueStorage(path.join(dataDir, 'enroll-offer.json'));

// EVERYTHING A SHELL KEEPS, this device keeps — on disk, under the data dir, sealed like the shells seal
// it. Until 2026-09-14 only the household items and the log were kept; the registry (which circles this
// device is in, which devices the person has), the item store (rosters, contacts, the trail) and the
// settings were memory, and a restart — every deploy of a box — came back to no circles at all. The
// same descriptors the web app passes, with a file where it has an IndexedDB store.
const agent = await createRealHouseholdAgent({
  ownerRootVault: vault,
  chatVault,
  registryBackend: createNodeFsBackend({ dir: contentPaths.registry }),
  stoopPersistDb:     { path: contentPaths.stoop },
  householdPersistDb: { path: contentPaths.household },
  tasksPersistDb:     { path: contentPaths.tasks },
  settingsPersistDb:  { path: contentPaths.settings },
  outboxPersistDb:    { path: contentPaths.outbox },
  deviceLog,
  seedDemoData: false,
  seedHousehold: false,
  enrollOfferStorage: offerStash,
});
const callSkill = (app, op, args) => agent.callSkill(app, op, args);

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
    for (const p of Object.values(contentPaths)) { try { rmSync(p, { recursive: true, force: true }); } catch { /* nothing there */ } }
    console.log(`device-runner: enrolled as device ${String(r.deviceId ?? '').slice(0, 12)}… for ${stashed.circles.length} circle(s).`);
    console.log('  Now start the runner as usual; on that start it joins the circles the offer names.');
    return 0;
  } finally { rl.close(); }
}
if (values.enrol) { process.exit(await enrolOnce()); }

// ── The wire ────────────────────────────────────────────────────────────────────────────────────
let contactChannel = null;
let pairRoster = null;         // the pair roster for contacts (L105) — composed with the contact channel
if (relayUrl) {
  // The durable home of 1:1 threads, file-backed so a restart is the same conversations. Same
  // constructor both shells use; only the backing differs, which is the whole of what a shell decides.
  const dmSource = await buildHouseholdDataSource({ path: contentPaths.contactDm }).catch(() => null);
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
    contactChannel.persistInbound({ contactId, fromAddr, text, buttons, messageId, replyTo, ts })
      ?.then((r) => { if (!r?.deduped) walkLog({ kind: 'contact-turn', from: String(fromAddr).slice(0, 12), text }); })
      ?.catch(() => { /* durability is best-effort, as in the shells */ });
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
      [contactChannel.subtypes.out]: contactChannel.messageHandler(landTurn),
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
  agent.bootstrapFromStashedOffer = () => consumeEnrollOffer({
    agent, callSkill,
    sendPeerMessage: (to, payload, o) => agent.sendPeerMessage(to, payload, o),
    storage: offerStash,
    registerCirclePresence: (ids) => registerCirclePresence(ids),
    contentPulls: (circleId, siblingAddress) => Promise.allSettled([
      lanes.catchUps.task?.requestFrom(siblingAddress, circleId),
      lanes.catchUps.chat?.requestFrom(siblingAddress, circleId),
    ]),
  }).then((r) => {
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
  // The model is the optional half of this optional half: a key without its SDK is a warning and a
  // Telegram that answers without a model, never a device that is not there.
  const built = await buildAssistantLlm({ model: process.env.PRIVATEMODE_MODEL });
  const llm = built?.llm ?? null; const llmModel = built?.model ?? null;
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
