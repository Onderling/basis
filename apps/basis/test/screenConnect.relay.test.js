/**
 * A PERSON CONNECTS A SCREEN TO THE BOT, FOR REAL: the box runner as a household bot (its own process), a person
 * admitted through the bot's inbox (the first, so its admin), and a screen on its own agent — over a real relay.
 *
 * The person asks for `/scherm` and gets a one-time link; the screen sends its offer (its key, the link's nonce) to
 * the bot's address; the bot grants that key the person's role column, each token signed by the bot and acting as the
 * person, delivers it to the screen, and tells the person in their own chat. The same nonce a second time is not
 * granted again.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { startJourneyRelay } from './support/testRelay.js';
import { bootRealAgentNode, connectNodesOverRelay, until, teardown } from './support/pairRealAgents.js';
import { decodeContactCard as decodeCardBody } from '@onderling-app/stoop/lib/contactCard';
import { encodePairingOffer, acceptConnectionGrant, CONNECTION_GRANT_SUBTYPE } from '../src/v2/connectionPairing.js';
import { parseScreenLink } from '../src/v2/botScreens.js';

const RUNNER = fileURLToPath(new URL('../bin/device-runner.mjs', import.meta.url));
const cardFrom = (stdout) => { const m = /onderling-contact:\/\/([A-Za-z0-9_-]+)/.exec(stdout); return m ? decodeCardBody(m[1]) : null; };
const botSaid = async (node) => (await node.contactThreadChannel.rehydrateAll()).filter((t) => t.origin === 'bot').map((t) => t.text);

describe('a person connects a screen to the bot over the relay', () => {
  let relay; let dataDir; let child; let out = ''; let ann; let screen;

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
});
