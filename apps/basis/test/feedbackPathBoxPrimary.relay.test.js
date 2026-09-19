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
import { pairCircleIdFor } from '../src/v2/pairRoster.js';

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

  it('a second message, after the pair roster had every chance to form, lands too — and rides the pair roster the BOX speaks', async () => {
    // The pair roster (L105) forms on the first exchange: the box — the maker's device that took the first
    // message — founds it or joins it, as both shells do. Since 2026-09-19 the box speaks it; before, the second
    // message rode a route to a per-circle address the box had never registered, and the fallback carried it.
    const pairId = pairCircleIdFor(visitor.pubKey, web.pubKey);
    const formed = await until(async () => {
      const res = await visitor.agent.callSkill('stoop', 'listContacts', {});
      const row = (res?.contacts ?? []).find((c) => c.webid === web.pubKey);
      return row?.pairCircleId === pairId ? row : null;
    }, { timeout: 25_000, step: 500 });
    expect(formed, `the pair roster never formed on the visitor's side — the box did not answer the request or join:\n${box.out.slice(-1500)}`).toBeTruthy();
    const route = await visitor.pairRoster.routeFor(web.pubKey);
    expect(route?.circleId, 'the visitor\'s next message has a route over the pair roster').toBe(pairId);
    expect(route?.to, 'the route names the maker\'s per-circle address there — a real address, not the profile').toBeTruthy();
    expect(route.to).not.toBe(web.pubKey);
    await visitor.contactThreadChannel.sendTurn({ peerAddr: await rowAddress(), threadId: web.pubKey, text: 'en het tweede bericht', messageId: 'fb-second' }).sent;
    const onBox = await until(async () => walkLog(dataDir).find((e) => e.kind === 'contact-turn' && e.text === 'en het tweede bericht') ?? null, { timeout: 30_000, step: 500 });
    expect(onBox, `the second message never reached the box — the pair route swallowed it:\n${box.out.slice(-1500)}`).toBeTruthy();
    const onWeb = await until(async () => ((await textsIn(web, visitor.pubKey)).includes('en het tweede bericht') ? true : null), { timeout: 30_000, step: 500 });
    expect(onWeb, 'the web device never got the second message').toBe(true);
  }, 90_000);

  /** The book row for the visitor as a device holds it — `undefined` when the book does not know them. */
  const bookRow = async (node) => ((await node.agent.callSkill('stoop', 'listContacts', {}))?.contacts ?? []).find((c) => (c.webid ?? c.pubKey) === visitor.pubKey);
  // The box has no callSkill from here: what it holds is what its walk log says landed (`contact-hidden`, a sibling's
  // mark) and what its channel did (`contact-returned`, the visitor's turn unhid the row).
  const boxLogged = (kind, pred = () => true) => walkLog(dataDir).find((e) => e.kind === kind && pred(e)) ?? null;

  it('the maker hides the visitor on the web → the box\'s row is hidden too → the visitor writes → both show them again (L106, on every device)', async () => {
    // The maker hides the visitor from the WEB device (the tester who wrote is a peer-graph row there; hiding
    // puts them in the book, hidden). The mark is carried live to the box — not at the next catch-up.
    const hid = await web.agent.callSkill('stoop', 'setContactHidden', { webid: visitor.pubKey, hidden: true });
    expect(hid?.contact?.hidden, JSON.stringify(hid)).toBe(true);
    expect((await bookRow(web))?.hidden).toBe(true);
    const onBoxHidden = await until(async () => boxLogged('contact-hidden', (e) => e.hidden === true), { timeout: 30_000, step: 500 });
    expect(onBoxHidden, `the box never learned the visitor is hidden — the mark did not carry:\n${box.out.slice(-1500)}`).toBeTruthy();
    // The visitor writes again. The turn lands on the box (the primary) — its row unhides there — and is carried
    // to the web device, whose row unhides too, with the moment recorded for the marker.
    await visitor.contactThreadChannel.sendTurn({ peerAddr: await rowAddress(), threadId: web.pubKey, text: 'ben ik er nog?', messageId: 'fb-third' }).sent;
    const onBoxReturned = await until(async () => boxLogged('contact-returned'), { timeout: 30_000, step: 500 });
    expect(onBoxReturned, `the box never unhid the visitor when they wrote:\n${box.out.slice(-1500)}`).toBeTruthy();
    const onWeb = await until(async () => ((await textsIn(web, visitor.pubKey)).includes('ben ik er nog?') ? true : null), { timeout: 30_000, step: 500 });
    expect(onWeb, 'the web device never got the third message').toBe(true);
    expect(await until(async () => ((await bookRow(web))?.hidden === false ? true : null), { timeout: 15_000, step: 500 }), 'the web device\'s row is shown again').toBe(true);
    // The web device knows WHICH turn brought them back — the mark rides the turn, so the thread paints its marker
    // above that bubble whether the row there was unhidden by the turn or, moments earlier, by the carried mark.
    const turns = await web.contactThreadChannel.rehydrate(visitor.pubKey);
    expect(turns.find((t) => t.text === 'ben ik er nog?')?.returned, 'the returning turn is marked on the web device').toBe(true);
    expect(turns.filter((t) => t.returned === true).length, 'only that turn').toBe(1);
    expect(web.returned, 'and the web device was told, so the roster repaints').toContain(visitor.pubKey);
  }, 120_000);
});
