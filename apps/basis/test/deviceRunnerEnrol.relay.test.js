/**
 * THE BOX JOINS AS YOUR SECOND DEVICE — phone first, then the box enrols, and the circle reaches it.
 *
 * The box-first direction exists (`--show-offer`: the box hands the phone an offer). This is the other
 * one, which is how the alpha's always-on device will actually be set up: the phone already has the
 * circles; it shows an add-a-device offer; the operator runs the box ONCE with `--enrol`, pastes the
 * offer, types the recovery phrase — which is used for the ceremony and never written anywhere — and
 * then starts the box as usual. On that start the box consumes the offer the way both shells do after a
 * scanned one: registry record, presence on the relay at its per-circle address, the roster seed from
 * the phone, the announce, every lane's catch-up.
 *
 * The claim at the end is the one that matters: what was said in the circle before the box existed IS
 * on the box after its first start, pulled from the phone through the consume's content pull. Nothing
 * else here would prove the box is a member rather than a listener — and until this walk the runner
 * registered no per-circle address at all, so nothing addressed to it in a circle could reach it.
 *
 * What this walk does NOT claim, on purpose: that the box sees a circle's LIVE traffic. The circle fan
 * delivers to ONE address per member (the first proven one — here the phone's) and never to the sender's
 * own other devices, so the box follows a circle by catch-up, not live. That is a design question for
 * Frits (ledger), not a defect of the runner.
 *
 * Spawned for real: the actual binary, twice, over a real relay, the phone a real agent.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync, readFileSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { VaultMemory } from '@onderling/vault';
import { startJourneyRelay } from './support/testRelay.js';
import { bootRealAgentNode, connectNodesOverRelay, createCircle, bindCircleAddresses, sendCircleChat, until, teardown } from './support/pairRealAgents.js';

const RUNNER = fileURLToPath(new URL('../bin/device-runner.mjs', import.meta.url));
const CIRCLE = 'thuis-box-circle';

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

describe('the box enrols from the phone\'s offer and the circle reaches it', () => {
  let relay; let dataDir; let phone; let box; let env;

  beforeAll(async () => {
    relay = await startJourneyRelay();
    dataDir = mkdtempSync(path.join(tmpdir(), 'basis-box-enrol-'));
    env = { PATH: process.env.PATH, HOME: dataDir, ONDERLING_RELAY_URL: relay.url, BASIS_VAULT_PASSPHRASE: 'test-only-passphrase' };
    phone = await bootRealAgentNode('phone', { agentOpts: { ownerRootVault: new VaultMemory(), chatVault: new VaultMemory() } });
    await connectNodesOverRelay([phone], { relayUrl: relay.url });
    await createCircle(phone, { groupId: CIRCLE, name: 'Thuis' });
    await bindCircleAddresses([phone], CIRCLE);
    // Said before the box existed — what the box must have after its first start.
    await sendCircleChat(phone, { groupId: CIRCLE, msgId: 'before-the-box-1', text: 'de doos komt eraan' });
  }, 120_000);

  afterAll(async () => {
    try { box?.child?.kill('SIGTERM'); } catch { /* */ }
    await teardown(phone);
    try { await relay?.close?.(); } catch { /* */ }
    try { rmSync(dataDir, { recursive: true, force: true }); } catch { /* */ }
  });

  it('enrols once — the offer pasted, the phrase typed — and says to start the runner', async () => {
    const offer = await phone.agent.callSkill('household', 'buildEnrollOffer', { relayUrl: relay.url });
    expect(offer.ok, JSON.stringify(offer)).toBe(true);
    const phrase = (await phone.agent.callSkill('household', 'revealOwnerPhrase', {}))?.mnemonic;
    expect(phrase?.split(/\s+/).length).toBe(24);
    const once = run(['--data-dir', dataDir, '--enrol'], { env, stdin: `${offer.uri}\n${phrase}\n` });
    const code = await once.exited;
    expect(code, `--enrol did not exit cleanly:\n${once.out.slice(-1500)}`).toBe(0);
    expect(once.out).toMatch(/enrolled/i);
    // The phrase is used and forgotten: nothing in the data dir holds it.
    for (const f of readdirSync(dataDir)) {
      expect(readFileSync(path.join(dataDir, f), 'utf8'), `${f} must not contain the phrase`).not.toContain(phrase.split(' ').slice(0, 3).join(' '));
    }
  }, 120_000);

  it('on its next start it is a member: the phone learns its address, and the conversation is on it', async () => {
    box = run(['--data-dir', dataDir], { env });
    const up = await until(async () => (box.out.includes('device-runner: up') ? true : null), { timeout: 90_000, step: 250 });
    expect(up, `the runner never came up:\n${box.out.slice(-1500)}`).toBe(true);
    // The consume ran, from the stash, on this start.
    const consumed = await until(async () => walkLog(dataDir).find((e) => e.kind === 'enroll-offer') ?? null, { timeout: 60_000, step: 500 });
    expect(consumed, `the box never consumed the offer:\n${box.out.slice(-1500)}`).toBeTruthy();
    expect(consumed.circles?.[0]?.steps, 'the box announced itself').toContain('announce');
    // The phone's own row grows into the set holding the box — the box is now a sibling it can reach.
    // (A device never records its OWN address on the shared row, so before the announce the set is
    // empty; one address on it that is not the phone's own is the box.)
    const own = phone.agent.circleAddressFor(CIRCLE);
    const grown = await until(async () => {
      const r = await phone.agent.callSkill('stoop', 'listGroupMembers', { groupId: CIRCLE });
      const mine = (r?.members ?? []).find((m) => m.webid === phone.pubKey);
      const others = (mine?.circleAddresses ?? []).filter((a) => a !== own);
      return others.length ? others : null;
    }, { timeout: 30_000, step: 250 });
    expect(grown, `the phone never learned the box's per-circle address — consume: ${JSON.stringify(consumed)}; runner:\n${box.out.slice(-1200)}`).toBeTruthy();
    // THE claim: the circle's conversation from before the box existed is on the box — the consume's
    // content pull brought it from the phone, addressed to the box's per-circle address, which only
    // works when the box registered that address on the relay.
    expect(consumed.circles?.[0]?.steps, 'the box pulled the content lanes').toContain('content');
    const pulled = await until(async () => walkLog(dataDir).find((e) => e.kind === 'chat-change' && e.circleId === CIRCLE) ?? null, { timeout: 30_000, step: 500 });
    expect(pulled, `the circle's conversation never reached the box — refused: ${JSON.stringify(walkLog(dataDir).filter((e) => e.kind === 'chat-refused'))}; log kinds: ${JSON.stringify(walkLog(dataDir).map((e) => e.kind))}\n${box.out.slice(-800)}`).toBeTruthy();
  }, 180_000);
});
