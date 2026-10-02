/**
 * A PERSON CONNECTS A SCREEN TO THE BOT, FOR REAL: the box runner as a household bot (its own process), a person
 * admitted through the bot's inbox (the first, so its admin), and a screen on its own agent — over a real relay.
 *
 * The person asks for `/scherm` and gets a one-time link; the screen sends its offer (its key, the link's nonce) to
 * the bot's address; the person is asked, privately, with the code the screen shows, and says yes; the bot grants that key the person's role column, each token signed by the bot and acting as the
 * person, delivers it to the screen, and tells the person in their own chat. The same nonce a second time is not
 * granted again. Then the screen ACTS: a second screen, a full agent as a browser view is, calls the bot's ops with the tokens it was
 * granted (the kernel's own task exchange, carried on both secure channels): as the person, only the declared
 * params, refused for a key that was not granted, and refused once the person drops the screen.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync, readdirSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { startJourneyRelay } from './support/testRelay.js';
import { bootRealAgentNode, connectNodesOverRelay, until, teardown } from './support/pairRealAgents.js';
import { decodeContactCard as decodeCardBody } from '@onderling-app/stoop/lib/contactCard';
import { encodePairingOffer, acceptConnectionGrant, CONNECTION_GRANT_SUBTYPE } from '../src/v2/connectionPairing.js';
import { parseScreenLink, screenCode } from '../src/v2/botScreens.js';
import { DataPart } from '@onderling/core';
import { VaultMemory } from '@onderling/vault';
import { createSecureAgent } from '@onderling/secure-agent';
import { createScreenView, screenAddressFor } from '../src/v2/screenView.js';

const RUNNER = fileURLToPath(new URL('../bin/device-runner.mjs', import.meta.url));
const cardFrom = (stdout) => { const m = /onderling-contact:\/\/([A-Za-z0-9_-]+)/.exec(stdout); return m ? decodeCardBody(m[1]) : null; };
/** Ann answers the bot's "a screen wants to connect — code X" with yes, in her own door (the inbox is private). */
const answerYes = async (ann, peerAddr, code, said) => {
  // the question arrives (its buttons carry the codes; the inbox shows the words), then she picks the one her screen shows
  const asked = await until(async () => ((await said()).some((t) => /koppelen|connect/i.test(t)) ? true : null), { timeout: 30_000, step: 500 });
  if (!asked) return false;
  await ann.contactThreadChannel.sendTurn({ peerAddr, threadId: peerAddr, text: `/koppelen ${code}` }).sent;
  return true;
};
const botSaid = async (node) => (await node.contactThreadChannel.rehydrateAll()).filter((t) => t.origin === 'bot').map((t) => t.text);

describe('a person connects a screen to the bot over the relay', () => {
  let relay; let dataDir; let child; let out = ''; let ann; let screen;
  const walkTail = () => { try { const dir = path.join(dataDir, 'walks'); return readdirSync(dir).map((f) => readFileSync(path.join(dir, f), 'utf8')).join('').split('\n').filter((l) => /screen|unrouted/.test(l)).slice(-10).join('\n'); } catch (e) { return `(no walk log: ${e.message})`; } };

  beforeAll(async () => {
    relay = await startJourneyRelay();
    dataDir = mkdtempSync(path.join(tmpdir(), 'basis-bot-screen-'));
    child = spawn(process.execPath, [RUNNER, '--data-dir', dataDir], {
      env: {
        PATH: process.env.PATH, HOME: dataDir,
        ONDERLING_RELAY_URL: relay.url, BASIS_VAULT_PASSPHRASE: 'test-only-passphrase',
        ONDERLING_PROFILE_KIND: 'function', ONDERLING_PRIMARY_DEVICE: '0',
        BASIS_APP_URL: 'https://basis.example/app',
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    child.stdout.on('data', (b) => { out += String(b); });
    child.stderr.on('data', (b) => { out += String(b); });
    const up = await until(async () => (out.includes('device-runner: up') ? true : null), { timeout: 90_000, step: 250 });
    expect(up, `the runner never came up:\n${out.slice(-1500)}`).toBe(true);
    ann = await bootRealAgentNode('ann', { contactChannel: true });
    screen = await bootRealAgentNode('screen');
    await connectNodesOverRelay([ann, screen], { relayUrl: relay.url });
  }, 180_000);

  afterAll(async () => {
    try { child?.kill('SIGTERM'); } catch { /* gone */ }
    await teardown(ann, screen);
    try { await relay?.close?.(); } catch { /* */ }
    try { rmSync(dataDir, { recursive: true, force: true }); } catch { /* */ }
  });

  it('/scherm → a link; the screen\'s offer → the person\'s column, acting as them; the person is told; once only', async () => {
    const card = cardFrom(out);
    expect(card?.peerAddr, 'the runner printed no card').toBeTruthy();
    const send = (text, extra = {}) => ann.contactThreadChannel.sendTurn({ peerAddr: card.peerAddr, threadId: card.peerAddr, text, ...extra }).sent;
    const code = /\/start ([0-9a-f]{16}-[0-9a-f]{12})/.exec(out)?.[1];
    await send('hallo', { admission: code });
    expect(await until(async () => ((await botSaid(ann)).length >= 1 ? true : null), { timeout: 30_000, step: 500 }), `not admitted:\n${out.slice(-1200)}`).toBe(true);

    await send('/scherm');
    const linkLine = await until(async () => (await botSaid(ann)).find((t) => t.includes('#scherm=')) ?? null, { timeout: 30_000, step: 500 });
    expect(linkLine, `no /scherm link came back:\n${out.slice(-1500)}`).toBeTruthy();
    const link = parseScreenLink(/https?:\/\/\S+/.exec(linkLine)[0]);
    expect(link).toMatchObject({ ok: true, relayUrl: relay.url });
    expect(link.botAddress).toBe(card.peerAddr);

    // the screen: its own key, the link's nonce, its offer to the bot's address over the relay
    const viewPubKey = screen.pubKey;
    await screen.agent.sendPeerMessage(link.botAddress, { subtype: 'screen-offer', offer: encodePairingOffer({ viewPubKey, relayUrl: relay.url, nonce: link.nonce, label: 'laptop' }) });
    // nothing is granted until Ann says yes, privately, to the code the screen shows
    expect(await answerYes(ann, card.peerAddr, await screenCode(viewPubKey, link.nonce), () => botSaid(ann)), `no question with the code:\n${out.slice(-1500)}`).toBe(true);
    const grant = await until(async () => screen.received.find((m) => m.payload?.subtype === CONNECTION_GRANT_SUBTYPE)?.payload ?? null, { timeout: 30_000, step: 500 });
    expect(grant, `no grant reached the screen:\n${out.slice(-1500)}`).toBeTruthy();
    const accepted = acceptConnectionGrant(grant, { nonce: link.nonce, viewPubKey });
    expect(accepted.ok, JSON.stringify(accepted)).toBe(true);
    expect(accepted.issuer).toBe(link.botAddress);
    const skills = accepted.tokens.map((tk) => tk.skill);
    expect(skills).toContain('lists.addToList');
    expect(skills).toContain('assistant.assistant-overview');
    // Ann came in on the bootstrap code: she is the admin, and her screen gets the admin's lists column — but not the
    // admin's own assistant ops (people, exports), nor what a screen never gets
    expect(skills).toContain('lists.removeList');
    for (const forbidden of ['assistant.assistant-screen', 'assistant.assistant-screens', 'assistant.assistant-import', 'assistant.assistant-export', 'assistant.assistant-users', 'assistant.assistant-role', 'assistant.assistant-revoke']) expect(skills).not.toContain(forbidden);
    const actingAs = new Set(accepted.tokens.map((tk) => tk.constraints?.actingAs));
    expect(actingAs.size, 'every token acts as one person').toBe(1);
    expect([...actingAs][0]).not.toBe(link.botAddress);

    // the person is told, in their own chat
    const told = await until(async () => ((await botSaid(ann)).some((t) => /scherm gekoppeld|connected a screen/i.test(t)) ? true : null), { timeout: 30_000, step: 500 });
    expect(told, 'the person was not told a screen was connected').toBe(true);

    // the same nonce again: not granted a second time
    const before = screen.received.filter((m) => m.payload?.subtype === CONNECTION_GRANT_SUBTYPE).length;
    await screen.agent.sendPeerMessage(link.botAddress, { subtype: 'screen-offer', offer: encodePairingOffer({ viewPubKey, relayUrl: relay.url, nonce: link.nonce }) });
    await new Promise((r) => setTimeout(r, 3000));
    expect(screen.received.filter((m) => m.payload?.subtype === CONNECTION_GRANT_SUBTYPE).length).toBe(before);
  }, 150_000);

  it('the screen acts over the relay: as the person, declared params only; another key and a dropped screen are refused', async () => {
    const card = cardFrom(out);
    const send = (text) => ann.contactThreadChannel.sendTurn({ peerAddr: card.peerAddr, threadId: card.peerAddr, text }).sent;
    const seen = (await botSaid(ann)).length;
    await send('/scherm');
    const linkLine = await until(async () => (await botSaid(ann)).slice(seen).find((t) => t.includes('#scherm=')) ?? null, { timeout: 30_000, step: 500 });
    const link = parseScreenLink(/https?:\/\/\S+/.exec(linkLine)[0]);

    // a second screen, a full agent as a browser view is: its own key, its offer, the grant it receives
    const view = await bootRealAgentNode('screen2');
    const thief = await bootRealAgentNode('thief');
    await connectNodesOverRelay([view, thief], { relayUrl: relay.url });
    try {
      await view.agent.sendPeerMessage(link.botAddress, { subtype: 'screen-offer', offer: encodePairingOffer({ viewPubKey: view.pubKey, relayUrl: relay.url, nonce: link.nonce }) });
      expect(await answerYes(ann, card.peerAddr, await screenCode(view.pubKey, link.nonce), () => botSaid(ann))).toBe(true);
      const grant = await until(async () => view.received.find((m) => m.payload?.subtype === CONNECTION_GRANT_SUBTYPE)?.payload ?? null, { timeout: 30_000, step: 500 });
      expect(grant, `no grant reached the screen:\n${out.slice(-1500)}`).toBeTruthy();
      const accepted = acceptConnectionGrant(grant, { nonce: link.nonce, viewPubKey: view.pubKey });
      expect(accepted.ok).toBe(true);
      const tokenFor = (skill) => accepted.tokens.find((tk) => tk.skill === skill);

      // acting, over the wire, as the person — with args the op does not declare, which are dropped
      const call = (node, skill, args, token = tokenFor(skill)) => node.agent.sa.peer.invoke(link.botAddress, skill, [DataPart(args)], { token });
      const added = await call(view, 'lists.addToList', { list: 'Boodschappen', text: 'over-de-draad', circleId: 'pair-x', actor: 'someone-else' });
      expect(JSON.stringify(added), `the screen's add came back: ${JSON.stringify(added)}`).toContain('"ok":true');
      const read = await call(view, 'lists.listEntries', { list: 'Boodschappen' });
      expect(JSON.stringify(read)).toContain('over-de-draad');

      // another key presenting the same token: refused at the token check (its subject is the screen)
      await expect(call(thief, 'lists.addToList', { list: 'Boodschappen', text: 'gestolen' }, tokenFor('lists.addToList'))).rejects.toThrow();
      // an op the token does not name, with another op's token: refused
      await expect(call(view, 'lists.removeList', { list: 'Reparaties' }, tokenFor('lists.listEntries'))).rejects.toThrow();

      // the person drops the screen: its next call is refused
      const before = (await botSaid(ann)).length;
      await send('/schermen');
      const listed = await until(async () => (await botSaid(ann)).slice(before).find((t) => /\d\./.test(t)) ?? null, { timeout: 20_000, step: 500 });
      // this screen's row (the first test's is "laptop"; this one has the default label)
      const n = /^(\d+)\. scherm:/m.exec(listed)?.[1];
      expect(n, `this screen is not in the list:\n${listed}`).toBeTruthy();
      await send(`/schermen los ${n}`);
      await until(async () => ((await botSaid(ann)).slice(before).some((t) => /losgekoppeld|disconnected/i.test(t)) ? true : null), { timeout: 20_000, step: 500 });
      const after = await call(view, 'lists.addToList', { list: 'Boodschappen', text: 'na-los' }).then((r) => JSON.stringify(r), (e) => `refused: ${e?.message}`);
      expect(after.includes('"ok":true'), `a dropped screen still acted: ${after}`).toBe(false);
    } finally { await teardown(view, thief); }
  }, 180_000);

  it('the screen as the browser runs it: nothing sent before the tap; the code; the yes; acting; a later visit resumes', async () => {
    const card = cardFrom(out);
    const send = (text) => ann.contactThreadChannel.sendTurn({ peerAddr: card.peerAddr, threadId: card.peerAddr, text }).sent;
    const seen = (await botSaid(ann)).length;
    await send('/scherm');
    const linkLine = await until(async () => (await botSaid(ann)).slice(seen).find((t) => t.includes('#scherm=')) ?? null, { timeout: 30_000, step: 500 });
    const link = /https?:\/\/\S+/.exec(linkLine)[0];

    // one browser's key, kept across visits (the vault the browser would keep)
    const vault = new VaultMemory();
    const agents = [];
    const makeAgent = async () => { const a = await createSecureAgent({ vault, transportMode: 'relay', warnOnInsecure: false }); agents.push(a); return a; };
    const storage = new Map();
    const store = { getItem: (k) => storage.get(k) ?? null, setItem: (k, v) => storage.set(k, v) };
    try {
      const view = createScreenView({ link, makeAgent, storage: store });
      expect(view.link).toMatchObject({ ok: true, botAddress: card.peerAddr });
      expect(agents, 'opening the link makes no key and sends nothing').toHaveLength(0);
      const before = (await botSaid(ann)).length;
      const { code } = await view.connect({ label: 'browser' });
      expect(code).toMatch(/^[A-HJKMNP-Z2-9]{4}$/);
      // the person sees THE SAME code in their chat, and says yes
      expect(await answerYes(ann, card.peerAddr, code, async () => (await botSaid(ann)).slice(before))).toBe(true);
      await until(async () => (view.ops().length ? true : null), { timeout: 30_000, step: 300 });
      await view.granted();
      expect(view.ops()).toContain('lists.addToList');
      const added = await view.call('lists.addToList', { list: 'Boodschappen', text: 'vanuit-het-scherm' });
      expect(added, JSON.stringify(added)).toMatchObject({ ok: true });

      // a later visit: the same browser's key and the kept grant — acting again without pairing
      const again = createScreenView({ link: `https://basis.example/app/${screenAddressFor(card.peerAddr)}`, makeAgent, storage: store });
      expect(await again.resume()).toBe(true);
      expect(JSON.stringify(await again.call('lists.listEntries', { list: 'Boodschappen' }))).toContain('vanuit-het-scherm');
    } finally { for (const a of agents) await a.stop?.().catch(() => {}); }
  }, 180_000);
});