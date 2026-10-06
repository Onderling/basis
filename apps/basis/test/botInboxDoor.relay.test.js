/**
 * THE BOT'S INBOX DOOR, FOR REAL — the box runner on a FUNCTION profile, over a real relay, written to by a real agent.
 *
 * `botInboxDoor.test.js` holds the rules; this proves the composition: the actual `bin/device-runner.mjs` (no
 * Telegram token — its inbox is its only door) names its profile a function's, lands a contact's message in its inbox,
 * answers a contact that is not admitted exactly once, and admits them when their message carries the code it printed
 * — replying over the wire to the address they wrote from.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync, existsSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { startJourneyRelay } from './support/testRelay.js';
import { bootRealAgentNode, connectNodesOverRelay, until, teardown } from './support/pairRealAgents.js';
import { decodeContactCard as decodeCardBody } from '@onderling-app/stoop/lib/contactCard';

const RUNNER = fileURLToPath(new URL('../bin/device-runner.mjs', import.meta.url));
const cardFrom = (stdout) => { const m = /onderling-contact:\/\/([A-Za-z0-9_-]+)/.exec(stdout); return m ? decodeCardBody(m[1]) : null; };
const botSaid = async (node) => (await node.contactThreadChannel.rehydrateAll()).filter((t) => t.origin === 'bot').map((t) => t.text);

describe('the bot answers its inbox on a function profile', () => {
  let relay; let dataDir; let child; let out = ''; let sender;

  beforeAll(async () => {
    relay = await startJourneyRelay();
    dataDir = mkdtempSync(path.join(tmpdir(), 'basis-bot-inbox-'));
    child = spawn(process.execPath, [RUNNER, '--data-dir', dataDir], {
      // The whole environment replaced: no Telegram token, no model key — the inbox is the only door.
      env: {
        PATH: process.env.PATH, HOME: dataDir,
        ONDERLING_RELAY_URL: relay.url, BASIS_VAULT_PASSPHRASE: 'test-only-passphrase',
        ONDERLING_PROFILE_KIND: 'function', ONDERLING_PRIMARY_DEVICE: '0',
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    child.stdout.on('data', (b) => { out += String(b); });
    child.stderr.on('data', (b) => { out += String(b); });
    const up = await until(async () => (out.includes('device-runner: up') ? true : null), { timeout: 90_000, step: 250 });
    expect(up, `the runner never came up:\n${out.slice(-1500)}`).toBe(true);
    sender = await bootRealAgentNode('ann', { contactChannel: true });
    await connectNodesOverRelay([sender], { relayUrl: relay.url });
  }, 180_000);

  afterAll(async () => {
    try { child?.kill('SIGTERM'); } catch { /* gone */ }
    await teardown(sender);
    try { await relay?.close?.(); } catch { /* */ }
    try { rmSync(dataDir, { recursive: true, force: true }); } catch { /* */ }
  });

  it('prints its one bootstrap code (no admin yet)', () => {
    expect(out).toMatch(/no admin yet — send it, within a day: {2}\/start [0-9a-f]{16}-[0-9a-f]{12}/);
  });

  it('a contact without a code is told once; with the code, admitted and answered', async () => {
    const card = cardFrom(out);
    expect(card?.peerAddr, 'the runner printed no card to write to').toBeTruthy();
    const send = (text, extra = {}) => sender.contactThreadChannel.sendTurn({ peerAddr: card.peerAddr, threadId: card.peerAddr, text, ...extra }).sent;

    await send('hallo');
    const told = await until(async () => ((await botSaid(sender)).some((t) => /code/i.test(t)) ? true : null), { timeout: 30_000, step: 500 });
    expect(told, `no "you need a code" came back. Runner:\n${out.slice(-1200)}`).toBe(true);
    await send('hallo?');
    await new Promise((r) => setTimeout(r, 3000));
    expect((await botSaid(sender)).filter((t) => /code/i.test(t)), 'told once, not twice').toHaveLength(1);

    const code = /\/start ([0-9a-f]{16}-[0-9a-f]{12})/.exec(out)?.[1];
    expect(code).toBeTruthy();
    await send('daar ben ik', { admission: code });
    const welcomed = await until(async () => ((await botSaid(sender)).length >= 2 ? true : null), { timeout: 30_000, step: 500 });
    expect(welcomed, `no welcome after the code. Runner:\n${out.slice(-1200)}`).toBe(true);
  }, 120_000);

  it('/overzicht aan writes the person\'s planned Sunday overview into the box\'s own-devices store — sealed', async () => {
    const card = cardFrom(out);
    const before = (await botSaid(sender)).length;
    await sender.contactThreadChannel.sendTurn({ peerAddr: card.peerAddr, threadId: card.peerAddr, text: '/overzicht aan' }).sent;
    const answered = await until(async () => ((await botSaid(sender)).length > before ? true : null), { timeout: 30_000, step: 500 });
    expect(answered, `no answer to /overzicht. Runner:\n${out.slice(-1200)}`).toBe(true);
    const file = path.join(dataDir, 'own-devices.json');
    const written = await until(async () => (existsSync(file) && readFileSync(file).length > 0 ? true : null), { timeout: 15_000, step: 250 });
    expect(written, 'the planned row never reached the own-devices file').toBe(true);
    expect(readFileSync(file).toString('latin1'), 'the row is sealed on disk').not.toContain('sendWeekOverview');
  }, 90_000);
});
