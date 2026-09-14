/**
 * THE BOX IS REVOKED WHILE IT HOLDS THE ADDRESS — a compromised VPS, walked end to end.
 *
 * The alpha puts a device of Frits' on a rented machine: the box, enrolled from the web app, holding
 * his profile address on the relay so that feedback lands somewhere that is always on. A rented machine
 * is exactly the device one day has to be cut off — the host is breached, the lease ends, the operator
 * is no longer trusted. What must be true then: from the web app, with the phrase, the box is retired
 * from every circle the person is in, the web app is itself again on the wire, and a box that keeps
 * running with what it holds can do as little as the design allows. Every part of that exists; nothing
 * had shown what a REVOKED box can still do, on the wire, with the real binary.
 *
 *   1  the web app + Bea in a circle; the box enrolled from the web app (the real binary); a person
 *      with the card writes — the box takes it and hands it to the web app (the alpha's path)
 *   2  the web app lists the box among its devices — the row its revoke door acts on
 *   3  the ceremony: the box's address is retired everywhere, and the web app — now an enrolled
 *      device of its own — re-announces itself and holds the profile address again
 *   4  the circle after: Bea writes, the web app has it, the box never does
 *   5  what the revoked box can still do: it holds the profile key. Nothing it says counts as one of
 *      the person's devices any more — and it can still take the profile address back on the relay,
 *      which is the window the design states rather than closes
 *
 * The one hand-off: the walk hands the box's printed card to `seedContactCard`. Everything else is the
 * production path, over a real relay.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync, readFileSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { VaultMemory } from '@onderling/vault';
import { createMemoryBackend } from '@onderling/pseudo-pod';
import { deviceDelegationsOf } from '@onderling/agent-registry';
import { EventLog } from '../src/eventLog.js';
import { startJourneyRelay } from './support/testRelay.js';
import {
  bootRealAgentNode, connectNodesOverRelay, pairCircle, bindCircleAddresses, sendCircleChat, until, teardown,
} from './support/pairRealAgents.js';
import { rosterBindingVerifier } from '../src/v2/membershipRail.js';
import { primeCircleSecurity, announceCircleAddresses } from '../src/v2/circleSecurityPriming.js';
import { seedContactCard } from '../src/v2/seededContact.js';

const RUNNER = fileURLToPath(new URL('../bin/device-runner.mjs', import.meta.url));
const CIRCLE = 'thuis-revoke-box-circle';

const cardFrom = (out) => (/onderling-contact:\/\/([A-Za-z0-9_-]+)/.exec(out) ?? [null])[0];
const walkLog = (dir) => readdirSync(dir).filter((f) => f.startsWith('walk-log-')).flatMap((f) =>
  readFileSync(path.join(dir, f), 'utf8').split('\n').filter(Boolean).map((l) => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean));
function run(args, { env, stdin = null }) {
  const child = spawn(process.execPath, [RUNNER, ...args], { env, stdio: [stdin ? 'pipe' : 'ignore', 'pipe', 'pipe'] });
  const state = { child, out: '' };
  child.stdout.on('data', (b) => { state.out += String(b); });
  child.stderr.on('data', (b) => { state.out += String(b); });
  if (stdin) { child.stdin.write(stdin); child.stdin.end(); }
  state.exited = new Promise((resolve) => child.on('exit', (code) => resolve(code)));
  return state;
}
const chatIn = (node, circleId) => node.chatRail.storedStatements(circleId).map((s) => s?.body?.payload?.text).filter(Boolean);
const arrives = (node, circleId, text, why) => until(async () => (chatIn(node, circleId).includes(text) ? true : null), { timeout: 25_000, step: 200 }).then((got) => expect(got, why).toBe(true));
const textsIn = async (node, contactId) => ((await node.contactThreadChannel.rehydrate(contactId)) ?? []).map((t) => t.text);
/** A member's proven address set for the person, as one node's roster has it. */
async function addressesOf(node, webid) {
  const r = await node.agent.callSkill('stoop', 'listGroupMembers', { groupId: CIRCLE });
  const row = (r?.members ?? []).find((m) => m.webid === webid);
  return row?.circleAddresses ?? [];
}
/** One node's roster of the circle, compact enough for a failure message. */
async function rosterView(node) {
  const r = await node.agent.callSkill('stoop', 'listGroupMembers', { groupId: CIRCLE });
  return JSON.stringify((r?.members ?? []).map((m) => ({ who: m.webid.slice(0, 8), set: (m.circleAddresses ?? []).map((x) => x.slice(0, 8)) })));
}
/** The other devices on a node's registry, live and tombstoned. */
async function devicesOn(node) {
  const props = await node.agent.callSkill('agents', 'getProfileProperties', { id: 'default' });
  return Object.values(deviceDelegationsOf({ properties: props?.properties ?? {} }))
    .map((d) => ({ deviceId: d.deviceId, label: d.label ?? null, revoked: d.revoked === true }));
}
async function startBox(dataDir, env) {
  const box = run(['--data-dir', dataDir], { env });
  expect(await until(async () => (box.out.includes('device-runner: up') ? true : null), { timeout: 90_000, step: 250 }), `the box never came up:\n${box.out.slice(-1500)}`).toBe(true);
  return box;
}

describe('the box is revoked while it holds the address', () => {
  let relay; let relayUrl; let dataDir; let env; let web; let bea; let box; let person; let phrase; let boxAddr; let boxDeviceIdPrefix; let oldWebAddr;
  // What the web app keeps across a reload: its vaults, its registry, its device log, and its item store
  // (IndexedDB in the browser; a file here). A reboot that forgot any of these would not be a reload.
  const webDir = mkdtempSync(path.join(tmpdir(), 'basis-revoke-web-'));
  const webVaults = { ownerRootVault: new VaultMemory(), chatVault: new VaultMemory() };
  const webRegistry = createMemoryBackend();
  const webLog = new EventLog({ initial: [], muted: [] });
  const webKeeps = { ...webVaults, registryBackend: webRegistry, deviceLog: webLog, stoopPersistDb: { path: path.join(webDir, 'stoop-state.json') } };
  const beaRef = {};
  const productionBinding = (ref) => rosterBindingVerifier((app, op, args) => ref.node.agent.callSkill(app, op, args));
  /** The web app, booted on its own vaults, on the relay, in its circle — what a shell does on connect: prime,
   *  register the per-circle address, announce it (`registerCirclePresence`). */
  async function bootWeb(label) {
    const node = await bootRealAgentNode(label, { contactChannel: true, agentOpts: webKeeps });
    await node.agent.connectPeerTransport({ relayUrl, onPeerMessage: (env2) => node._routerRef.fn?.(env2), awaitRelayReady: true });
    await primeCircleSecurity({ agent: node.agent, circleIds: [CIRCLE] });
    await bindCircleAddresses([node], CIRCLE);
    await announceCircleAddresses({ agent: node.agent, circleIds: [CIRCLE] });
    return node;
  }

  beforeAll(async () => {
    relay = await startJourneyRelay();
    relayUrl = relay.url;
    dataDir = mkdtempSync(path.join(tmpdir(), 'basis-revoke-box-'));
    env = { PATH: process.env.PATH, HOME: dataDir, ONDERLING_RELAY_URL: relayUrl, BASIS_VAULT_PASSPHRASE: 'test-only-passphrase'};

    // 1 · the web app and Bea, one circle, a conversation; the box enrolled from the web app.
    web = await bootRealAgentNode('web', { contactChannel: true, agentOpts: webKeeps });
    bea = await bootRealAgentNode('bea', { contactChannel: true, verifyChatBinding: productionBinding(beaRef), agentOpts: { deviceLog: new EventLog({ initial: [], muted: [] }) } });
    beaRef.node = bea;
    await connectNodesOverRelay([web, bea], { relayUrl });
    await pairCircle(web, bea, { groupId: CIRCLE, name: 'Thuis', handle: 'bea' });
    await bindCircleAddresses([web, bea], CIRCLE);
    await sendCircleChat(web, { groupId: CIRCLE, msgId: 'pre-1', text: 'voordat de doos erbij kwam' });
    await arrives(bea, CIRCLE, 'voordat de doos erbij kwam', 'Bea never received the first message');

    phrase = (await web.agent.callSkill('household', 'revealOwnerPhrase', {}))?.mnemonic;
    expect(phrase?.split(/\s+/).length).toBe(24);
    const offer = await web.agent.callSkill('household', 'buildEnrollOffer', { relayUrl });
    expect(offer.ok, JSON.stringify(offer)).toBe(true);
    const once = run(['--data-dir', dataDir, '--enrol'], { env, stdin: `${offer.uri}\n${phrase}\n` });
    expect(await once.exited, `--enrol did not exit cleanly:\n${once.out.slice(-1200)}`).toBe(0);
    boxDeviceIdPrefix = (/enrolled as device ([A-Za-z0-9-]+)…/.exec(once.out) ?? [])[1];
    expect(boxDeviceIdPrefix, `the ceremony did not say which device it made:\n${once.out.slice(-600)}`).toBeTruthy();
    box = await startBox(dataDir, env);
    expect(await until(async () => walkLog(dataDir).find((e) => e.kind === 'enroll-offer') ?? null, { timeout: 60_000, step: 500 }), 'the box never consumed the offer').toBeTruthy();
    // The box's per-circle address lands in the person's row — on the web app and on Bea's device.
    const webOwn = web.agent.circleAddressFor(CIRCLE);
    boxAddr = await until(async () => (await addressesOf(web, web.pubKey)).find((a) => a !== webOwn) ?? null, { timeout: 30_000, step: 250 });
    expect(boxAddr, 'the web app never learned the box\'s per-circle address').toBeTruthy();
    const beaKnows = await until(async () => ((await addressesOf(bea, web.pubKey)).includes(boxAddr) ? true : null), { timeout: 30_000, step: 250 });
    expect(beaKnows,
      `Bea never learned the box's per-circle address — nothing to retire at her end. The box's consume: ${JSON.stringify(walkLog(dataDir).find((e) => e.kind === 'enroll-offer'))}; Bea's row: ${JSON.stringify(await addressesOf(bea, web.pubKey))}; box out:\n${box.out.slice(-2500)}`).toBe(true);

    // A person with the card writes; the box takes it (it holds the profile address as the last
    // registration) and hands it to the web app — the alpha's feedback path, as the baseline.
    person = await bootRealAgentNode('person', { contactChannel: true });
    await connectNodesOverRelay([person], { relayUrl });
    const card = cardFrom(box.out);
    expect(card, `the box printed no card:\n${box.out.slice(-800)}`).toBeTruthy();
    expect((await seedContactCard({ payload: card, callSkill: (a, o, g) => person.agent.callSkill(a, o, g) })).seeded).toBe(true);
    await person.contactThreadChannel.sendTurn({ peerAddr: web.pubKey, threadId: web.pubKey, text: 'hoi, de knop doet niets', messageId: 'fb-1' }).sent;
    expect(await until(async () => walkLog(dataDir).find((e) => e.kind === 'contact-turn' && e.text === 'hoi, de knop doet niets') ?? null, { timeout: 30_000, step: 500 }),
      `the box did not take the feedback:\n${box.out.slice(-1200)}`).toBeTruthy();
    expect(await until(async () => (web.contactTurnsSeen.some((t) => t?.text === 'hoi, de knop doet niets') ? true : null), { timeout: 30_000, step: 250 }),
      `the web app never got the feedback from the box — refused: ${JSON.stringify(web.contactTurnsRefused)}; box:\n${box.out.slice(-2500)}`).toBe(true);
  }, 300_000);

  afterAll(async () => {
    try { box?.child?.kill('SIGTERM'); } catch { /* */ }
    await teardown(web, bea, person);
    try { await relay?.close?.(); } catch { /* */ }
    for (const d of [dataDir, webDir]) { try { rmSync(d, { recursive: true, force: true }); } catch { /* */ } }
  });

  it('2 · the web app lists the box among its devices — the row its revoke door acts on', async () => {
    // The box wrote its delegation to ITS registry at the ceremony; the web app's registry is a local
    // store too, and nothing mirrors them in the alpha (no pod). The web app must still know the box:
    // the box proved its root-signed delegation to the web app when it asked for the roster seed, and
    // a device that verified that record keeps it — or My data shows no box and there is no door.
    const devices = await until(async () => {
      const ds = await devicesOn(web);
      return ds.find((d) => d.deviceId.startsWith(boxDeviceIdPrefix)) ? ds : null;
    }, { timeout: 15_000, step: 250 });
    expect(devices, 'the web app\'s device list does not know the box — My data shows nothing to revoke').toBeTruthy();
    const row = devices.find((d) => d.deviceId.startsWith(boxDeviceIdPrefix));
    expect(row.revoked).toBe(false);
    expect(row.label, 'the row is legible: the label the ceremony gave the device').toBe('box');
  }, 30_000);

  it('3 · the ceremony: the box\'s address is retired everywhere, and the web app is itself again on the wire', async () => {
    const devices = await devicesOn(web);
    const deviceId = devices.find((d) => d.deviceId.startsWith(boxDeviceIdPrefix))?.deviceId;
    expect(deviceId, 'no box on the device list to revoke').toBeTruthy();
    const r = await web.agent.callSkill('household', 'revokeDevice', { mnemonic: phrase, deviceId });
    expect(r.ok, r.error).toBe(true);
    expect(r.known, 'the ceremony flipped the record it had, rather than minting one').toBe(true);
    expect(r.revokedIn.map((x) => x.circleId), 'the retirement covers Thuis').toContain(CIRCLE);
    expect(r.revokedIn.find((x) => x.circleId === CIRCLE)?.address, 'the retired address is the box\'s').toBe(boxAddr);
    // The tombstone: the device list shows the box struck through.
    expect((await devicesOn(web)).find((d) => d.deviceId === deviceId)?.revoked, 'the registry did not tombstone the box').toBe(true);

    // Bea's row for the person no longer names the box; the web app's own row neither.
    expect(await until(async () => ((await addressesOf(bea, web.pubKey)).includes(boxAddr) ? null : true), { timeout: 30_000, step: 250 }),
      'Bea still names the box\'s address').toBe(true);
    expect(await addressesOf(web, web.pubKey), 'the web app still names the box\'s address on its own row').not.toContain(boxAddr);
    // Bea's door: a statement the box signs in this circle no longer binds to the person.
    expect(await productionBinding(beaRef)({ author: boxAddr, ref: web.pubKey, circleId: CIRCLE }), 'Bea would still accept the box as the person').toBe(false);

    // The ceremony's end on a first device: it enrolled ITSELF (every legitimate device now signs with a
    // revocable key), so it asks for a reload. The reload is the reconnect: a delegation boot, fresh
    // per-circle addresses announced into every roster, and the profile address registered again.
    expect(r.migrated, 'the first device did not enrol itself at the ceremony').toBe(true);
    expect(r.reloadRequired).toBe(true);
    // The person who has been writing to the web app is known to it — by the box's hand, since their
    // greeting landed on the box — and stays known across the reload.
    expect(!!web.agent.sa.agent.security.getPeerKey(person.pubKey), 'the web app does not hold the person\'s key before the reload').toBe(true);
    // A greeting that lands AFTER the ceremony resealed the vaults must not cost the snapshot: this
    // running agent still writes under the old key, and a write now would replace the carried-over
    // snapshot with one the next boot cannot open (CI found it: the person's binding saved late, gone
    // after the reload). The ceremony wrote the snapshot once, just before the reseal, and froze it.
    web.agent.sa.agent.emit?.('peer', { address: bea.pubKey, pubKey: bea.pubKey });
    await new Promise((res) => { setTimeout(res, 600); });
    oldWebAddr = web.agent.circleAddressFor(CIRCLE);
    const webPubKey = web.pubKey;
    await teardown(web);
    web = await bootWeb('web-after');
    expect(web.pubKey, 'the reloaded web app is the same person').toBe(webPubKey);
    expect(web.agent.isEnrolledDevice(), 'the reloaded web app is an enrolled device').toBe(true);
    const newWebAddr = web.agent.circleAddressFor(CIRCLE);
    expect(newWebAddr, 'an enrolled device presents a fresh per-circle address').not.toBe(oldWebAddr);
    expect(await until(async () => ((await addressesOf(bea, web.pubKey)).includes(newWebAddr) ? true : null), { timeout: 45_000, step: 250 }),
      `Bea never learned the web app's new address — her row: ${JSON.stringify(await addressesOf(bea, web.pubKey))}`).toBe(true);
  }, 180_000);

  it('4 · the circle after: Bea writes — the web app has it, the box never does', async () => {
    await sendCircleChat(bea, { groupId: CIRCLE, msgId: 'post-1', text: 'na de intrekking' });
    // The reloaded web app is a new agent instance: what it knows of Bea it re-read from the roster it
    // kept, and this failure says so rather than "no message" (the roster dump found the item store
    // that a reboot forgot, 2026-09-14).
    await arrives(web, CIRCLE, 'na de intrekking', `Bea's message did not reach the reloaded web app — it binds Bea: ${!!web.agent.sa.agent.security.getPeerKey(bea.agent.circleAddressFor(CIRCLE))}; its roster: ${await rosterView(web)}; Bea's: ${await rosterView(bea)}`);
    // The box is not on Bea's row any more, so her fan never tries it. Checked AFTER the web app has
    // the message: both are one fan, so a box that was going to get it has it by now.
    await new Promise((res) => { setTimeout(res, 3000); });
    const onBox = walkLog(dataDir).find((e) => e.kind === 'chat-landed' && e.msgId === 'post-1');
    expect(onBox, 'the revoked box still received circle chat').toBeUndefined();
  }, 60_000);

  it('5 · what the revoked box can still do: nothing it says is the person\'s device — but it can take the profile address back', async () => {
    // The web app holds the profile address again (its reload registered it last): the person's next
    // message lands on the web app DIRECTLY — in its thread, and not by any fan.
    await person.contactThreadChannel.sendTurn({ peerAddr: web.pubKey, threadId: web.pubKey, text: 'werkt het nu?', messageId: 'fb-2' }).sent;
    expect(await until(async () => ((await textsIn(web, person.pubKey)).includes('werkt het nu?') ? true : null), { timeout: 30_000, step: 250 }),
      `the person's message did not reach the web app after the ceremony — the reloaded web app holds the person's key: ${!!web.agent.sa.agent.security.getPeerKey(person.pubKey)}; refused: ${JSON.stringify(web.agent.refusedInboundByReason?.())}`).toBe(true);
    expect(web.contactTurnsSeen.some((t) => t?.text === 'werkt het nu?'), 'it came by a fan, not directly').toBe(false);
    expect(walkLog(dataDir).find((e) => e.kind === 'contact-turn' && e.text === 'werkt het nu?'), 'the revoked box still got the person\'s message').toBeUndefined();

    // The window. The box still runs, and it holds the profile KEY — one per person, derived from the
    // phrase, which no ceremony can retire. Restarted (a reconnect is enough), it registers the profile
    // address again; the relay maps an address to its LAST registration, and knows nothing of a
    // revocation. So the person's next message lands on the box.
    try { box.child.kill('SIGTERM'); } catch { /* */ }
    await box.exited;
    const before = walkLog(dataDir).length;
    box = await startBox(dataDir, env);
    // A restart keeps what a shell keeps: the box comes back knowing its circle (its registry, its item
    // store — a box on a rented machine restarts on every deploy, and until 2026-09-14 came back to none).
    const presence = await until(async () => walkLog(dataDir).slice(before).find((e) => e.kind === 'presence') ?? null, { timeout: 30_000, step: 250 });
    expect(presence?.circles, `the restarted box forgot its circle:\n${box.out.slice(-1500)}`).toBe(1);
    await person.contactThreadChannel.sendTurn({ peerAddr: web.pubKey, threadId: web.pubKey, text: 'en nu?', messageId: 'fb-3' }).sent;
    expect(await until(async () => walkLog(dataDir).find((e) => e.kind === 'contact-turn' && e.text === 'en nu?') ?? null, { timeout: 30_000, step: 500 }),
      'the box did not take the address back — the window this walk states is not there').toBeTruthy();
    // …and hands it on, as it always did. This is what MUST fail, and the box's log names how. A device
    // speaks to its sibling as its address in the circle they share, and the box's is retired — so one of
    // three things, depending on what the box heard before it was cut off: it reaches for the web app's
    // live address and the sender gate refuses the envelope as a stranger's; it only knows the address the
    // web app left behind at the ceremony, and fans into a queue nobody will ever drain; or it heard that
    // address retired too and holds no device of the person's at all, and fans to nobody. (The profile
    // address the box also holds is not a device of the person's on any own-device lane: every device
    // holds that key, a revoked one included.) The web app's thread stays clean whichever it is.
    const live = web.agent.circleAddressFor(CIRCLE);
    const fanned = await until(async () => walkLog(dataDir).slice(before).find((e) => e.kind === 'own-device-fan') ?? null, { timeout: 75_000, step: 250 });
    expect(fanned, `the box did not record its fan — its rosters at boot: ${JSON.stringify(presence.rosters)}:\n${box.out.slice(-800)}`).toBeTruthy();
    const toLive = fanned.outcomes.filter((o) => live.startsWith(o.to));
    if (toLive.length) {
      const refusedAtGate = () => (web.agent.refusedInboundByReason?.()?.SENDER_NOT_AUTHORIZED ?? 0) > 0;
      const refusedAtLane = () => web.contactTurnsRefused.some((x) => x.reason === 'not-a-sibling');
      expect(await until(async () => ((refusedAtGate() || refusedAtLane()) ? true : null), { timeout: 30_000, step: 250 }),
        `the web app did not refuse the revoked box's fan — seen: ${JSON.stringify(web.contactTurnsSeen.map((t) => t?.text))}; refused: ${JSON.stringify(web.agent.refusedInboundByReason?.())}`).toBe(true);
    } else {
      // Dead addresses or none: the box's row for the person names nothing live. Named, so a run that
      // lands here is not mistaken for one where the fan is merely slow.
      const known = presence.rosters?.[CIRCLE]?.find((m) => web.pubKey.startsWith(m.who))?.set ?? [];
      expect(known.some((a) => live.startsWith(a)), 'the box knew the live address and fanned elsewhere').toBe(false);
      await new Promise((res) => { setTimeout(res, 2000); });
    }
    expect(web.contactTurnsSeen.some((t) => t?.text === 'en nu?'), 'the web app accepted a turn from the revoked box').toBe(false);
    expect(await textsIn(web, person.pubKey), 'the revoked box wrote into the web app\'s thread').not.toContain('en nu?');
  }, 180_000);
});
