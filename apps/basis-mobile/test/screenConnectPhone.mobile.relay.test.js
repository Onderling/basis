/**
 * A SCREEN CONNECTED FROM THE PHONE (the function matrix's connected-screens × mobile cell). The box runs as a household
 * bot (its own process, `device-runner.mjs`); the person's PHONE (test/support/mobileNode.js: the phone's own bundle and
 * wiring) adds the bot's card and is admitted; a screen (its own agent, as a browser view is) shows its throwaway
 * pairing offer; the person pastes that offer into the bot thread ON THE PHONE (`/koppel-scherm <offer>`), the bot asks
 * privately, in the phone's own thread, which of three codes the screen shows, and the phone answers with the screen's
 * code (`/koppelen <code>`). Only then does the screen receive its grant, and it acts as the person over the relay.
 * What this cannot show (the phone session keeps it): the camera scan of the screen's code, the real screens.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DataPart } from '@onderling/core';
import { startJourneyRelay } from '../../basis/test/support/testRelay.js';
import { bootRealAgentNode, connectNodesOverRelay, until, teardown } from '../../basis/test/support/pairRealAgents.js';
import { encodePairingOffer, acceptConnectionGrant, CONNECTION_GRANT_SUBTYPE } from '../../basis/src/v2/connectionPairing.js';
import { screenCode } from '../../basis/src/v2/screenDoor.js';
import { bootMobileNode } from './support/mobileNode.js';
import { parseScreenStartLink } from '../../basis/src/v2/botScreens.js';

const RUNNER = fileURLToPath(new URL('../../basis/bin/device-runner.mjs', import.meta.url));
const cardText = (stdout) => /onderling-contact:\/\/[A-Za-z0-9_-]+/.exec(stdout)?.[0] ?? null;

describe('a screen connected from the phone, over the relay', () => {
  let relay; let dataDir; let child; let out = ''; let phone; let screen;

  beforeAll(async () => {
    relay = await startJourneyRelay();
    dataDir = mkdtempSync(path.join(tmpdir(), 'basis-phone-screen-'));
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
    phone = await bootMobileNode({ name: 'ann', relayUrl: relay.url });
    screen = await bootRealAgentNode('screen');
    await connectNodesOverRelay([screen], { relayUrl: relay.url });
  }, 180_000);

  afterAll(async () => {
    try { child?.kill('SIGTERM'); } catch { /* gone */ }
    try { await phone?.dispose?.(); } catch { /* */ }
    await teardown(screen);
    try { await relay?.close?.(); } catch { /* */ }
    try { rmSync(dataDir, { recursive: true, force: true }); } catch { /* */ }
  });

  it("the phone pastes the screen's offer, picks its code in its own bot thread, and the screen acts as the person", async () => {
    // the phone adds the bot (its card, as Me → Scan reads it) and is admitted with the bootstrap code
    const card = cardText(out);
    expect(card, 'the runner printed no card').toBeTruthy();
    const added = await phone.agent.callSkill('pinboard', 'addContactFromQr', { payload: card });
    expect(added?.error ?? null, JSON.stringify(added)).toBe(null);
    const botAddr = (added?.contact?.peerAddr ?? added?.peerAddr ?? added?.contact?.address ?? null)
      ?? (await phone.agent.callSkill('pinboard', 'listContacts', {}))?.contacts?.find((c) => c?.peerAddr)?.peerAddr;
    expect(botAddr, `no bot address after adding the card: ${JSON.stringify(added).slice(0, 300)}`).toBeTruthy();
    const thread = phone.bundle.contactChannel;
    const send = (text) => thread.sendTurn({ peerAddr: botAddr, threadId: botAddr, text }).sent;
    const botSaid = async () => (await thread.rehydrate(botAddr)).filter((t) => t.origin === 'bot').map((t) => t.text);
    const code = /\/start ([0-9a-f]{16}-[0-9a-f]{12})/.exec(out)?.[1];
    await send(`/start ${code}`);
    expect(await until(async () => ((await botSaid()).length >= 1 ? true : null), { timeout: 30_000, step: 500 }), `not admitted:\n${out.slice(-1200)}`).toBe(true);

    // `/scherm` (the first person admitted is the admin: the paste route) sends the start address with its one-use
    // ticket, which the screen reads and hands back in its offer (L1113: a pasted offer pairs only with one)
    const before = (await botSaid()).length;
    await send('/scherm');
    const startLine = await until(async () => (await botSaid()).slice(before).find((t) => /#scherm-nieuw=/.test(t)) ?? null, { timeout: 30_000, step: 500 });
    expect(startLine, `no start address in the phone's thread: ${JSON.stringify((await botSaid()).slice(-3))}`).toBeTruthy();
    const { ticket } = parseScreenStartLink(/https?:\/\/\S+/.exec(startLine)[0]);
    expect(ticket, 'the start address carries a ticket').toBeTruthy();
    // the screen shows its own throwaway offer (its key, a fresh nonce, the ticket): nothing is sent by the screen
    const nonce = `n-${Date.now()}`;
    const offer = encodePairingOffer({ viewPubKey: screen.pubKey, relayUrl: relay.url, nonce, label: 'keuken', ticket });
    const seen = (await botSaid()).length;
    await send(`/koppel-scherm ${offer}`);
    // the bot asks, privately in the phone's own thread, which of three codes the screen shows; nothing granted yet
    const asked = await until(async () => ((await botSaid()).slice(seen).some((t) => /koppelen|connect/i.test(t)) ? true : null), { timeout: 30_000, step: 500 });
    expect(asked, `no question in the phone's thread:\n${JSON.stringify((await botSaid()).slice(-3))}`).toBe(true);
    expect(screen.received.some((m) => m.payload?.subtype === CONNECTION_GRANT_SUBTYPE), 'nothing granted before the pick').toBe(false);
    // the phone answers with the code its screen shows
    await send(`/koppelen ${await screenCode(screen.pubKey, nonce)}`);
    const grant = await until(async () => screen.received.find((m) => m.payload?.subtype === CONNECTION_GRANT_SUBTYPE)?.payload ?? null, { timeout: 30_000, step: 500 });
    expect(grant, `no grant reached the screen; the bot last said: ${JSON.stringify((await botSaid()).slice(-3))}\n${out.slice(-1200)}`).toBeTruthy();
    const accepted = acceptConnectionGrant(grant, { nonce, viewPubKey: screen.pubKey });
    expect(accepted.ok, JSON.stringify(accepted)).toBe(true);
    expect(accepted.issuer).toBe(botAddr);

    // the screen acts, over the relay, as the person
    const token = accepted.tokens.find((tk) => tk.skill === 'lists.addToList');
    expect(token, 'the grant names the lists add').toBeTruthy();
    const r = await screen.agent.sa.peer.invoke(botAddr, 'lists.addToList', [DataPart({ list: 'Boodschappen', text: 'vanaf-de-telefoon-gekoppeld' })], { token });
    expect(JSON.stringify(r), `the screen's add came back: ${JSON.stringify(r)}`).toContain('"ok":true');
    // the person is told in their own thread
    expect(await until(async () => ((await botSaid()).some((t) => /scherm gekoppeld|connected a screen/i.test(t)) ? true : null), { timeout: 30_000, step: 500 }), 'the phone was not told').toBe(true);
  }, 180_000);
});
