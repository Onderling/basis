/**
 * THE PHONE IS LOST, AND THERE IS A BOX — the alpha's disaster path, walked end to end.
 *
 * The alpha's setup is phone-first: Frits' phone has the circles; the box enrolled from it (`--enrol`) and
 * takes his feedback while the phone is in a drawer. Then the phone is lost. What must be true: on a new
 * phone, with the phrase and the recovery file, he is himself again, his circles talk to him, the old
 * phone is cut off, and the box comes back to work. Every part of that merged over 2026-09-13; nothing
 * had proven the corridor as one walk, and today's corridors each found a gap no unit test showed.
 *
 *   1  phone + Bea in a circle, a conversation; the box enrolled from the phone (the real binary)
 *   2  the recovery file, with the circle's member list in it
 *   3  the phone is gone
 *   4  a new phone: the phrase, the file → its circles talk to it (Bea writes, it answers)
 *   5  the REPLACE ceremony on the new phone: the lost phone's addresses are retired everywhere —
 *      and so is the box's, deliberately: the first device's addresses are profile-derived, and the one
 *      ceremony that retires them retires every other device the registry lists (architecture §Custody)
 *   6  the box re-enrols from the NEW phone's offer, same data dir, and takes feedback again — which the
 *      new phone sees
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
import { EventLog } from '../src/eventLog.js';
import { startJourneyRelay } from './support/testRelay.js';
import {
  bootRealAgentNode, connectNodesOverRelay, pairCircle, bindCircleAddresses, sendCircleChat, until, teardown,
} from './support/pairRealAgents.js';
import { stashEnrollOffer, consumeEnrollOffer } from '../src/v2/enrollOffer.js';
import { rosterBindingVerifier } from '../src/v2/membershipRail.js';
import { seedContactCard } from '../src/v2/seededContact.js';

const RUNNER = fileURLToPath(new URL('../bin/device-runner.mjs', import.meta.url));
const CIRCLE = 'thuis-lost-phone-circle';

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
const memStorage = () => { const m = new Map(); return { getItem: (k) => m.get(k) ?? null, setItem: (k, v) => { m.set(k, v); }, removeItem: (k) => { m.delete(k); } }; };
const chatIn = (node, circleId) => node.chatRail.storedStatements(circleId).map((s) => s?.body?.payload?.text).filter(Boolean);
const arrives = (node, circleId, text, why) => until(async () => (chatIn(node, circleId).includes(text) ? true : null), { timeout: 25_000, step: 200 }).then((got) => expect(got, why).toBe(true));
const textsIn = async (node, contactId) => ((await node.contactThreadChannel.rehydrate(contactId)) ?? []).map((t) => t.text);

async function enrolBox(dataDir, env, offerUri, phrase) {
  const once = run(['--data-dir', dataDir, '--enrol'], { env, stdin: `${offerUri}\n${phrase}\n` });
  const code = await once.exited;
  expect(code, `--enrol did not exit cleanly:\n${once.out.slice(-1200)}`).toBe(0);
  const box = run(['--data-dir', dataDir], { env });
  expect(await until(async () => (box.out.includes('device-runner: up') ? true : null), { timeout: 90_000, step: 250 }), `the box never came up:\n${box.out.slice(-1500)}`).toBe(true);
  expect(await until(async () => walkLog(dataDir).filter((e) => e.kind === 'enroll-offer').length ? true : null, { timeout: 60_000, step: 500 }), 'the box never consumed the offer').toBe(true);
  return box;
}

describe('the phone is lost, and there is a box', () => {
  let relay; let relayUrl; let dataDir; let env; let phone; let bea; let box; let phrase; let file; let newPhone;
  const newPhoneVaults = { ownerRootVault: new VaultMemory(), chatVault: new VaultMemory() };
  const beaRef = {}; const newRef = {};
  const productionBinding = (ref) => rosterBindingVerifier((app, op, args) => ref.node.agent.callSkill(app, op, args));
  const dirs = [];

  beforeAll(async () => {
    relay = await startJourneyRelay();
    relayUrl = relay.url;
    dataDir = mkdtempSync(path.join(tmpdir(), 'basis-lost-phone-box-'));
    dirs.push(dataDir);
    env = { PATH: process.env.PATH, HOME: dataDir, ONDERLING_RELAY_URL: relayUrl, BASIS_VAULT_PASSPHRASE: 'test-only-passphrase' };

    // 1 · the phone and Bea, one circle, a conversation; the box enrolled from the phone.
    phone = await bootRealAgentNode('phone', { contactChannel: true, agentOpts: { ownerRootVault: new VaultMemory(), chatVault: new VaultMemory(), registryBackend: createMemoryBackend(), deviceLog: new EventLog({ initial: [], muted: [] }) } });
    bea = await bootRealAgentNode('bea', { contactChannel: true, verifyChatBinding: productionBinding(beaRef), agentOpts: { deviceLog: new EventLog({ initial: [], muted: [] }) } });
    beaRef.node = bea;
    await connectNodesOverRelay([phone, bea], { relayUrl });
    await pairCircle(phone, bea, { groupId: CIRCLE, name: 'Thuis', handle: 'bea' });
    await bindCircleAddresses([phone, bea], CIRCLE);
    await sendCircleChat(phone, { groupId: CIRCLE, msgId: 'pre-1', text: 'voordat de telefoon kwijtraakte' });
    await arrives(bea, CIRCLE, 'voordat de telefoon kwijtraakte', 'Bea never received the pre-loss message');

    phrase = (await phone.agent.callSkill('household', 'revealOwnerPhrase', {}))?.mnemonic;
    expect(phrase?.split(/\s+/).length).toBe(24);
    const offer = await phone.agent.callSkill('household', 'buildEnrollOffer', { relayUrl });
    expect(offer.ok, JSON.stringify(offer)).toBe(true);
    box = await enrolBox(dataDir, env, offer.uri, phrase);

    // 2 · the recovery file, with the circle's member list in it.
    const exported = await phone.agent.callSkill('household', 'exportRecoveryFile', {});
    expect(exported.ok, JSON.stringify(exported)).toBe(true);
    expect(exported.rosters?.[CIRCLE], 'the file carries Thuis\'s member list').toBeGreaterThanOrEqual(1);
    file = exported.file;
  }, 300_000);

  afterAll(async () => {
    try { box?.child?.kill('SIGTERM'); } catch { /* */ }
    await teardown(phone, bea, newPhone);
    try { await relay?.close?.(); } catch { /* */ }
    for (const d of dirs) { try { rmSync(d, { recursive: true, force: true }); } catch { /* */ } }
  });

  it('3–4 · the phone is gone; on a new phone the phrase and the file bring the circle back, talking', async () => {
    await teardown(phone);
    phone = null;

    const pre = await bootRealAgentNode('new-phone-pre', { agentOpts: newPhoneVaults });
    expect(await pre.agent.callSkill('household', 'restoreOwnerPhrase', { mnemonic: phrase })).toMatchObject({ ok: true, reloadRequired: true });
    await teardown(pre);
    newPhone = await bootRealAgentNode('new-phone', { contactChannel: true, agentOpts: { ...newPhoneVaults, registryBackend: createMemoryBackend(), deviceLog: new EventLog({ initial: [], muted: [] }) }, verifyChatBinding: productionBinding(newRef) });
    newRef.node = newPhone;
    await newPhone.agent.connectPeerTransport({ relayUrl, onPeerMessage: (env2) => newPhone._routerRef.fn?.(env2), awaitRelayReady: true });

    const imported = await newPhone.agent.callSkill('household', 'importRecoveryFile', { file });
    expect(imported.ok, imported.error).toBe(true);
    expect(imported.bootstrap?.offer, 'the file carried a member list to bootstrap from').toBeTruthy();
    const storage = memStorage();
    expect((await stashEnrollOffer(storage, imported.bootstrap.offer)).ok).toBe(true);
    await bindCircleAddresses([newPhone], CIRCLE);
    const consumed = await consumeEnrollOffer({
      agent: newPhone.agent,
      callSkill: (app, op, args) => newPhone.agent.callSkill(app, op, args),
      sendPeerMessage: (to, payload, opts) => newPhone.agent.sendPeerMessage(to, payload, opts),
      storage,
      contentPulls: (circleId, address) => newPhone.chatCatchUp.requestFrom(address, circleId),
    });
    expect(consumed.circles?.find((c) => c.circleId === CIRCLE)?.ok, JSON.stringify(consumed)).toBe(true);

    await arrives(newPhone, CIRCLE, 'voordat de telefoon kwijtraakte', 'the conversation from before the loss did not come back');
    await sendCircleChat(bea, { groupId: CIRCLE, msgId: 'post-1', text: 'ben je er weer, met een nieuwe?' });
    await arrives(newPhone, CIRCLE, 'ben je er weer, met een nieuwe?', 'Bea\'s message did not reach the new phone');
    await sendCircleChat(newPhone, { groupId: CIRCLE, msgId: 'post-2', text: 'ja — en de doos komt zo terug' });
    await arrives(bea, CIRCLE, 'ja — en de doos komt zo terug', 'the new phone\'s answer did not reach Bea');
  }, 240_000);

  it('5 · the replace ceremony on the new phone retires the lost phone — and the box — everywhere', async () => {
    const r = await newPhone.agent.callSkill('household', 'replaceDevice', { mnemonic: phrase, circleIds: [CIRCLE] });
    expect(r.ok, r.error).toBe(true);
    expect(r.firstDeviceRetired, 'the lost phone (the first device) is retired by derivation').toBe(true);
    // Bea's row for the person keeps ONLY the new phone's address.
    const mine = newPhone.agent.circleAddressFor(CIRCLE);
    const row = await until(async () => {
      const rr = await bea.agent.callSkill('stoop', 'listGroupMembers', { groupId: CIRCLE });
      const me = (rr?.members ?? []).find((m) => m.webid === newPhone.pubKey);
      const set = me?.circleAddresses ?? [];
      return (set.includes(mine) && set.length === 1) ? me : null;
    }, { timeout: 30_000, step: 250 });
    expect(row, 'Bea still names a retired address, or not the new phone\'s').toBeTruthy();
  }, 120_000);

  it('6 · the box re-enrols from the new phone — in a fresh data dir — and takes feedback again, which the new phone sees', async () => {
    try { box.child.kill('SIGTERM'); } catch { /* */ }
    await box.exited;
    const offer = await newPhone.agent.callSkill('household', 'buildEnrollOffer', { relayUrl });
    expect(offer.ok, JSON.stringify(offer)).toBe(true);
    // The retired install refuses to enrol again, and says what to do instead — before asking for the phrase.
    const again = run(['--data-dir', dataDir, '--enrol'], { env, stdin: `${offer.uri}\n${phrase}\n` });
    expect(await again.exited, 'a second ceremony in the same data dir must be refused').toBe(2);
    expect(again.out).toMatch(/already an enrolled device/);
    expect(again.out, 'the phrase must not have been asked for').not.toMatch(/recovery phrase/);
    // The operator's move: a fresh data dir. The old one keeps its threads sealed; the phone has them.
    const freshDir = mkdtempSync(path.join(tmpdir(), 'basis-lost-phone-box2-'));
    dirs.push(freshDir);
    dataDir = freshDir;
    // The operator's move, second half: the new phone RESTORED itself as the primary contact address (a replacement
    // is), so a direct message would land there and reach the box only by the carry. The feedback box is meant to
    // TAKE the feedback: the operator says so (`ONDERLING_PRIMARY_DEVICE=1`, the headless tap) — enrolling alone
    // never makes a box primary (sync-policy §12.3).
    box = await enrolBox(dataDir, { ...env, HOME: dataDir, ONDERLING_PRIMARY_DEVICE: '1' }, offer.uri, phrase);
    // The new phone learns the re-enrolled box's address — its own row grows again.
    const mine = newPhone.agent.circleAddressFor(CIRCLE);
    const grown = await until(async () => {
      const rr = await newPhone.agent.callSkill('stoop', 'listGroupMembers', { groupId: CIRCLE });
      const me = (rr?.members ?? []).find((m) => m.webid === newPhone.pubKey);
      const others = (me?.circleAddresses ?? []).filter((a) => a !== mine);
      return others.length ? others : null;
    }, { timeout: 30_000, step: 250 });
    expect(grown, 'the new phone never learned the re-enrolled box\'s address').toBeTruthy();

    // A person writes to Frits — the same card, the same profile address — and the box takes it,
    // and hands it to the new phone.
    const card = cardFrom(box.out);
    expect(card, 'the re-enrolled box printed no card').toBeTruthy();
    const person = await bootRealAgentNode('person', { contactChannel: true });
    try {
      await person.agent.connectPeerTransport({ relayUrl, onPeerMessage: (env2) => person._routerRef.fn?.(env2), awaitRelayReady: true });
      expect((await seedContactCard({ payload: card, callSkill: (a, o, g) => person.agent.callSkill(a, o, g) })).seeded).toBe(true);
      await person.contactThreadChannel.sendTurn({ peerAddr: newPhone.pubKey, threadId: newPhone.pubKey, text: 'na de wissel: werkt het nog?', messageId: 'fb-after-1' }).sent;
      const onBox = await until(async () => walkLog(dataDir).find((e) => e.kind === 'contact-turn' && e.text === 'na de wissel: werkt het nog?') ?? null, { timeout: 30_000, step: 500 });
      expect(onBox, `the re-enrolled box did not take the feedback:\n${box.out.slice(-1200)}`).toBeTruthy();
      const onPhone = await until(async () => (newPhone.contactTurnsSeen.some((t) => t?.text === 'na de wissel: werkt het nog?') ? true : null), { timeout: 30_000, step: 250 });
      expect(onPhone, `the new phone never got it from the box — refused: ${JSON.stringify(newPhone.contactTurnsRefused)}; thread: ${JSON.stringify(await textsIn(newPhone, person.pubKey))}; own address ${mine.slice(0, 12)}; my row: ${JSON.stringify(((await newPhone.agent.callSkill('stoop', 'listGroupMembers', { groupId: CIRCLE }))?.members ?? []).find((m) => m.webid === newPhone.pubKey)?.circleAddresses?.map((a) => a.slice(0, 12)))}; circles: ${JSON.stringify((await newPhone.agent.callSkill('stoop', 'listMyCircles', {}))?.circles)}`).toBe(true);
    } finally { await teardown(person); }
  }, 240_000);
});
