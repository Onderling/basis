/**
 * THE ALPHA FEEDBACK PATH, END TO END — a fresh install writes to the maker, and the maker answers.
 *
 * Frits, 2026-09-09: alpha feedback goes to Frits himself — his own account, as an ordinary CONTACT that
 * every fresh install ships with, reached on an always-on device (the box) so it never lands in a drawer.
 * Everything that chain needs merged on 2026-09-13: the seeded contact (a card added on first boot), the
 * box as a full device (enrolled phone-first, registered on the relay), and "own devices tell each other
 * who they know" plus the contact-turn fan, so what lands on the box is on the phone too and the phone can
 * answer. Nothing had proven the chain as ONE corridor, and every corridor walked today found a gap that
 * no unit test showed. This is what launch depends on, so it is walked here, with the real binary for
 * the box, over a real relay.
 *
 *   person (fresh install, the card seeded)  ──write──▶  the box (holds the profile address)
 *                                                           │ fan to own devices
 *   person  ◀──answer, from the phone──  Frits' phone  ◀────┘
 *
 * Then the leg a box exists for: the phone is OFF when the person writes. The box takes it (it holds the
 * address as the last registration — asserted, since the relay maps an address to one socket), and the turn
 * reaches the phone when it comes back.
 *
 * The one hand-off: the shells read the card from the build's env; the walk hands the box's printed card
 * to `seedContactCard` directly. Everything else is the production path.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync, readFileSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { VaultMemory } from '@onderling/vault';
import { EventLog } from '../src/eventLog.js';
import { startJourneyRelay } from './support/testRelay.js';
import { bootRealAgentNode, connectNodesOverRelay, createCircle, bindCircleAddresses, until, teardown } from './support/pairRealAgents.js';
import { seedContactCard } from '../src/v2/seededContact.js';
import { stoopContactToRow } from '../src/v2/contactsSource.js';

const RUNNER = fileURLToPath(new URL('../bin/device-runner.mjs', import.meta.url));
const CIRCLE = 'thuis-feedback-circle';

/** The card the runner prints, decoded — how a fresh install learns where to write to the maker. */
function cardFrom(stdout) {
  const m = /onderling-contact:\/\/([A-Za-z0-9_-]+)/.exec(stdout);
  return m ? m[0] : null;
}
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
const textsIn = async (node, contactId) => ((await node.contactThreadChannel.rehydrate(contactId)) ?? []).map((t) => t.text);
/** A phone, booted on Frits' vaults, on the relay, in its circle — the same three acts at every boot. */
async function bootPhone(vaults, relayUrl) {
  const phone = await bootRealAgentNode('frits-phone', { contactChannel: true, agentOpts: { ...vaults, deviceLog: new EventLog({ initial: [], muted: [] }) } });
  await phone.agent.connectPeerTransport({ relayUrl, onPeerMessage: (env) => phone._routerRef.fn?.(env), awaitRelayReady: true });
  await bindCircleAddresses([phone], CIRCLE);
  return phone;
}

describe('the alpha feedback path — a fresh install reaches the maker, and the maker answers', () => {
  let relay; let relayUrl; let dataDir; let env; let vaults; let phone; let box; let person; let card;

  beforeAll(async () => {
    relay = await startJourneyRelay();
    relayUrl = relay.url;
    dataDir = mkdtempSync(path.join(tmpdir(), 'basis-feedback-box-'));
    env = { PATH: process.env.PATH, HOME: dataDir, ONDERLING_RELAY_URL: relayUrl, BASIS_VAULT_PASSPHRASE: 'test-only-passphrase' };
    // What the phone keeps across a reboot: its vaults and its item store (IndexedDB in the shell; a
    // file here). A reboot that forgot its rosters would not know its own box.
    vaults = { ownerRootVault: new VaultMemory(), chatVault: new VaultMemory(), stoopPersistDb: { path: path.join(dataDir, 'phone-stoop-state.json') } };

    // ── Frits' phone: his account, one circle (the sibling rail rides circles), on the relay. ──────
    phone = await bootPhone(vaults, relayUrl);
    await createCircle(phone, { groupId: CIRCLE, name: 'Thuis' });
    await bindCircleAddresses([phone], CIRCLE);

    // ── The box: enrolled phone-first (the offer, the phrase), then started for real. ─────────────
    const offer = await phone.agent.callSkill('household', 'buildEnrollOffer', { relayUrl });
    expect(offer.ok, JSON.stringify(offer)).toBe(true);
    const phrase = (await phone.agent.callSkill('household', 'revealOwnerPhrase', {}))?.mnemonic;
    const once = run(['--data-dir', dataDir, '--enrol'], { env, stdin: `${offer.uri}\n${phrase}\n` });
    expect(await once.exited, `--enrol did not exit cleanly:\n${once.out.slice(-1200)}`).toBe(0);
    box = run(['--data-dir', dataDir], { env });
    expect(await until(async () => (box.out.includes('device-runner: up') ? true : null), { timeout: 90_000, step: 250 }),
      `the box never came up:\n${box.out.slice(-1500)}`).toBe(true);
    expect(await until(async () => walkLog(dataDir).find((e) => e.kind === 'enroll-offer') ?? null, { timeout: 60_000, step: 500 }),
      'the box never consumed the offer').toBeTruthy();
    // The card the box prints is the maker's card: the same profile address every device of his shares.
    card = cardFrom(box.out);
    expect(card, `the box printed no contact card:\n${box.out.slice(-800)}`).toBeTruthy();

    // ── A person's FRESH install: nothing on it, then the card the build ships with. ──────────────
    person = await bootRealAgentNode('person', { contactChannel: true });
    await connectNodesOverRelay([person], { relayUrl });
  }, 240_000);

  afterAll(async () => {
    try { box?.child?.kill('SIGTERM'); } catch { /* */ }
    await teardown(phone, person);
    try { await relay?.close?.(); } catch { /* */ }
    try { rmSync(dataDir, { recursive: true, force: true }); } catch { /* */ }
  });

  it('the fresh install has the maker as a PERSON in Contacten, from the card alone', async () => {
    const callSkill = (app, op, args) => person.agent.callSkill(app, op, args);
    const seeded = await seedContactCard({ payload: card, callSkill });
    expect(seeded, 'the card did not seed').toEqual({ seeded: true, webid: phone.pubKey });
    const res = await callSkill('stoop', 'listContacts', {});
    const row = res.items.find((c) => c.webid === phone.pubKey);
    expect(row, 'the maker is not in the book').toBeTruthy();
    expect(stoopContactToRow(row).isBot, 'the maker must be a person, never a bot').toBe(false);
    // …and in CONTACTEN, which is what a tester sees. Both shells build the roster from `res.contacts` — the
    // book's own rows, the shape `stoopContactToRow` was written for — while the reply had carried only the
    // chat-shell `items`. So the seeded contact was in the book and on no screen (published 2026-09-18,
    // measured in a headless browser: "No contacts yet"). The reply carries both.
    const bookRow = (res.contacts ?? []).find((c) => c.webid === phone.pubKey);
    expect(bookRow, 'the roster reads `contacts`; the reply must carry the book\'s rows under that name').toBeTruthy();
    expect(stoopContactToRow(bookRow).name, 'the name testers see: the card\'s display name, else its handle, else the address').toBe(bookRow.displayName ?? bookRow.handle ?? bookRow.webid);
    expect(bookRow.trustLevel, 'the book\'s own trust wording, not the chat translation').toMatch(/^(bekend|vertrouwd)$/);
  }, 30_000);

  it('what the person writes lands on the box, is on the phone, and the phone\'s answer reaches the person', async () => {
    // The person writes to the contact — the profile address the card carries.
    await person.contactThreadChannel.sendTurn({
      peerAddr: phone.pubKey, threadId: phone.pubKey, text: 'hoi Frits, de knop doet niets', messageId: 'fb-1',
    }).sent;
    // It lands on the BOX: it registered the profile address last, so the relay's one socket for it is the box's.
    const onBox = await until(async () => walkLog(dataDir).find((e) => e.kind === 'contact-turn' && e.text === 'hoi Frits, de knop doet niets') ?? null, { timeout: 30_000, step: 500 });
    expect(onBox, `the box never recorded the feedback:\n${box.out.slice(-1200)}`).toBeTruthy();
    // …and the box hands it to the phone: the maker reads it where he reads everything. The read names
    // its branch: `contactTurnsSeen` holds only what arrived FROM one of his own devices — so a turn there
    // came by the fan, not by the relay picking the phone's socket.
    const onPhone = await until(async () => (phone.contactTurnsSeen.some((t) => t?.text === 'hoi Frits, de knop doet niets') ? true : null), { timeout: 30_000, step: 250 });
    expect(onPhone, `the phone never got the feedback from the box — refused: ${JSON.stringify(phone.contactTurnsRefused)}; thread: ${JSON.stringify(await textsIn(phone, person.pubKey))}`).toBe(true);
    expect(await textsIn(phone, person.pubKey), 'the fanned turn is in the thread on the phone').toContain('hoi Frits, de knop doet niets');
    // The maker answers from the phone — a person he has never greeted from THIS device.
    await phone.contactThreadChannel.sendTurn({
      peerAddr: person.pubKey, threadId: person.pubKey, text: 'dank je — welke knop?', messageId: 'fb-reply-1',
    }).sent;
    const answered = await until(async () => ((await textsIn(person, phone.pubKey)).includes('dank je — welke knop?') ? true : null), { timeout: 30_000, step: 250 });
    expect(answered, 'the maker\'s answer never reached the person').toBe(true);
  }, 120_000);

  it('with the phone OFF, the box still takes the feedback, and the phone has it when it comes back', async () => {
    const fritsPubKey = phone.pubKey;
    await teardown(phone);
    phone = null;

    await person.contactThreadChannel.sendTurn({
      peerAddr: fritsPubKey, threadId: fritsPubKey, text: 'nog iets: de tekst is Engels', messageId: 'fb-2',
    }).sent;
    // The box takes it — nothing else of Frits' is on the wire.
    const onBox = await until(async () => walkLog(dataDir).find((e) => e.kind === 'contact-turn' && e.text === 'nog iets: de tekst is Engels') ?? null, { timeout: 30_000, step: 500 });
    expect(onBox, `the box did not take the feedback with the phone off:\n${box.out.slice(-1200)}`).toBeTruthy();

    // The phone comes back: the same vaults, the relay, its circle — and the two kicks every shell fires on
    // connect (the grants and known-peers pulls to its siblings), which are also the box's first sign of it.
    phone = await bootPhone(vaults, relayUrl);
    await phone.agent.grantsCatchUp?.requestFromSiblings?.();
    await phone.agent.knownPeersSync?.requestFromSiblings?.();
    const caughtUp = await until(async () => (phone.contactTurnsSeen.some((t) => t?.text === 'nog iets: de tekst is Engels') ? true : null), { timeout: 45_000, step: 500 });
    expect(caughtUp, `the phone came back and never got what the box took while it was off — refused: ${JSON.stringify(phone.contactTurnsRefused)}; box:\n${box.out.slice(-800)}`).toBe(true);
  }, 180_000);
});
