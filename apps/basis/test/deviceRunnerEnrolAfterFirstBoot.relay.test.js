/**
 * THE BOX BOOTS BEFORE ANYONE CAN ENROL IT — and the enrolment must leave nothing of that first boot behind.
 *
 * On a box the service starts the moment the role is built: the runner comes up UNENROLLED, as a throwaway
 * profile of its own (its own keys, its own person key, its own registry record), before the operator has had
 * a chance to run `--enrol`. Then `--enrol` runs in the SAME data dir. `deviceRunnerEnrol.relay.test.js`
 * proves the ceremony into a fresh dir; this walk proves it into a used one, because that is the sequence a
 * real box follows (seen on the first personal box, 2026-09-18: the enrolled device kept greeting its own
 * former self in every circle — "member=<old webid> reached via pubkey", three failed deliveries per boot —
 * and one sealed settings marker from the first boot could no longer be opened).
 *
 * The claims: after the ordinary start that follows the ceremony, (1) nothing of the throwaway identity is a
 * member or an address in any circle, on the box or on the phone; (2) the box never tries to reach it;
 * (3) nothing at rest is left sealed to a key this device no longer has; (4) the phone lists the box as one of
 * the person's devices — the row My data paints and the revoke door acts on.
 *
 * Spawned for real: the actual binary, three times, over a real relay, the phone a real agent.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync, readFileSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { VaultMemory } from '@onderling/vault';
import { deviceDelegationsOf } from '@onderling/agent-registry';
import { startJourneyRelay } from './support/testRelay.js';
import { bootRealAgentNode, connectNodesOverRelay, createCircle, bindCircleAddresses, sendCircleChat, until, teardown } from './support/pairRealAgents.js';

const RUNNER = fileURLToPath(new URL('../bin/device-runner.mjs', import.meta.url));
const CIRCLE = 'thuis-box-used-dir';

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

/** The contact card the runner prints at boot — the throwaway identity, read back so the walk can look for it. */
function cardFrom(out) {
  const m = out.match(/onderling-contact:\/\/([A-Za-z0-9_-]+)/);
  if (!m) return null;
  try { return JSON.parse(Buffer.from(m[1], 'base64').toString('utf8')); } catch { return null; }
}

const stop = async (proc) => {
  if (!proc?.child) return;
  try { proc.child.kill('SIGTERM'); } catch { /* */ }
  await Promise.race([proc.exited, new Promise((r) => { setTimeout(r, 5000); })]);
  try { proc.child.kill('SIGKILL'); } catch { /* */ }
};

describe('the box that booted unenrolled first enrols into the same data dir, cleanly', () => {
  let relay; let dataDir; let phone; let first; let box; let env; let throwaway; let enrolledWebid = null;

  beforeAll(async () => {
    relay = await startJourneyRelay();
    dataDir = mkdtempSync(path.join(tmpdir(), 'basis-box-used-dir-'));
    env = { PATH: process.env.PATH, HOME: dataDir, ONDERLING_RELAY_URL: relay.url, BASIS_VAULT_PASSPHRASE: 'test-only-passphrase' };
    phone = await bootRealAgentNode('phone', { agentOpts: { ownerRootVault: new VaultMemory(), chatVault: new VaultMemory() } });
    await connectNodesOverRelay([phone], { relayUrl: relay.url });
    await createCircle(phone, { groupId: CIRCLE, name: 'Thuis' });
    await bindCircleAddresses([phone], CIRCLE);
    await sendCircleChat(phone, { groupId: CIRCLE, msgId: 'before-the-box-1', text: 'de doos komt eraan' });
  }, 120_000);

  afterAll(async () => {
    await stop(box);
    await stop(first);
    await teardown(phone);
    try { await relay?.close?.(); } catch { /* */ }
    try { rmSync(dataDir, { recursive: true, force: true }); } catch { /* */ }
  });

  it('boots unenrolled first — the way a box does — as a throwaway profile of its own', async () => {
    first = run(['--data-dir', dataDir], { env });
    const up = await until(async () => (first.out.includes('device-runner: up') ? true : null), { timeout: 90_000, step: 250 });
    expect(up, `the runner never came up:\n${first.out.slice(-1500)}`).toBe(true);
    // Let it settle the way a real box does: it registers on the relay and claims the primary address of the
    // profile it made up for itself.
    await until(async () => (first.out.includes('primary contact address') ? true : null), { timeout: 30_000, step: 250 });
    throwaway = cardFrom(first.out);
    expect(throwaway?.webid, `no contact card in the first boot's output:\n${first.out.slice(-800)}`).toBeTruthy();
    await stop(first);
  }, 150_000);

  it('enrols into that used data dir with the phone\'s offer and the phrase', async () => {
    const offer = await phone.agent.callSkill('household', 'buildEnrollOffer', { relayUrl: relay.url });
    expect(offer.ok, JSON.stringify(offer)).toBe(true);
    const phrase = (await phone.agent.callSkill('household', 'revealOwnerPhrase', {}))?.mnemonic;
    expect(phrase?.split(/\s+/).length).toBe(24);
    const once = run(['--data-dir', dataDir, '--enrol'], { env, stdin: `${offer.uri}\n${phrase}\n` });
    const code = await once.exited;
    expect(code, `--enrol did not exit cleanly:\n${once.out.slice(-1500)}`).toBe(0);
    expect(once.out).toMatch(/enrolled/i);
  }, 120_000);

  it('on the next start nothing of the throwaway identity is left — not in a roster, not on the wire, not at rest', async () => {
    box = run(['--data-dir', dataDir], { env });
    const up = await until(async () => (box.out.includes('device-runner: up') ? true : null), { timeout: 90_000, step: 250 });
    expect(up, `the runner never came up:\n${box.out.slice(-1500)}`).toBe(true);
    const consumed = await until(async () => walkLog(dataDir).find((e) => e.kind === 'enroll-offer') ?? null, { timeout: 60_000, step: 500 });
    expect(consumed, `the box never consumed the offer:\n${box.out.slice(-1500)}`).toBeTruthy();
    expect(consumed.circles?.[0]?.steps, 'the box announced itself').toContain('announce');
    // It is a different device now.
    const enrolled = cardFrom(box.out.slice(box.out.indexOf('device-runner: up')));
    expect(enrolled?.webid).toBeTruthy();
    expect(enrolled.webid).not.toBe(throwaway.webid);
    enrolledWebid = enrolled.webid;

    // (1) The throwaway identity is nobody: not a member, not an address — as the phone folds the circle…
    const phoneView = await phone.agent.callSkill('stoop', 'listGroupMembers', { groupId: CIRCLE });
    const phoneRows = (phoneView?.members ?? []).map((m) => ({ webid: m.webid, set: m.circleAddresses ?? [] }));
    expect(phoneRows.map((r) => r.webid), 'the throwaway profile is not a member on the phone').not.toContain(throwaway.webid);
    expect(phoneRows.flatMap((r) => r.set), 'no address of the throwaway profile in any set on the phone').not.toContain(throwaway.peerAddr);
    // …and as the box folds it (its walk log carries the rosters as this device holds them).
    const presence = await until(async () => walkLog(dataDir).filter((e) => e.kind === 'presence').pop() ?? null, { timeout: 30_000, step: 500 });
    const boxRows = Object.values(presence?.rosters ?? {}).flat().filter(Boolean);
    expect(boxRows.map((r) => r.who), 'the throwaway profile is not a member on the box').not.toContain(throwaway.webid.slice(0, 8));

    // (2) The box never tries to reach its former self. Give the fan a moment to do whatever it will do.
    await new Promise((r) => { setTimeout(r, 8000); });
    const ghostLines = box.out.split('\n').filter((l) =>
      l.includes(throwaway.webid.slice(0, 12)) || l.includes(throwaway.pubKey.slice(0, 12)) || (throwaway.personKey?.pubKey && l.includes(throwaway.personKey.pubKey.slice(0, 12))));
    expect(ghostLines, `the box still speaks to or about its throwaway self:\n${ghostLines.join('\n')}`).toEqual([]);
    expect(box.out, 'no "unreachable — holding message" for anyone: the only other device is the phone, and it is online').not.toMatch(/unreachable — holding message/);

    // (3) Nothing at rest is sealed to a key this device no longer has.
    expect(box.out, 'a file from the first boot could not be opened after the ceremony').not.toMatch(/\[at-rest\].*not openable/);

    // (4) The phone lists the box as one of the person's devices — the row My data paints.
    const listed = await until(async () => {
      const props = await phone.agent.callSkill('agents', 'getProfileProperties', { id: 'default' }).catch(() => null);
      const devices = Object.values(deviceDelegationsOf({ properties: props?.properties ?? {} }));
      const others = devices.filter((d) => !String(d.deviceId).startsWith('first-') && d.revoked !== true);
      return others.length ? others : null;
    }, { timeout: 30_000, step: 500 });
    expect(listed, `the phone never learned the box as a device of the person's:\n${box.out.slice(-1200)}`).toBeTruthy();

    // And the claim the fresh-dir walk makes still holds: what was said before the box existed is on it.
    const pulled = await until(async () => walkLog(dataDir).find((e) => e.kind === 'chat-change' && e.circleId === CIRCLE) ?? null, { timeout: 30_000, step: 500 });
    expect(pulled, `the circle's conversation never reached the box:\n${box.out.slice(-800)}`).toBeTruthy();
  }, 240_000);

  it('and the start after that is quiet: the same device, nothing to warn about, nobody to chase', async () => {
    await stop(box);
    box = run(['--data-dir', dataDir], { env });
    const up = await until(async () => (box.out.includes('device-runner: up') ? true : null), { timeout: 90_000, step: 250 });
    expect(up, `the runner never came up again:\n${box.out.slice(-1500)}`).toBe(true);
    await new Promise((r) => { setTimeout(r, 6000); });
    const again = cardFrom(box.out);
    expect(again?.webid, 'the same enrolled device across restarts').toBe(enrolledWebid);
    expect(box.out).not.toMatch(/\[at-rest\].*not openable/);
    // A greeting in flight holds a message for a moment ("unreachable — holding") and that is the normal
    // shape of a fresh process meeting a peer; a delivery FAILURE is not — the only other device is the
    // phone, and it is online.
    expect(box.out).not.toMatch(/delivery failure|written off/);
    expect(box.out.split('\n').filter((l) => l.includes(throwaway.webid.slice(0, 12)) || l.includes(throwaway.pubKey.slice(0, 12)))).toEqual([]);
  }, 150_000);
});
