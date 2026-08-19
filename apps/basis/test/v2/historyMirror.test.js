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
import { createHistoryMirror, createHistoryPodMedium, hydrateHistory, exportHistoryArchive, archiveSource } from '../../src/v2/historyMirror.js';
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
    expect(keys).toContain('basis/history/log/root/batch-1.json');
    expect(keys).toContain('basis/history/log/root/cursor.json');
    expect(keys).toContain('basis/history/head.json');
    // …and NOTHING stored is plaintext: not the message text, not the structure, not the head.
    const allBytes = [...map.values()].join('\n');
    for (const secret of ['geheim', 'chat-message', 'thuis', 'lastSeq', 'registry']) {
      expect(allBytes, `backend bytes leak "${secret}"`).not.toContain(secret);
    }

    // The OWNER'S sealed source opens it all back up, intact.
    const mine = await sealedSourceFor(identity, map);
    const batch = JSON.parse(await mine.read('basis/history/log/root/batch-1.json'));
    expect(batch.entries.map((e) => e.payload.text)).toEqual(['geheim bericht een', 'geheim bericht twee']);
    expect(JSON.parse(await mine.read('basis/history/head.json')).registry[0].label).toBe('thuis');

    // A DIFFERENT identity's key opens none of it (deny-safe — the seal is to the owner).
    const stranger = await sealedSourceFor(await AgentIdentity.generate(new VaultMemory()), map);
    await expect(stranger.read('basis/history/log/root/batch-1.json')).rejects.toThrow();
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
    const b2 = JSON.parse(await mine.read('basis/history/log/root/batch-2.json'));
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
    expect(JSON.parse(await mine.read('basis/history/log/root/cursor.json')).batch).toBe(1);
  });

  it('THE LIVE SWITCH: off by default provisions nothing; flipping it starts the sealed mirror NOW (and off stops it)', async () => {
    const settings = memoryDataSource();
    const podMap = new Map();
    let provisions = 0;
    const provisionHistoryMirror = async (strategy) => {
      provisions += 1;
      return createHistoryPodMedium({ podSource: memoryPodSource(podMap), strategy });
    };

    // Boot — the default (off): the backend is never even provisioned, no status.
    const log = new EventLog({ initial: [], muted: [] });
    const A = await createRealHouseholdAgent({
      seedHousehold: false, settingsDataSource: settings, deviceLog: log, provisionHistoryMirror,
    });
    await new Promise((r) => setTimeout(r, 50));   // the boot kick is fire-and-forget
    expect(provisions).toBe(0);
    expect(A.historyMirrorStatus()).toBe(null);

    // The person flips the switch (through the ONE kind-gated write) — the mirror starts LIVE,
    // no reboot, and a fresh append lands SEALED on the backend.
    const set = await A.callSkill('params', 'set-param', { key: 'history.mirror', value: true });
    expect(set.ok).toBe(true);
    let deadline = Date.now() + 5000;
    while (A.historyMirrorStatus() === null && Date.now() < deadline) await new Promise((r) => setTimeout(r, 50));
    expect(provisions).toBe(1);
    expect(A.historyMirrorStatus()).not.toBe(null);
    log.append(entry('m-live', 'geheim uit de live flip'));
    deadline = Date.now() + 5000;
    while ((A.historyMirrorStatus()?.mirrored ?? 0) < 1 && Date.now() < deadline) await new Promise((r) => setTimeout(r, 100));
    expect(A.historyMirrorStatus()?.mirrored).toBeGreaterThanOrEqual(1);
    const raw = [...podMap.values()].join('\n');
    expect(raw).not.toContain('geheim');            // sealed on the backend, by construction

    // …and OFF stops it live too (a final flush first — nothing buffered is lost).
    await A.callSkill('params', 'set-param', { key: 'history.mirror', value: false });
    deadline = Date.now() + 5000;
    while (A.historyMirrorStatus() !== null && Date.now() < deadline) await new Promise((r) => setTimeout(r, 50));
    expect(A.historyMirrorStatus()).toBe(null);
  }, 30_000);

  it('TWO DEVICES, TWO LANES: neither clobbers the other; restore merges both by id', async () => {
    const identity = await AgentIdentity.generate(new VaultMemory());
    const map = new Map();
    const logA = new EventLog({ initial: [], muted: [] });
    const logB = new EventLog({ initial: [], muted: [] });
    const mA = createHistoryMirror({ eventLog: logA, source: await sealedSourceFor(identity, map), laneId: 'dev-a', batchMax: 100, flushMs: 5 });
    const mB = createHistoryMirror({ eventLog: logB, source: await sealedSourceFor(identity, map), laneId: 'dev-b', batchMax: 100, flushMs: 5 });
    await mA.start(); await mB.start();
    logA.append({ ...entry('a-1', 'van apparaat a'), ts: Date.now() });
    logB.append({ ...entry('b-1', 'van apparaat b'), ts: Date.now() });
    await mA.flush(); await mB.flush();
    expect([...map.keys()]).toContain('basis/history/log/dev-a/batch-1.json');
    expect([...map.keys()]).toContain('basis/history/log/dev-b/batch-1.json');

    const fresh = new EventLog({ initial: [], muted: [] });
    const r = await hydrateHistory({ source: await sealedSourceFor(identity, map), eventLog: fresh });
    await r.tailDone;
    expect(fresh.query().map((e) => e.id).sort()).toEqual(['a-1', 'b-1']);
  });

  it('THE LADDER: the recent window hydrates first (days OR newest-per-circle, larger wins); the tail follows', async () => {
    const identity = await AgentIdentity.generate(new VaultMemory());
    const map = new Map();
    const log = new EventLog({ initial: [], muted: [] });
    const mirror = createHistoryMirror({ eventLog: log, source: await sealedSourceFor(identity, map), laneId: 'dev-a', batchMax: 500, flushMs: 5 });
    await mirror.start();
    const DAY = 24 * 60 * 60 * 1000;
    const t0 = Date.now();
    // Circle X: 3 old entries (60d back — outside the window) + 2 recent. maxPerCircle 3 → the
    // NEWEST 3 = both recent ones + ONE old one join the recent phase; 2 old ones are tail.
    for (let i = 0; i < 3; i += 1) log.append({ ...entry(`x-old-${i}`, 'oud'), circleId: 'circle-x', ts: t0 - 60 * DAY + i });
    log.append({ ...entry('x-new-1', 'vers'), circleId: 'circle-x', ts: t0 - DAY });
    log.append({ ...entry('x-new-2', 'vers'), circleId: 'circle-x', ts: t0 });
    // Circle Y: one recent entry — untouched by X's cap (the window is PER circle).
    log.append({ ...entry('y-new-1', 'vers'), circleId: 'circle-y', ts: t0 });
    await mirror.flush();

    const fresh = new EventLog({ initial: [], muted: [] });
    const r = await hydrateHistory({
      source: await sealedSourceFor(identity, map), eventLog: fresh,
      recencyDays: 30, maxPerCircle: 3, now: () => t0,
    });
    expect(r.recent).toBe(4);                                     // x-new-1 x-new-2 x-old-2(rank 3) y-new-1
    const afterRecent = new Set(fresh.query().map((e) => e.id));
    expect(afterRecent.has('x-new-1') && afterRecent.has('x-new-2') && afterRecent.has('y-new-1')).toBe(true);
    expect(afterRecent.has('x-old-0')).toBe(false);               // the tail is not here yet
    await r.tailDone;
    expect(fresh.query()).toHaveLength(6);                        // …and now everything is
    expect(r.hydratedIds.size).toBe(6);
  });

  it('THE RESTORE BOOT: a fresh device with an empty log hydrates the mirror and does NOT re-mirror it into its own lane', async () => {
    const settings = memoryDataSource();
    const podMap = new Map();
    // ONE user = one chat identity across every device (in production the phrase ceremony restores
    // it); sharing the identity vaults is that fact in a test — without them each boot would mint
    // its own seal key and the restore would (correctly) refuse to open the mirror. Both vaults:
    // the chat vault is sealed at rest under a key the OWNER-ROOT vault's custody decides.
    const vaults = { ownerRootVault: new VaultMemory(), chatVault: new VaultMemory() };
    const provisionHistoryMirror = async (strategy) =>
      createHistoryPodMedium({ podSource: memoryPodSource(podMap), strategy });

    // Device A: switch on (agent-scoped → it will sync to B via the shared settings store),
    // reboot so the sink runs, write a message.
    const logA = new EventLog({ initial: [], muted: [] });
    const A0 = await createRealHouseholdAgent({ seedHousehold: false, settingsDataSource: settings, deviceLog: logA, provisionHistoryMirror, ...vaults });
    await A0.callSkill('params', 'set-param', { key: 'history.mirror', value: true });
    const logA2 = new EventLog({ initial: [], muted: [] });
    const A = await createRealHouseholdAgent({ seedHousehold: false, settingsDataSource: settings, deviceLog: logA2, provisionHistoryMirror, ...vaults });
    await new Promise((r) => setTimeout(r, 50));
    logA2.append({ ...entry('a-msg', 'gespiegeld bericht'), ts: Date.now() });
    let deadline = Date.now() + 5000;
    while ((A.historyMirrorStatus()?.mirrored ?? 0) < 1 && Date.now() < deadline) await new Promise((r) => setTimeout(r, 100));
    expect(A.historyMirrorStatus()?.mirrored).toBeGreaterThanOrEqual(1);
    const lanesBefore = [...podMap.keys()].filter((k) => k.includes('/log/')).length;

    // Device B: FRESH (empty log), same settings store (the switch syncs), same pod. The boot
    // hydrates the mirror back — instant restore — and its own lane stays empty (skip).
    const logB = new EventLog({ initial: [], muted: [] });
    const B = await createRealHouseholdAgent({ seedHousehold: false, settingsDataSource: settings, deviceLog: logB, provisionHistoryMirror, ...vaults });
    deadline = Date.now() + 5000;
    while (logB.size < 1 && Date.now() < deadline) await new Promise((r) => setTimeout(r, 100));
    expect(logB.query().some((e) => e.id === 'a-msg')).toBe(true);          // A's history is HERE
    await new Promise((r) => setTimeout(r, 300));
    const lanesAfter = [...podMap.keys()].filter((k) => k.includes('/log/')).length;
    expect(lanesAfter).toBe(lanesBefore);   // B backfilled nothing — hydrated entries stay in A's lane
    expect(B.historyMirrorStatus()).not.toBe(null);                          // …but B's sink IS following
  }, 30_000);
});

describe('the archive export — "mirror to a file", proven restorable', () => {
  it('exports the whole live log sealed (no plaintext in the file) and hydrates back on a fresh log', async () => {
    const identity = await AgentIdentity.generate(new VaultMemory());
    const log = new EventLog({ initial: [], muted: [] });
    log.append({ ...entry('m-1', 'geheim archiefbericht'), ts: Date.now() });
    log.append({ ...entry('m-2', 'tweede bericht'), ts: Date.now() });

    const strategy = settingsSealStrategyForIdentity(identity);
    const json = await exportHistoryArchive({
      eventLog: log, strategy,
      snapshot: async () => ({ registry: [{ id: 'default' }] }),
    });
    expect(json).not.toContain('geheim');                       // the FILE is sealed
    expect(json).not.toContain('chat-message');

    // The owner's key opens it — the SAME hydrate door as the pod mirror.
    const fresh = new EventLog({ initial: [], muted: [] });
    const r = await hydrateHistory({ source: archiveSource(json, strategy), eventLog: fresh });
    await r.tailDone;
    expect(fresh.query().map((e) => e.id).sort()).toEqual(['m-1', 'm-2']);
    expect(fresh.query().find((e) => e.id === 'm-1').payload.text).toBe('geheim archiefbericht');

    // A stranger's key opens none of it.
    const strangerStrategy = settingsSealStrategyForIdentity(await AgentIdentity.generate(new VaultMemory()));
    const blocked = new EventLog({ initial: [], muted: [] });
    const rb = await hydrateHistory({ source: archiveSource(json, strangerStrategy), eventLog: blocked, logger: { warn: () => {} } });
    await rb.tailDone;
    expect(blocked.query()).toHaveLength(0);
  });
});
