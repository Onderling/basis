/**
 * CHORES ON THE REAL BOX: the box runner as a household bot (its own process, a real relay), Ann (its first person, so
 * its admin) and Bert (a member, on a code she made) in its inbox. Ann puts a chore on Klusjes; Bert claims it
 * by its words, finds it under his own chores (not Ann's), and completes it — each a typed command, as `/help` names
 * it. The chores are the task verbs over the household circle's one store, not a separate tasks agent. On a red, the
 * box's turn log says which route each line took.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync, readdirSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { startJourneyRelay } from './support/testRelay.js';
import { bootRealAgentNode, connectNodesOverRelay, until, teardown } from './support/pairRealAgents.js';
import { decodeContactCard } from '@onderling-app/stoop/lib/contactCard';
import { addBoxCard } from './support/addBoxCard.js';

// the box's walk log (each turn's route), beside its data
const walkLog = (dir) => [dir, path.join(dir, 'walks')].flatMap((d) => { try { return readdirSync(d).filter((f) => f.startsWith('walk-log-')).map((f) => path.join(d, f)); } catch { return []; } })
  .flatMap((f) => readFileSync(f, 'utf8').split('\n').filter(Boolean).map((l) => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean));
const RUNNER = fileURLToPath(new URL('../bin/device-runner.mjs', import.meta.url));

describe('chores on the real box', () => {
  let relay; let dataDir; let child; let out = ''; let ann; let bert; let card;
  const saidTo = (node) => async () => (await node.contactThreadChannel.rehydrateAll()).filter((x) => x.origin === 'bot').map((x) => x.text);
  const sendAs = (node) => (text, extra = {}) => node.contactThreadChannel.sendTurn({ peerAddr: card.peerAddr, threadId: card.peerAddr, text, ...extra }).sent;
  // what the bot answers to this line (the first reply after it)
  const ask = async (node, text, re = /./) => {
    const said = saidTo(node);
    const from = (await said()).length;
    await sendAs(node)(text);
    return until(async () => (await said()).slice(from).find((x) => re.test(x)) ?? null, { timeout: 30_000, step: 400 });
  };

  beforeAll(async () => {
    relay = await startJourneyRelay();
    dataDir = mkdtempSync(path.join(tmpdir(), 'basis-bot-chores-'));
    child = spawn(process.execPath, [RUNNER, '--data-dir', dataDir], {
      env: { PATH: process.env.PATH, HOME: dataDir, ONDERLING_RELAY_URL: relay.url, BASIS_VAULT_PASSPHRASE: 'test-only-passphrase', ONDERLING_PROFILE_KIND: 'function', ONDERLING_PRIMARY_DEVICE: '0', ONDERLING_WALK_LOG_TURNS: 'full' },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    child.stdout.on('data', (b) => { out += String(b); });
    child.stderr.on('data', (b) => { out += String(b); });
    expect(await until(async () => (out.includes('device-runner: up') ? true : null), { timeout: 90_000, step: 250 }), `the runner never came up:\n${out.slice(-1500)}`).toBe(true);
    // the card is printed after "up" (another write the pipe may deliver later); wait for it, and say so if it never comes
    const cardLine = await until(async () => /onderling-contact:\/\/([A-Za-z0-9_-]+)/.exec(out), { timeout: 15_000, step: 100 });
    expect(cardLine, `the runner came up but printed no contact card:\n${out.slice(-1500)}`).toBeTruthy();
    card = decodeContactCard(cardLine[1]);
    ann = await bootRealAgentNode('ann', { contactChannel: true });
    bert = await bootRealAgentNode('bert', { contactChannel: true });
    await connectNodesOverRelay([ann, bert], { relayUrl: relay.url });
  }, 180_000);

  afterAll(async () => {
    try { child?.kill('SIGTERM'); } catch { /* gone */ }
    await teardown(ann, bert);
    try { await relay?.close?.(); } catch { /* */ }
    try { rmSync(dataDir, { recursive: true, force: true }); } catch { /* */ }
  });

  it('Ann adds a chore; Bert claims it by its words, it is his, he completes it', async () => {
    await addBoxCard(ann, out);
    await sendAs(ann)(`/start ${/\/start ([0-9a-f]{16}-[0-9a-f]{12})/.exec(out)[1]}`);
    expect(await until(async () => ((await saidTo(ann)()).length ? true : null), { timeout: 30_000, step: 400 })).toBe(true);
    await ask(ann, '/cohort 3 7');
    const invite = await ask(ann, '/invite', /\/start \S+/);
    expect(invite, `no invite:\n${out.slice(-1200)}`).toBeTruthy();
    await addBoxCard(bert, out);
    await sendAs(bert)(`/start ${/\/start (\S+)/.exec(invite)[1]}`);
    expect(await until(async () => ((await saidTo(bert)()).length ? true : null), { timeout: 30_000, step: 400 }), `Bert not admitted:\n${out.slice(-1200)}`).toBe(true);

    const added = await ask(ann, '/add-to-list --list Klusjes --text ramen-lappen');
    expect(added, `no answer to the add:\n${out.slice(-1200)}`).toMatch(/ramen-lappen/);

    const claimed = await ask(bert, '/claim ramen-lappen');
    expect(claimed, `Bert's claim:\n${(await saidTo(bert)()).slice(-3).join('\n')}`).toMatch(/ramen-lappen/);
    expect(claimed).not.toMatch(/fout|error|niet gevonden|not found/i);

    const bertsOwn = await ask(bert, '/mytasks');
    expect(bertsOwn, 'the chore is Bert\'s').toMatch(/ramen-lappen/);
    const annsOwn = await ask(ann, '/mytasks');
    expect(annsOwn, 'and not Ann\'s').not.toMatch(/ramen-lappen/);

    const done = await ask(bert, '/complete-task ramen-lappen');
    expect(done, `Bert's complete:\n${(await saidTo(bert)()).slice(-3).join('\n')}`).not.toMatch(/fout|error|niet gevonden|not found/i);
    const after = await ask(bert, '/mytasks');
    expect(after, `done said: ${done}\n${JSON.stringify(walkLog(dataDir).slice(-8), null, 1)}`).not.toMatch(/ramen-lappen/);
  }, 180_000);
});
