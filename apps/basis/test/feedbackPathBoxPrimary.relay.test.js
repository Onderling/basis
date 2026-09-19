/**
 * THE FEEDBACK PATH AS IT IS DEPLOYED — the box is the PRIMARY device and does not speak the pair roster.
 *
 * `alphaFeedbackPath.relay.test.js` proves a fresh install reaches the maker when the box is the one socket
 * for the profile address. The alpha's real shape (2026-09-18) has two more facts in it: the box registers
 * the address as PRIMARY (`ONDERLING_PRIMARY_DEVICE=1`, the deploy default), and the maker's web app is on
 * the relay beside it, as a standby — and that web app speaks the PAIR ROSTER (L105: a first message to a
 * contact forms a hidden two-person circle and later messages ride the contact's per-circle address there),
 * while the device runner never wired it. Measured on the published app the same day: a fresh install's
 * message to the seeded contact never arrived — "sealed to the device only", a HI never answered.
 *
 * What that turned out to be, once the walk sent the way the SHELL sends — to the Contacten row's address,
 * not to an address the test knew: the row named the sharing device's KEY (`pubKey`, an enrolled box's
 * delegation key, which is no address anywhere) instead of the address the card names (`peerAddr`, the
 * person's). A key nobody holds on any relay: the HI went nowhere. `stoopContactToRow` fixed; this walk
 * reads the row the way `showContactThread` does, so the row's address is part of the claim.
 *
 * The claims: (1) the fresh install's FIRST message, sent to the roster row's address, lands on the box —
 * the primary — whatever the pair roster does beside it; (2) the maker's web device has it; (3) a SECOND
 * message, sent after the pair roster had every chance to form, lands too.
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
const CIRCLE = 'thuis-primary-box';

const cardFrom = (out) => /onderling-contact:\/\/([A-Za-z0-9_-]+)/.exec(out)?.[0] ?? null;
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

describe('the feedback path with the box as PRIMARY device and the web app beside it', () => {
  let relay; let dataDir; let box; let web; let visitor; let card;

  beforeAll(async () => {
    relay = await startJourneyRelay();
    dataDir = mkdtempSync(path.join(tmpdir(), 'basis-box-primary-'));
    // The maker's WEB device: his account, one circle, the pair roster wired (the shell's shape).
    const vaults = { ownerRootVault: new VaultMemory(), chatVault: new VaultMemory(), stoopPersistDb: { path: path.join(dataDir, 'web-stoop-state.json') } };
    web = await bootRealAgentNode('maker-web', { contactChannel: true, pairRoster: true, agentOpts: { ...vaults, deviceLog: new EventLog({ initial: [], muted: [] }) } });
    await web.agent.connectPeerTransport({ relayUrl: relay.url, onPeerMessage: (env) => web._routerRef.fn?.(env), awaitRelayReady: true });
    await createCircle(web, { groupId: CIRCLE, name: 'Thuis' });
    await bindCircleAddresses([web], CIRCLE);
    // The box: enrolled from the web device's offer, then started AS THE PRIMARY DEVICE (the deploy default).
    const env = { PATH: process.env.PATH, HOME: dataDir, ONDERLING_RELAY_URL: relay.url, BASIS_VAULT_PASSPHRASE: 'test-only-passphrase', ONDERLING_PRIMARY_DEVICE: '1' };
    const offer = await web.agent.callSkill('household', 'buildEnrollOffer', { relayUrl: relay.url });
    expect(offer.ok, JSON.stringify(offer)).toBe(true);
    const phrase = (await web.agent.callSkill('household', 'revealOwnerPhrase', {}))?.mnemonic;
    const once = run(['--data-dir', dataDir, '--enrol'], { env, stdin: `${offer.uri}\n${phrase}\n` });
    expect(await once.exited, `--enrol did not exit cleanly:\n${once.out.slice(-1200)}`).toBe(0);
    box = run(['--data-dir', dataDir], { env });
    expect(await until(async () => (box.out.includes('device-runner: up') ? true : null), { timeout: 90_000, step: 250 }), `the box never came up:\n${box.out.slice(-1500)}`).toBe(true);
    expect(await until(async () => walkLog(dataDir).find((e) => e.kind === 'enroll-offer') ?? null, { timeout: 60_000, step: 500 }), 'the box never consumed the offer').toBeTruthy();
    expect(await until(async () => (box.out.includes('primary contact address') ? true : null), { timeout: 30_000, step: 250 }), 'the box never claimed the primary address').toBe(true);
    card = cardFrom(box.out);
    expect(card).toBeTruthy();
    // A FRESH install, with the seeded card and the pair roster — exactly the published web app.
    visitor = await bootRealAgentNode('visitor', { contactChannel: true, pairRoster: true });
    await connectNodesOverRelay([visitor], { relayUrl: relay.url });
    const seeded = await seedContactCard({ payload: card, callSkill: (a, o, x) => visitor.agent.callSkill(a, o, x) });
    expect(seeded.seeded).toBe(true);
  }, 240_000);

  afterAll(async () => {
    try { box?.child?.kill('SIGTERM'); } catch { /* */ }
    await teardown(web, visitor);
    try { await relay?.close?.(); } catch { /* */ }
    try { rmSync(dataDir, { recursive: true, force: true }); } catch { /* */ }
  });

  /** The address the SHELL writes to: the Contacten row's, as `showContactThread` resolves it — not a value the test knows. */
  const rowAddress = async () => {
    const res = await visitor.agent.callSkill('stoop', 'listContacts', {});
    const book = (res?.contacts ?? []).find((c) => c.webid === web.pubKey);
    expect(book, 'the seeded contact is in the book').toBeTruthy();
    return stoopContactToRow(book).peerAddr;
  };

  it('the first message lands on the box (the primary) and the web device has it', async () => {
    const to = await rowAddress();
    expect(to, 'the roster row names the address the card names — the person\'s, not the sharing device\'s key').toBe(web.pubKey);
    await visitor.contactThreadChannel.sendTurn({ peerAddr: to, threadId: web.pubKey, text: 'hoi Wilfred, eerste bericht', messageId: 'fb-first' }).sent;
    const onBox = await until(async () => walkLog(dataDir).find((e) => e.kind === 'contact-turn' && e.text === 'hoi Wilfred, eerste bericht') ?? null, { timeout: 30_000, step: 500 });
    expect(onBox, `the box never recorded the first message:\n${box.out.slice(-1500)}`).toBeTruthy();
    const onWeb = await until(async () => ((await textsIn(web, visitor.pubKey)).includes('hoi Wilfred, eerste bericht') ? true : null), { timeout: 30_000, step: 500 });
    expect(onWeb, `the web device never got it — refused: ${JSON.stringify(web.contactTurnsRefused)}`).toBe(true);
    // …and can SEE it: the sender is a row in the web device's Contacten. A carried turn from a stranger used to be
    // stored under a sender the roster had no row for — the maker's laptop, 2026-09-18: "delivered", nothing on screen.
    expect([...web.notedPeers], 'the visitor is a row on the web device — the carried turn noted its sender').toContain(visitor.pubKey);
  }, 90_000);

  it('a second message, after the pair roster had every chance to form, lands too', async () => {
    // Give the pair roster its moment: whatever it made (or failed to make) between the visitor and the
    // maker's web device now stands. The next message must still arrive — on the primary, the box.
    await new Promise((r) => { setTimeout(r, 6000); });
    await visitor.contactThreadChannel.sendTurn({ peerAddr: await rowAddress(), threadId: web.pubKey, text: 'en het tweede bericht', messageId: 'fb-second' }).sent;
    const onBox = await until(async () => walkLog(dataDir).find((e) => e.kind === 'contact-turn' && e.text === 'en het tweede bericht') ?? null, { timeout: 30_000, step: 500 });
    expect(onBox, `the second message never reached the box — the pair route swallowed it:\n${box.out.slice(-1500)}`).toBeTruthy();
    const onWeb = await until(async () => ((await textsIn(web, visitor.pubKey)).includes('en het tweede bericht') ? true : null), { timeout: 30_000, step: 500 });
    expect(onWeb, 'the web device never got the second message').toBe(true);
  }, 90_000);
});
