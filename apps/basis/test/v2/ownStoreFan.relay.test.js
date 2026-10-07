/**
 * The person's own store between their own devices, over a real relay: what Anna writes in it on her phone is on her
 * always-on device — sealed in flight, signed by the phone's delegation key — and never on Bea's. A stranger asking
 * for it is served nothing; a stranger's or the person key's statement on the scope is refused; a device that was
 * away catches up from its sibling.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { signSpine, Bootstrap, AgentIdentity } from '@onderling/core';
import { VaultMemory } from '@onderling/vault';
import { until } from '../support/pairRealAgents.js';
import { bootAnnaTwoDevices, SEND } from '../support/annaTwoDevices.js';
import { OWN_DEVICES_SCOPE } from '../../src/v2/grantsManifest.js';
import { OWN_TASK_CATCHUP_SUBTYPES, TASK_BROADCAST } from '../../src/v2/taskRail.js';
import { TASK_LANE } from '../../src/v2/taskManifest.js';

// the task lane's entries on the own scope (the grants lane shares the scope's id; the rails differ by entry kind)
const ownTaskEntries = (log) => log.query({}).filter((e) => e?.circleId === OWN_DEVICES_SCOPE && e?.type === TASK_LANE);

const GROUP = 'anna-own-store';
const appt = (title) => ({ type: 'calendar-event', title, startsAt: '2026-10-20T11:00:00.000Z', endsAt: '2026-10-20T12:00:00.000Z' });

describe('the own store between a person\'s devices', () => {
  let w;
  beforeAll(async () => { w = await bootAnnaTwoDevices({ group: GROUP }); }, 180_000);
  afterAll(async () => { await w?.close?.(); });

  it('what Anna writes on the phone is on her always-on device, sealed in flight — and never on Bea\'s', async () => {
    const [phone, box, bea] = await Promise.all([w.A.agent.ownStore(), w.A2.agent.ownStore(), w.B.agent.ownStore()]);
    const made = await phone.put(appt('tandarts-eigen'), { by: w.A.pubKey });
    const there = await until(async () => (await box.get(made.id)) ?? null, { timeout: 15_000, step: 200 });
    expect(there?.title, 'the always-on device holds it').toBe('tandarts-eigen');
    // on the always-on device's log the statement carries the item sealed, never in words
    const onLog = JSON.stringify(ownTaskEntries(w.logs.A2));
    expect(onLog).toContain(made.id);
    expect(onLog).not.toContain('tandarts-eigen');
    await new Promise((r) => setTimeout(r, 1500));
    expect(await bea.get(made.id), 'Bea never holds Anna\'s own store').toBe(null);
  });

  it('a stranger asking for Anna\'s own store is served nothing', async () => {
    const beaGot = [];
    const prior = w.B._routerRef.fn;
    w.B._routerRef.fn = (env) => { if (env?.payload?.subtype === OWN_TASK_CATCHUP_SUBTYPES.batch) beaGot.push(env.payload); return prior?.(env); };
    await w.B.agent.sendPeerMessage(w.A.agent.circleAddressFor(GROUP), { subtype: OWN_TASK_CATCHUP_SUBTYPES.request, circleId: OWN_DEVICES_SCOPE, frontier: [], limit: 200 }, SEND);
    await w.B.agent.sendPeerMessage(w.A.agent.circleAddressFor(GROUP), { subtype: 'circle-task-catchup-request', circleId: OWN_DEVICES_SCOPE, frontier: [], limit: 200 }, SEND);
    await new Promise((r) => setTimeout(r, 3000));
    w.B._routerRef.fn = prior;
    expect(beaGot).toEqual([]);
  });

  it('another person\'s genuine device (Bea\'s own write, well signed) is refused on Anna\'s devices, sent or carried', async () => {
    const box = await w.A2.agent.ownStore();
    const beaStore = await w.B.agent.ownStore();
    const planted = await beaStore.put(appt('van-bea'), { by: w.B.pubKey });
    const entry = await until(async () => ownTaskEntries(w.logs.B).find((e) => e.payload?.body?.subject === planted.id) ?? null, { timeout: 5000, step: 100 });
    expect(entry, 'Bea\'s own write is on her own lane (signed by her device)').toBeTruthy();
    await w.B.agent.sendPeerMessage(w.A2.agent.circleAddressFor(GROUP), { subtype: TASK_BROADCAST, circleId: OWN_DEVICES_SCOPE, event: entry.payload, ts: Date.now() }, SEND);
    expect((await w.A2.agent.taskRail.ingest(OWN_DEVICES_SCOPE, entry.payload)).ok, 'Bea\'s device is not in Anna\'s set').toBe(false);
    await new Promise((r) => setTimeout(r, 1500));
    expect(await box.get(planted.id)).toBe(null);
  });

  it('a stranger\'s key claiming to be Anna\'s device, and the person key itself, are refused on the scope', async () => {
    const box = await w.A2.agent.ownStore();
    // a well-signed statement by a key that is no delegation under Anna's root, naming Anna as its author
    const stranger = await AgentIdentity.generate(new VaultMemory());
    const forged = signSpine(stranger, {
      kind: 'snapshot', circleId: OWN_DEVICES_SCOPE, subject: 'st-1', payload: { sealed: 'x', authorRef: w.A.pubKey }, parent: null, deps: [],
    });
    expect((await w.A2.agent.taskRail.ingest(OWN_DEVICES_SCOPE, forged)).ok, 'a key outside the person\'s device set').toBe(false);
    // the person key: every device of the person holds it, a revoked one too — it never speaks on this scope
    const personKey = await AgentIdentity.fromSeed(Bootstrap.fromMnemonic(w.phrase).deriveAgentSeed('default'), new VaultMemory());
    expect(personKey.pubKey, 'the person key, from the phrase').toBe(w.A.pubKey);
    const personKeySigned = signSpine(personKey, {
      kind: 'snapshot', circleId: OWN_DEVICES_SCOPE, subject: 'pk-1', payload: { sealed: 'x', authorRef: w.A.pubKey }, parent: null, deps: [],
    });
    expect((await w.A2.agent.taskRail.ingest(OWN_DEVICES_SCOPE, personKeySigned)).ok, 'the person key is refused on the scope').toBe(false);
    expect(await box.get('st-1')).toBe(null);
    expect(await box.get('pk-1')).toBe(null);
  });

  it('a device that was away catches up from its sibling', async () => {
    const [phone, box] = await Promise.all([w.A.agent.ownStore(), w.A2.agent.ownStore()]);
    // the always-on device misses the carry: it drops the live statement
    const prior = w.A2._routerRef.fn;
    w.A2._routerRef.fn = (env) => (env?.payload?.subtype === TASK_BROADCAST && env.payload.circleId === OWN_DEVICES_SCOPE ? undefined : prior?.(env));
    const made = await phone.put(appt('terwijl-weg'), { by: w.A.pubKey });
    await new Promise((r) => setTimeout(r, 2000));
    expect(await box.get(made.id), 'missed live').toBe(null);
    w.A2._routerRef.fn = prior;
    await w.A2.agent.ownStoreSync.requestFromSiblings();
    const there = await until(async () => (await box.get(made.id)) ?? null, { timeout: 15_000, step: 200 });
    expect(there?.title).toBe('terwijl-weg');
  });
});
