/**
 * The own-devices scope on the task lane: a person's own items ride between THEIR devices only — signed by the
 * device's delegation key (never the person key), verified by the device-set binding, and sealed in flight to the
 * person's own seal-to-self key, so no relay and no stranger reads them. A device that cannot sign (not enrolled) or
 * cannot seal sends nothing: its own store stays local. A circle's lane is unchanged.
 */
import { describe, it, expect } from 'vitest';
import { randomBytes } from 'node:crypto';
import { AgentIdentity } from '@onderling/core';
import { VaultMemory, seedToString } from '@onderling/vault';
import { groupKeyStrategy } from '@onderling/pod-client';
import { createCircleStores, memoryDataSource, wireStoreMirror } from '@onderling/item-store';
import { createRegistry, registerCanonicalTypes } from '@onderling/item-types';
import { makeTaskRail, makeTaskEmitter, makeTaskPeerHandler, routeTaskMirror, TASK_BROADCAST } from '../../src/v2/taskRail.js';
import { OWN_DEVICES_SCOPE } from '../../src/v2/grantsManifest.js';

const PERSON = 'person-key';

function fakeEventLog() {
  const entries = []; const byId = new Set();
  return {
    entries,
    query() { return entries.slice(); },
    appendSilentEntry({ circleId, kind, payload, id, ts }) {
      if (byId.has(id)) return entries.find((e) => e.id === id);
      byId.add(id);
      const entry = { id, type: kind, circleId, payload, ts, silent: true };
      entries.push(entry); return entry;
    },
  };
}

async function world() {
  const personSeal = groupKeyStrategy({ groupKey: seedToString(randomBytes(32)) });
  const deviceKeys = [];
  const wire = [];
  async function device(name, { canSign = true, canSeal = true } = {}) {
    const key = await AgentIdentity.generate(new VaultMemory());
    deviceKeys.push(key.pubKey);
    const registry = createRegistry();
    registerCanonicalTypes(registry);
    const stores = createCircleStores({ dataSource: memoryDataSource(), registry });
    const rail = makeTaskRail({
      eventLog: fakeEventLog(),
      circleIdentityFor: async () => key,
      myRef: PERSON,
      callSkill: async () => ({}),
      storeFor: (circleId) => stores.getStore(circleId),
      verifyBinding: async () => false,
      own: {
        scope: OWN_DEVICES_SCOPE,
        signer: async () => (canSign ? { identity: key, ref: PERSON } : null),
        // the device-set binding, as the test's person knows it: one of the person's device keys, for the person
        verifyBinding: async ({ author, ref }) => ref === PERSON && deviceKeys.includes(author),
        seal: () => (canSeal ? personSeal : null),
        delegation: () => ({ deviceId: name, pubKey: key.pubKey }),
      },
    });
    const emitter = makeTaskEmitter({ rail, fan: (circleId, statement) => wire.push({ from: name, circleId, statement }) });
    const own = stores.getStore(OWN_DEVICES_SCOPE);
    wireStoreMirror(own, routeTaskMirror({ circleId: OWN_DEVICES_SCOPE, emitter }));
    return { name, key, rail, own, receive: makeTaskPeerHandler({ rail }) };
  }
  const pump = async (to) => { while (wire.length) { const w = wire.shift(); for (const d of to) if (d.name !== w.from) await d.receive(null, { subtype: TASK_BROADCAST, circleId: w.circleId, event: w.statement }); } };
  return { device, wire, pump, personSeal };
}
const settle = async () => { for (let i = 0; i < 12; i += 1) await new Promise((r) => setTimeout(r, 0)); };

describe('the own-devices scope on the task lane', () => {
  it('a row written on one device reaches the other, sealed in flight: its words never ride in the clear', async () => {
    const w = await world();
    const phone = await w.device('phone');
    const laptop = await w.device('laptop');
    const made = await phone.own.put({ type: 'calendar-event', title: 'tandarts-geheim', startsAt: '2026-10-12T12:00:00.000Z' }, { by: PERSON });
    await settle();
    expect(w.wire).toHaveLength(1);
    const flat = JSON.stringify(w.wire[0].statement);
    expect(flat).not.toContain('tandarts-geheim');
    expect(w.wire[0].statement.body.payload.sealed).toBeTruthy();
    expect(w.wire[0].statement.body.payload.delegation).toMatchObject({ deviceId: 'phone' });
    await w.pump([laptop]);
    expect((await laptop.own.get(made.id))?.title).toBe('tandarts-geheim');
  });

  it('a stranger\'s statement on the scope is refused, though it is well signed', async () => {
    const w = await world();
    const laptop = await w.device('laptop');
    const strangerKey = await AgentIdentity.generate(new VaultMemory());
    const { makeTaskRail: mk } = await import('../../src/v2/taskRail.js');
    const strangerStores = createCircleStores({ dataSource: memoryDataSource() });
    const stranger = mk({
      eventLog: fakeEventLog(), circleIdentityFor: async () => strangerKey, myRef: PERSON, callSkill: async () => ({}),
      storeFor: (c) => strangerStores.getStore(c),
      own: { scope: OWN_DEVICES_SCOPE, signer: async () => ({ identity: strangerKey, ref: PERSON }), verifyBinding: async () => true, seal: () => w.personSeal },
    });
    const res = await stranger.append(OWN_DEVICES_SCOPE, { kind: 'snapshot', subject: 'x1', payload: { item: { id: 'x1', type: 'calendar-event', title: 'planted', startsAt: '2026-10-12T12:00:00.000Z', createdAt: '2026-10-07T10:00:00.000Z', createdBy: PERSON } } });
    const landed = await laptop.rail.ingest(OWN_DEVICES_SCOPE, res.statement);
    expect(landed.ok).toBe(false);
    expect(await laptop.own.get('x1')).toBe(null);
  });

  it('a device that cannot sign (not enrolled), or cannot seal, sends nothing — its own store stays local', async () => {
    const w = await world();
    const unenrolled = await w.device('unenrolled', { canSign: false });
    const noSeal = await w.device('no-seal', { canSeal: false });
    await unenrolled.own.put({ type: 'calendar-event', title: 'a', startsAt: '2026-10-12T12:00:00.000Z' }, { by: PERSON });
    await noSeal.own.put({ type: 'calendar-event', title: 'b', startsAt: '2026-10-12T12:00:00.000Z' }, { by: PERSON });
    await settle();
    expect(w.wire).toEqual([]);
    expect((await unenrolled.own.list()).map((i) => i.title)).toEqual(['a']);
  });

  it('the catch-up serve set is sealed and signed by the device too', async () => {
    const w = await world();
    const phone = await w.device('phone');
    const laptop = await w.device('laptop');
    // a row the lane has no statement for (written beneath the publish hook)
    await phone.own.put({ type: 'calendar-event', title: 'oud-geheim', startsAt: '2026-10-12T12:00:00.000Z' }, { by: PERSON, sync: false });
    const served = await phone.rail.catchUpStatements(OWN_DEVICES_SCOPE);
    expect(served).toHaveLength(1);
    expect(JSON.stringify(served)).not.toContain('oud-geheim');
    expect((await laptop.rail.ingest(OWN_DEVICES_SCOPE, served[0])).ok).toBe(true);
    expect((await laptop.own.list()).map((i) => i.title)).toEqual(['oud-geheim']);
  });
});
