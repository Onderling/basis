/**
 * THE ALWAYS-ON DEVICE, AS A PROCESS — spawned for real, over a real relay.
 *
 * Everything below the runner is covered elsewhere: the lane table has its own tests, the contact
 * channel has its own, the fan is walked between two enrolled devices. What none of them touch is the
 * composition itself — whether `bin/device-runner.mjs` boots, joins the relay, registers the handlers
 * and stores what arrives. That is exactly the shape this repo keeps being bitten by: every part green,
 * the assembly never exercised, and the failure invisible because a device that receives nothing looks
 * identical to a quiet network.
 *
 * So this starts the actual binary, writes to it from a real agent over a real relay, and reads its
 * answer out of the two places an operator would: the contact card it prints, and the walk log it keeps.
 * Slow by nature — a real boot — and worth it for the one thing only it can prove.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync, readdirSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { startJourneyRelay } from './support/testRelay.js';
import { bootRealAgentNode, connectNodesOverRelay, until, teardown } from './support/pairRealAgents.js';

const RUNNER = fileURLToPath(new URL('../bin/device-runner.mjs', import.meta.url));

/** The card the runner prints, decoded — how anyone learns where to write to this device. */
function cardFrom(stdout) {
  const m = /onderling-contact:\/\/([A-Za-z0-9_-]+)/.exec(stdout);
  if (!m) return null;
  const b64 = m[1] + '='.repeat((4 - (m[1].length % 4)) % 4);
  try { return JSON.parse(Buffer.from(b64, 'base64url').toString('utf8')); } catch { return null; }
}

/** Everything the runner has written to its walk log so far, one object per line. */
function walkLog(dataDir) {
  const files = readdirSync(dataDir).filter((f) => f.startsWith('walk-log-'));
  return files.flatMap((f) => readFileSync(path.join(dataDir, f), 'utf8')
    .split('\n').filter(Boolean)
    .map((l) => { try { return JSON.parse(l); } catch { return null; } })
    .filter(Boolean));
}

describe('the always-on device runs, joins the relay, and keeps what arrives', () => {
  let relay; let dataDir; let child; let out = ''; let sender;

  beforeAll(async () => {
    relay = await startJourneyRelay();
    dataDir = mkdtempSync(path.join(tmpdir(), 'basis-device-'));
    child = spawn(process.execPath, [RUNNER, '--data-dir', dataDir], {
      // No Telegram token and no LLM key: this is the device half, and it must stand up without either.
      // The whole environment is replaced rather than extended, so a token on the developer's machine
      // cannot quietly change what this test is testing.
      env: {
        PATH: process.env.PATH, HOME: dataDir,
        ONDERLING_RELAY_URL: relay.url,
        BASIS_VAULT_PASSPHRASE: 'test-only-passphrase',
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    child.stdout.on('data', (b) => { out += String(b); });
    child.stderr.on('data', (b) => { out += String(b); });

    const up = await until(async () => (out.includes('device-runner: up') ? true : null), { timeout: 90_000, step: 250 });
    expect(up, `the runner never came up. Output so far:\n${out.slice(-1500)}`).toBe(true);

    sender = await bootRealAgentNode('sender', { contactChannel: true });
    await connectNodesOverRelay([sender], { relayUrl: relay.url });
  }, 180_000);

  afterAll(async () => {
    try { child?.kill('SIGTERM'); } catch { /* it may already be gone */ }
    await teardown(sender);
    try { await relay?.close?.(); } catch { /* */ }
    try { rmSync(dataDir, { recursive: true, force: true }); } catch { /* */ }
  });

  it('prints a contact card that says where to reach it', () => {
    const card = cardFrom(out);
    expect(card, 'the runner printed no contact card').toBeTruthy();
    expect(card.webid, 'the card names nobody').toBeTruthy();
    // The part that matters and that was missing until 2026-09-09: a card from a device with no mesh
    // transport carried no address at all, so it named someone the scanner could not write to.
    expect(card.peerAddr, 'the card carries no address — nobody could answer it').toBeTruthy();
  });

  it('says on stdout what an operator needs: the wire it is on', () => {
    expect(out).toMatch(/wire\s+ws:\/\//);
    expect(out, 'a run with no Telegram token must say so rather than look broken').toMatch(/telegram\s+off/);
  });

  it('keeps a direct message written to it while nobody is watching', async () => {
    const card = cardFrom(out);
    await sender.contactThreadChannel.sendTurn({
      peerAddr: card.peerAddr, threadId: card.peerAddr, text: 'is er nog brood?', messageId: 'to-device-1',
    }).sent;

    const landed = await until(
      async () => walkLog(dataDir).find((e) => e.kind === 'contact-turn' && e.text === 'is er nog brood?') ?? null,
      { timeout: 30_000, step: 500 },
    );
    expect(landed, `the device never recorded the message. Its output:\n${out.slice(-1200)}`).toBeTruthy();
    expect(landed.from, 'the device did not record who wrote').toBeTruthy();
  }, 60_000);

  it('is a full agent, not a listener — every signed lane is actually carried', () => {
    const lanes = walkLog(dataDir).find((e) => e.kind === 'lanes');
    expect(lanes, 'the runner never reported which lanes it carries').toBeTruthy();
    // A rail this device does not have is a lane it silently never receives on, which is
    // indistinguishable from a quiet network — so each is named rather than counted.
    for (const lane of ['gov', 'membership', 'key', 'task', 'chat']) {
      expect(lanes[lane], `no ${lane} rail — this device would never converge on that lane`).toBe(true);
    }
    // `podChat` is expected to be dark here: it needs pod wiring this composition does not have yet,
    // and the runner says so on stderr rather than leaving it to be discovered.
    expect(lanes.podChat).toBe(false);
    const run = walkLog(dataDir).find((e) => e.kind === 'run');
    expect(run?.shell).toBe('device');
    expect(run?.relay, 'the run header does not name the wire it joined').toBeTruthy();
  });

  it('asks every lane for what it missed while it was off', async () => {
    // The kicks are deliberately staggered over the first few seconds, so this waits for them rather
    // than assuming they have already run — the difference between a slow kick and no kick at all is
    // the whole point of checking.
    const kicks = await until(
      async () => {
        const lanes = walkLog(dataDir).filter((e) => e.kind === 'catch-up-kick').map((e) => e.lane);
        return lanes.length >= 5 ? lanes : null;
      },
      { timeout: 20_000, step: 500 },
    );
    expect(kicks, 'the device never asked any lane for what it missed').toBeTruthy();
    for (const lane of ['governance', 'membership', 'grants', 'tasks', 'chat']) {
      expect(kicks, `nothing pulled the ${lane} lane on reconnect`).toContain(lane);
    }
  }, 30_000);
});
