/**
 * Stoop V1 — Phase 15 tests.
 *
 * Cross-device transport groundwork: factory accepts `persistPath`
 * and wires `FilePersist` so state survives Node restarts.  Real
 * `RelayTransport` is documented usage (the factory already accepts
 * `transport`); cross-process integration test is a separate
 * deliverable (real relay fixture).
 */

import { describe, it, expect } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { AgentIdentity, InternalBus, InternalTransport, DataPart } from '@onderling/core';
import { VaultMemory } from '@onderling/vault';

import { createNeighbourhoodAgent } from '../src/index.js';

const ANNE = 'https://id.example/anne';

async function callSkill(agent, skillId, args, fromWebid = ANNE) {
  const def = agent.skills.get(skillId);
  if (!def) throw new Error(`callSkill: no such skill: ${skillId}`);
  return def.handler({
    parts:    args === undefined ? [] : [DataPart(args)],
    from:     fromWebid,
    agent,
    envelope: null,
  });
}

async function makeTmpDir() {
  const dir = await mkdtemp(join(tmpdir(), 'stoop-phase15-'));
  return { dir, cleanup: () => rm(dir, { recursive: true, force: true }) };
}

describe('Stoop V1 Phase 15 — persistPath wires FilePersist into the factory', () => {
  it('bundle.persist is set when persistPath supplied; null otherwise', async () => {
    const { dir, cleanup } = await makeTmpDir();
    try {
      const id = await AgentIdentity.generate(new VaultMemory());
      const tx = new InternalTransport(new InternalBus(), id.pubKey);
      const bundle = await createNeighbourhoodAgent({
        identity: id, transport: tx,
        offeringMatch: { group: 'oosterpoort', localActor: ANNE, peers: [] },
        members:    [{ webid: ANNE }],
        persistPath: dir,
      });
      expect(bundle.persist).toBeTruthy();
      expect(bundle.cache).toBeTruthy();
    } finally { await cleanup(); }
  });

  it('null bundle.persist when persistPath omitted', async () => {
    const id = await AgentIdentity.generate(new VaultMemory());
    const tx = new InternalTransport(new InternalBus(), id.pubKey);
    const bundle = await createNeighbourhoodAgent({
      identity: id, transport: tx,
      offeringMatch: { group: 'oosterpoort', localActor: ANNE, peers: [] },
      members:    [{ webid: ANNE }],
    });
    expect(bundle.persist).toBeNull();
  });

  it('state survives a "restart": post → close → re-create with same persistPath → post visible', async () => {
    const { dir, cleanup } = await makeTmpDir();
    try {
      // Session 1.
      const id1 = await AgentIdentity.generate(new VaultMemory());
      const tx1 = new InternalTransport(new InternalBus(), id1.pubKey);
      const b1 = await createNeighbourhoodAgent({
        identity: id1, transport: tx1,
        offeringMatch: { group: 'g', localActor: ANNE, peers: [] },
        members:    [{ webid: ANNE }],
        persistPath: dir,
      });
      await b1.offeringMatch.start();
      await callSkill(b1.agent, 'postRequest',
        { text: 'paint the fence', kind: 'ask', expectClaims: 0, timeoutMs: 1 });

      // Allow the debounced FilePersist save to fire.
      await new Promise(r => setTimeout(r, 250));

      // Session 2 — new agent, same persistPath.
      const id2 = await AgentIdentity.generate(new VaultMemory());
      const tx2 = new InternalTransport(new InternalBus(), id2.pubKey);
      const b2 = await createNeighbourhoodAgent({
        identity: id2, transport: tx2,
        offeringMatch: { group: 'g', localActor: ANNE, peers: [] },
        members:    [{ webid: ANNE }],
        persistPath: dir,
      });
      await b2.offeringMatch.start();

      const list = await callSkill(b2.agent, 'listOpen', { kind: 'ask' });
      expect(list.items.some(i => i.text === 'paint the fence')).toBe(true);
    } finally { await cleanup(); }
  });
});
