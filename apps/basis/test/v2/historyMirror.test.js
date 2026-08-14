/**
 * The mirror sink's headless journey (the personal history store, first slice): device-log
 * entries flow into a REAL sealed pod DataSource (the same seal-to-self mechanism settings
 * pod-sync uses) — and the backend's raw bytes carry NO plaintext. Then the resume story: a
 * fresh mirror over the same backend continues from the cursor instead of re-writing history,
 * and a flush that fails keeps its entries for the retry.
 */
import { describe, it, expect } from 'vitest';
import { AgentIdentity } from '@onderling/core';
import { VaultMemory } from '@onderling/vault';
import { createSealedPodDataSource } from '@onderling/pod-client';
import { memoryDataSource } from '@onderling/item-store';
import { createHistoryMirror, createHistoryPodMedium } from '../../src/v2/historyMirror.js';
import { settingsSealStrategyForIdentity } from '../../src/v2/sharedCopyOpener.js';
import { createRealHouseholdAgent } from '../../src/core/agent/realAgent.js';
import { EventLog } from '../../src/eventLog.js';

/** A SolidPodSource-shaped memory backend whose raw stored bodies we can byte-inspect. */
function memoryPodSource(map = new Map()) {
  return {
    map,
    async read(uri) { if (!map.has(uri)) { const e = new Error('404'); e.status = 404; throw e; } return { content: map.get(uri) }; },
    async write(uri, body) { map.set(uri, String(body)); },
    async delete(uri) { map.delete(uri); },
    async list(pre) { return [...map.keys()].filter((k) => k.startsWith(pre)); },
  };
}

async function sealedSourceFor(identity, map) {
  const strategy = settingsSealStrategyForIdentity(identity);
  expect(strategy).toBeTruthy();
  return createSealedPodDataSource({ podSource: memoryPodSource(map), podUrl: 'mem://', strategy });
}

const entry = (id, text) => ({ id, app: 'circle', type: 'chat-message', payload: { text } });

describe('the history mirror — sealed follower of the device log', () => {
  it('mirrors appends as sealed batches + a head; the backend bytes carry NO plaintext', async () => {
    const identity = await AgentIdentity.generate(new VaultMemory());
    const map = new Map();
    const log = new EventLog({ initial: [], muted: [] });
    const mirror = createHistoryMirror({
      eventLog: log,
      source: await sealedSourceFor(identity, map),
      snapshot: async () => ({ registry: [{ id: 'default', label: 'thuis' }] }),
      batchMax: 2, flushMs: 5,
    });
    await mirror.start();

    log.append(entry('m-1', 'geheim bericht een'));
    log.append(entry('m-2', 'geheim bericht twee'));   // batchMax reached → flush
    await mirror.flush();

    // The batch + cursor + head are on the backend…
    const keys = [...map.keys()];
    expect(keys).toContain('basis/history/log/batch-1.json');
    expect(keys).toContain('basis/history/cursor.json');
    expect(keys).toContain('basis/history/head.json');
    // …and NOTHING stored is plaintext: not the message text, not the structure, not the head.
    const allBytes = [...map.values()].join('\n');
    for (const secret of ['geheim', 'chat-message', 'thuis', 'lastSeq', 'registry']) {
      expect(allBytes, `backend bytes leak "${secret}"`).not.toContain(secret);
    }

    // The OWNER'S sealed source opens it all back up, intact.
    const mine = await sealedSourceFor(identity, map);
    const batch = JSON.parse(await mine.read('basis/history/log/batch-1.json'));
    expect(batch.entries.map((e) => e.payload.text)).toEqual(['geheim bericht een', 'geheim bericht twee']);
    expect(JSON.parse(await mine.read('basis/history/head.json')).registry[0].label).toBe('thuis');

    // A DIFFERENT identity's key opens none of it (deny-safe — the seal is to the owner).
    const stranger = await sealedSourceFor(await AgentIdentity.generate(new VaultMemory()), map);
    await expect(stranger.read('basis/history/log/batch-1.json')).rejects.toThrow();
  });

  it('resumes from the cursor: a fresh mirror over the same backend mirrors only what is NEW', async () => {
    const identity = await AgentIdentity.generate(new VaultMemory());
    const map = new Map();
    const log = new EventLog({ initial: [], muted: [] });

    const first = createHistoryMirror({ eventLog: log, source: await sealedSourceFor(identity, map), batchMax: 100, flushMs: 5 });
    await first.start();
    log.append(entry('m-1', 'voor de herstart'));
    await first.stop();
    expect(first.status().mirrored).toBe(1);

    // "Reboot": a new mirror instance, same backend, same log (which also gains a new entry).
    log.append(entry('m-2', 'na de herstart'));
    const second = createHistoryMirror({ eventLog: log, source: await sealedSourceFor(identity, map), batchMax: 100, flushMs: 5 });
    await second.start();
    await second.flush();
    expect(second.status().mirrored).toBe(1);            // only the NEW entry — no re-mirrored history

    const mine = await sealedSourceFor(identity, map);
    const b2 = JSON.parse(await mine.read('basis/history/log/batch-2.json'));
    expect(b2.entries.map((e) => e.payload.text)).toEqual(['na de herstart']);
  });

  it('a failed flush keeps its entries and retries — the cursor never lies', async () => {
    const identity = await AgentIdentity.generate(new VaultMemory());
    const map = new Map();
    const log = new EventLog({ initial: [], muted: [] });
    const sealed = await sealedSourceFor(identity, map);
    let failWrites = false;
    const flaky = {
      read: (u) => sealed.read(u),
      write: (u, v) => (failWrites ? Promise.reject(new Error('backend down')) : sealed.write(u, v)),
      delete: (u) => sealed.delete(u),
      list: (p) => sealed.list(p),
    };
    const mirror = createHistoryMirror({ eventLog: log, source: flaky, batchMax: 100, flushMs: 5, logger: { warn: () => {} } });
    await mirror.start();

    failWrites = true;
    log.append(entry('m-1', 'vast in de buffer'));
    await mirror.flush();
    expect(mirror.status().pending).toBe(1);
    expect(mirror.status().lastError).toContain('backend down');
    expect(mirror.status().mirrored).toBe(0);

    failWrites = false;
    await mirror.flush();
    expect(mirror.status().pending).toBe(0);
    expect(mirror.status().mirrored).toBe(1);
    const mine = await sealedSourceFor(identity, map);
    expect(JSON.parse(await mine.read('basis/history/cursor.json')).batch).toBe(1);
  });

  it('THE BOOT WIRING: off by default provisions nothing; the switch on + a reboot → the log mirrors sealed', async () => {
    const settings = memoryDataSource();          // ONE user's settings store, shared across "reboots"
    const podMap = new Map();
    let provisions = 0;
    const provisionHistoryMirror = async (strategy) => {
      provisions += 1;
      return createHistoryPodMedium({ podSource: memoryPodSource(podMap), strategy });
    };

    // Boot 1 — the default (off): the backend is never even provisioned, no status.
    const log1 = new EventLog({ initial: [], muted: [] });
    const A1 = await createRealHouseholdAgent({
      seedHousehold: false, settingsDataSource: settings, deviceLog: log1, provisionHistoryMirror,
    });
    await new Promise((r) => setTimeout(r, 50));   // the wiring block is fire-and-forget
    expect(provisions).toBe(0);
    expect(A1.historyMirrorStatus()).toBe(null);

    // The person flips the switch (through the ONE kind-gated write).
    const set = await A1.callSkill('params', 'set-param', { key: 'history.mirror', value: true });
    expect(set.ok).toBe(true);

    // Boot 2 — same settings store: the mirror starts and a fresh append lands SEALED on the backend.
    const log2 = new EventLog({ initial: [], muted: [] });
    const A2 = await createRealHouseholdAgent({
      seedHousehold: false, settingsDataSource: settings, deviceLog: log2, provisionHistoryMirror,
    });
    await new Promise((r) => setTimeout(r, 50));
    expect(provisions).toBe(1);
    log2.append(entry('m-boot', 'geheim uit de tweede boot'));
    const deadline = Date.now() + 5000;
    while ((A2.historyMirrorStatus()?.mirrored ?? 0) < 1 && Date.now() < deadline) {
      await new Promise((r) => setTimeout(r, 100));
    }
    expect(A2.historyMirrorStatus()?.mirrored).toBeGreaterThanOrEqual(1);
    const raw = [...podMap.values()].join('\n');
    expect(raw).not.toContain('geheim');            // sealed on the backend, by construction
  }, 30_000);
});
