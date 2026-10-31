/**
 * WHAT A KEY THE COMPANION HAS NEVER SEEN CAN MAKE IT DO, with a correctly signed envelope over the real relay.
 *
 * The companion's layer admits any signed sender: there is no roster to authorize against (it is in no circle).
 * Its protection is per SKILL — a capability token for every data skill (the gate, on in every deployed node),
 * the owner's signature or a sealed payload for the rest. This asks EVERY skill the companion registers, from a
 * fresh unknown key, and requires each one to refuse: rejected before the handler for want of a token, or
 * answered with `ok: false`. A new skill that answers a stranger with data turns this red.
 *
 * With the gate OFF (an embedding's trusted-LAN mode, never the deployed entrypoint) a stranger lists and writes the
 * pod — so the layer's warning stays loud there, and the deployed entrypoint must never turn the gate off.
 */
import { describe, it, expect, afterAll } from 'vitest';
import { readFileSync } from 'node:fs';
import { Agent, AgentIdentity, Bootstrap } from '@onderling/core';
import { VaultMemory } from '@onderling/vault';
import { RelayTransport } from '@onderling/transports';
import { startCompanionNode } from '../../src/index.js';
import { MemorySealedInboxStore } from '../../src/sealedInbox.js';
import { makeDevBlobBucket } from '../../src/mediaEdge.js';
import { ownerDevice } from '../support/ownerDevice.js';

const cleanups = [];
afterAll(async () => { for (const c of cleanups.reverse()) { try { await c(); } catch { /* best-effort */ } } });

async function stranger(host) {
  const id = await AgentIdentity.generate(new VaultMemory());
  const agent = new Agent({ identity: id, transport: new RelayTransport({ relayUrl: host.relayUrl, identity: id }), label: 'stranger' });
  await agent.start();
  await agent.hello(host.agent.address);
  cleanups.push(() => agent.stop?.());
  return agent;
}

async function probe(name, opts) {
  const host = await startCompanionNode({ identityVault: new VaultMemory(), ...opts });
  cleanups.push(() => host.stop());
  const s = await stranger(host);
  const ids = host.agent.skills.all().map((d) => d.id).sort();
  if (!ids.length) throw new Error('probe: no skills enumerated — the probe, not the companion');
  const rows = [];
  for (const op of ids) {
    let out;
    try {
      const r = await Promise.race([s.invoke(host.agent.address, op, {}), new Promise((_, no) => setTimeout(() => no(new Error('probe-timeout')), 8000))]);
      const parts = Array.isArray(r) ? r : r?.parts; const data = parts?.[0]?.data ?? r;
      const refused = data && typeof data === 'object' && (data.ok === false || typeof data.error === 'string');
      out = `${refused ? 'REFUSED-IN-HANDLER' : 'ANSWERED'} ${JSON.stringify(data).slice(0, 110)}`;
    } catch (e) {
      out = `REJECTED ${String(e?.message ?? e).slice(0, 90)}`;
    }
    rows.push({ op, out });
  }
  return { host, rows };
}
const refusedAll = (rows) => rows.filter(({ out }) => !(/^REJECTED Skill "[^"]+" requires a capability token/.test(out) || out.startsWith('REFUSED-IN-HANDLER')));

describe('an unknown key, a correctly signed envelope, every companion skill', () => {
  it('the deployed default: every skill refuses the stranger, and the layer says it is skill-gated', async () => {
    const { host, rows } = await probe('default', {});
    expect(rows.length).toBeGreaterThan(10);
    expect(refusedAll(rows), 'skills that answered a stranger').toEqual([]);
    expect(host.agent.security.hasSenderAuthorizer, 'the layer names its posture instead of warning').toBe(true);
  }, 120_000);

  it('with management, inbox and feeds on: every skill refuses the stranger too', async () => {
    const owner = Bootstrap.create().bootstrap;
    const { rows } = await probe('management+inbox+feeds', {
      management: true, claimedOwner: { root: ownerDevice(owner, 'phone').delegation.by }, inbox: true,
      inboxOwnerPubKey: (await AgentIdentity.generate(new VaultMemory())).pubKey, inboxStore: new MemorySealedInboxStore(),
      feeds: true, feedBucket: makeDevBlobBucket(),
    });
    expect(rows.length).toBeGreaterThan(25);
    expect(refusedAll(rows), 'skills that answered a stranger').toEqual([]);
  }, 120_000);

  it('with the gate OFF a stranger reads and writes — so that layer keeps its loud warning (no authorizer)', async () => {
    const { host, rows } = await probe('gate-off', { gate: false });
    expect(refusedAll(rows).map((r) => r.op)).toEqual(expect.arrayContaining(['listFiles', 'saveToMyPod']));
    expect(host.agent.security.hasSenderAuthorizer).toBe(false);
  }, 120_000);

  it('the deployed entrypoint never turns the gate off', () => {
    const boot = readFileSync(new URL('../../src/boot.js', import.meta.url), 'utf8');
    const call = boot.slice(boot.indexOf('startCompanionNode({'), boot.indexOf('});', boot.indexOf('startCompanionNode({')));
    expect(call).not.toMatch(/\bgate\b/);
  });
});
