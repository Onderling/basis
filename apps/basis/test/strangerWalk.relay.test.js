/**
 * THE STRANGER WALK — what a key nobody knows reaches over the wire. Before the Feedback contact is offered in the app
 * (anyone can then reach the box), every task request a stranger can make must be REFUSED with a reason; a call that
 * is never answered is a red, not a pass, where the node takes calls at all.
 *
 *   - the household-bot box takes other agents' calls (its peer route is on): every skill it says it takes, an op it does
 *     not take, and the kernel's own 'reachable-peers' are each refused, by name — a token op for want of a token, the
 *     linked-companion call by its device-statement gate, anything else as an unknown skill;
 *   - a FORGED token is refused as a token (condition: the token is judged first, never the caller's tier);
 *   - a person's device takes no calls from other agents: that is read from the agent itself (its route is off), and the
 *     stranger's call there gets no answer frame within the wait.
 * The walk prints what the stranger reached.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync, readdirSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DataPart } from '@onderling/core';
import { startJourneyRelay } from './support/testRelay.js';
import { bootRealAgentNode, connectNodesOverRelay, until, teardown } from './support/pairRealAgents.js';
import { decodeContactCard as decodeCardBody } from '@onderling-app/pinboard/lib/contactCard';

const RUNNER = fileURLToPath(new URL('../bin/device-runner.mjs', import.meta.url));
const cardFrom = (stdout) => { const m = /onderling-contact:\/\/([A-Za-z0-9_-]+)/.exec(stdout); return m ? decodeCardBody(m[1]) : null; };
const walkLog = (dir) => readdirSync(dir).filter((f) => f.startsWith('walk-log-')).flatMap((f) => readFileSync(path.join(dir, f), 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l)));
const WAIT = 20_000;

/** One call, its outcome named: 'answered' (with what), 'refused' (with the reason), or 'no-answer'. */
async function attempt(node, addr, skillId, opts = {}, args = {}) {
  const timeout = new Promise((r) => { setTimeout(() => r({ outcome: 'no-answer' }), WAIT); });
  const call = node.agent.peer.invoke(addr, skillId, [DataPart(args)], opts)
    .then((parts) => {
      // a skill that refuses in its answer (`{ ok: false, error }`) has refused, with that reason
      const data = (parts ?? []).find((p) => p?.data && typeof p.data === 'object')?.data ?? null;
      if (data && data.ok === false) return { outcome: 'refused', reason: String(data.error ?? 'refused'), inAnswer: true };
      return { outcome: 'answered', parts: JSON.stringify(parts ?? null).slice(0, 200) };
    })
    .catch((e) => {
      const reason = String(e?.message ?? e);
      return /Timeout waiting for reply/i.test(reason) ? { outcome: 'no-answer', reason } : { outcome: 'refused', reason };
    });
  return Promise.race([call, timeout]);
}

describe('a stranger on the wire', () => {
  let relay; let dataDir; let child; let out = ''; let stranger; let person;

  beforeAll(async () => {
    relay = await startJourneyRelay();
    dataDir = mkdtempSync(path.join(tmpdir(), 'basis-stranger-'));
    child = spawn(process.execPath, [RUNNER, '--data-dir', dataDir], {
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
    stranger = await bootRealAgentNode('stranger');
    person = await bootRealAgentNode('person');
    await connectNodesOverRelay([stranger, person], { relayUrl: relay.url });
  }, 180_000);

  afterAll(async () => {
    try { child?.kill('SIGTERM'); } catch { /* gone */ }
    await teardown(stranger, person);
    try { await relay?.close?.(); } catch { /* */ }
    try { rmSync(dataDir, { recursive: true, force: true }); } catch { /* */ }
  });

  it('the bot box refuses every call a stranger makes, each with its reason', async () => {
    const card = cardFrom(out);
    expect(card?.peerAddr, 'the runner printed no card').toBeTruthy();
    const said = walkLog(dataDir).find((e) => e.kind === 'peer-callable');
    expect(said?.accepts, `the box did not say its peer route is on: ${JSON.stringify(said)}`).toBe(true);
    const ids = [...(said.skills ?? []), 'reachable-peers', 'pinboard.listOpenRequests', 'no-such-op'];
    const reached = {};
    // the linked-companion call is public on purpose: a card with a statement nobody signed must meet its statement gate
    const argsFor = (id) => (id === 'identity-link.companion' ? { card: 'onderling-contact://AAAA', auth: { statement: 'forged' } } : {});
    for (const id of ids) reached[id] = await attempt(stranger, card.peerAddr, id, {}, argsFor(id));
    console.info(`[stranger walk] what a stranger reached on the bot box: ${JSON.stringify(reached, null, 1)}`);
    for (const [id, r] of Object.entries(reached)) {
      expect(r.outcome, `${id}: ${JSON.stringify(r)}`).toBe('refused');
    }
    for (const id of said.skills ?? []) {
      if (id === 'identity-link.companion') expect(reached[id].reason, id).toBe('forbidden');
      // a call without a token is judged on the tier: a stranger is 'public', so a token op refuses it there or for want of a token
      else expect(reached[id].reason, id).toMatch(/requires tier "authenticated" but caller has "public"|requires a capability token/);
    }
    expect(reached['no-such-op'].reason).toMatch(/Unknown skill/);
  }, 240_000);

  it('a forged token is refused as a token, never on the tier', async () => {
    const card = cardFrom(out);
    const said = walkLog(dataDir).find((e) => e.kind === 'peer-callable');
    const tokenOp = (said?.skills ?? []).find((id) => id !== 'identity-link.companion');
    if (!tokenOp) {
      console.info('[stranger walk] the bot box takes no token op: the forged-token case runs in the core engine test');
      return;
    }
    const forged = { id: 'forged', issuer: stranger.pubKey, subject: stranger.pubKey, agentId: card.peerAddr, skill: tokenOp, expiresAt: Date.now() + 60_000, sig: 'AAAA' };
    const r = await attempt(stranger, card.peerAddr, tokenOp, { token: forged });
    expect(r.outcome, JSON.stringify(r)).toBe('refused');
    expect(r.reason).toMatch(/[Tt]oken/);
    expect(r.reason).not.toMatch(/requires tier|Unknown skill/);
  }, 120_000);

  it("a person's device takes no calls from other agents: read from the agent, and no answer comes", async () => {
    expect(person.agent.peer.acceptsSkillCalls, "the person's agent says its peer route is on").toBe(false);
    expect(person.agent.peer.callableSkills()).toEqual([]);
    const r = await attempt(stranger, person.pubKey, 'reachable-peers');
    console.info(`[stranger walk] a stranger's call to a person's device: ${JSON.stringify(r)}`);
    expect(r.outcome, JSON.stringify(r)).toBe('no-answer');
  }, 120_000);
});
