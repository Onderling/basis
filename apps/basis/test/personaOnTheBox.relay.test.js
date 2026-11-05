/**
 * THE BOX HOLDS A PERSONA (Frits 2026-11-03: "the box should simply be a standard agent with always-on capacities").
 * The phone founds circle Y as persona W ("Werk"); the box enrols from the phone's offer holding W only (`--persona Werk
 * --no-general`, the shells' picker on a command line). On its first start it rejoins Y AS W — never as the general
 * persona, which it does not hold.
 *
 * Spawned for real: the actual binary, twice (enrol, then start), over a real relay; the phone a real agent.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync, readFileSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { VaultMemory } from '@onderling/vault';
import { createMemoryBackend } from '@onderling/pseudo-pod';
import { startJourneyRelay } from './support/testRelay.js';
import { bootRealAgentNode, connectNodesOverRelay, bindCircleAddresses, until, teardown } from './support/pairRealAgents.js';
import { EventLog } from '../src/eventLog.js';
import { initialState as createInitial, finalSubmit as createSubmit } from '../src/core/wizards/createGroupState.js';

const RUNNER = fileURLToPath(new URL('../bin/device-runner.mjs', import.meta.url));
const Y = 'werk-box-circle';

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

describe('the box enrolled with a persona keeps that persona\'s circle as it', () => {
  let relay; let dataDir; let phone; let box; let env; let w;

  beforeAll(async () => {
    relay = await startJourneyRelay();
    dataDir = mkdtempSync(path.join(tmpdir(), 'basis-box-persona-'));
    env = { PATH: process.env.PATH, HOME: dataDir, ONDERLING_RELAY_URL: relay.url, BASIS_VAULT_PASSPHRASE: 'test-only-passphrase' };
    phone = await bootRealAgentNode('phone', { agentOpts: { ownerRootVault: new VaultMemory(), chatVault: new VaultMemory(), registryBackend: createMemoryBackend(), deviceLog: new EventLog({ initial: [], muted: [] }) } });
    await connectNodesOverRelay([phone], { relayUrl: relay.url });
    // the phone founds Y AS persona W — the create wizard's own path
    w = (await phone.agent.callSkill('agents', 'createProfile', { name: 'Werk' })).id;
    expect((await phone.agent.callSkill('household', 'bindCirclePersona', { circleId: Y, personaId: w, relayUrl: relay.url })).ok).toBe(true);
    const st = createInitial();
    st.groupId = Y; st.name = 'Werk'; st.purpose = 't'; st.persona = w;
    expect((await createSubmit({ state: st, callSkill: (a, o, x) => phone.agent.callSkill(a, o, x) })).result).toBeTruthy();
    await bindCircleAddresses([phone], Y);
  }, 180_000);

  afterAll(async () => {
    try { box?.child?.kill('SIGTERM'); } catch { /* */ }
    await teardown(phone);
    try { await relay?.close?.(); } catch { /* */ }
    try { rmSync(dataDir, { recursive: true, force: true }); } catch { /* */ }
  });

  it('--enrol --persona Werk --no-general: the box holds W only', async () => {
    const offer = await phone.agent.callSkill('household', 'buildEnrollOffer', { relayUrl: relay.url });
    expect(offer.ok, JSON.stringify(offer)).toBe(true);
    const phrase = (await phone.agent.callSkill('household', 'revealOwnerPhrase', {}))?.mnemonic;
    const once = run(['--data-dir', dataDir, '--enrol', '--persona', 'Werk', '--no-general'], { env, stdin: `${offer.uri}\n${phrase}\n` });
    expect(await once.exited, `--enrol did not exit cleanly:\n${once.out.slice(-1500)}`).toBe(0);
    expect(once.out, once.out.slice(-800)).toMatch(/this box holds Werk/);
  }, 120_000);

  it('on its first start it rejoins Y AS W', async () => {
    box = run(['--data-dir', dataDir], { env });
    expect(await until(async () => (box.out.includes('device-runner: up') ? true : null), { timeout: 90_000, step: 250 }),
      `the runner never came up:\n${box.out.slice(-1500)}`).toBe(true);
    const consumed = await until(async () => walkLog(dataDir).find((e) => e.kind === 'enroll-offer') ?? null, { timeout: 60_000, step: 500 });
    expect(consumed, `the box never consumed the offer:\n${box.out.slice(-1500)}`).toBeTruthy();
    const y = (consumed.circles ?? []).find((c) => c.id === Y);
    expect(y?.ok, `the box did not rejoin Y: ${JSON.stringify(consumed)}`).toBe(true);
    // the consume's 'persona' step: Y bound to the persona its entry names (consumeCircleEntry binds it only then, and
    // refuses a general-persona circle on a box that does not hold the general persona)
    expect(y.steps, `Y was not rejoined as W: ${JSON.stringify(y)}`).toContain('persona');
  }, 150_000);

  // The SHARED path every shell takes (an exit naming this device's own self, folded) — not the household bot's own
  // removal verdict, which has its own test (stillInCircle.test.js): a membership change landing in a persona's circle
  // on the box leaves the box in it, and the circle's next line still lands there.
  it('a membership change in Y lands on the box and the box keeps Y: the phone\'s next line lands there', async () => {
    const said = await phone.agent.emitMemberProps?.({ circleIds: [Y], props: { handle: 'werk-nieuw' } });
    expect(said, 'the phone said nothing on Y\'s membership lane').toBeTruthy();
    await new Promise((r) => setTimeout(r, 3000));   // the statement reaches the box and is folded there
    // the production send (append + fan + the carry to the person's own devices — the box is one of them)
    const sent = await phone.agent.chatEmit(Y, { msgId: 'werk-1', ts: Date.now(), text: 'staat de box er nog?' });
    expect(sent, 'the phone could not write in Y').toBeTruthy();
    const landed = await until(async () => walkLog(dataDir).find((e) => e.kind === 'chat-landed' && e.circleId === Y && e.msgId === 'werk-1') ?? null, { timeout: 30_000, step: 500 });
    expect(landed, `the box no longer holds Y after a membership change — walk-log kinds: ${JSON.stringify(Object.entries(walkLog(dataDir).reduce((a, e) => { a[e.kind] = (a[e.kind] ?? 0) + 1; return a; }, {})))}`).toBeTruthy();
  }, 90_000);
});
