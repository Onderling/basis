/**
 * The two delivery settings, and how a row shows its state.
 *
 * The load-bearing test is the one about NOT rendering: a persistent "unknown" badge on messages to someone
 * with receipts off would let anyone spot that setting by looking at a conversation — which is exactly the
 * disclosure `deliveryState.js` refuses to make. Null means render nothing.
 */
import { describe, it, expect } from 'vitest';
import {
  deliverySettings, createDeliverySettingsStore,
  localStorageDeliveryIo, asyncStorageDeliveryIo,
  deliveryLabelFor, withDelivery, recordDelivery,
} from '../../src/v2/deliverySettings.js';
import { DELIVERY } from '../../src/v2/deliveryState.js';

describe('the two settings pull in opposite directions', () => {
  it('receipts default ON, fallback default OFF', () => {
    // One is "say less about me"; the other is "reveal more about me to be reachable".
    expect(deliverySettings()).toEqual({ sendReceipts: true, allowFallback: false });
  });

  it('only an explicit boolean changes either', () => {
    expect(deliverySettings({ sendReceipts: 'no', allowFallback: 1 }))
      .toEqual({ sendReceipts: true, allowFallback: false });
    expect(deliverySettings({ sendReceipts: false, allowFallback: true }))
      .toEqual({ sendReceipts: false, allowFallback: true });
  });

  it('is frozen', () => {
    expect(Object.isFrozen(deliverySettings())).toBe(true);
  });

  it('round-trips through the store and both adapters', async () => {
    const mem = new Map();
    const io = localStorageDeliveryIo({
      getItem: (k) => mem.get(k) ?? null, setItem: (k, v) => mem.set(k, v),
    });
    const store = createDeliverySettingsStore(io);
    expect((await store.get()).allowFallback).toBe(false);

    await store.set({ allowFallback: true });
    expect(createDeliverySettingsStore(io) && io.load()).toMatchObject({ allowFallback: true });

    const mem2 = new Map();
    const rn = asyncStorageDeliveryIo({
      getItem: async (k) => mem2.get(k) ?? null, setItem: async (k, v) => { mem2.set(k, v); },
    });
    await rn.save({ sendReceipts: false });
    expect((await rn.load()).sendReceipts).toBe(false);
  });

  it('a corrupt store reads as defaults rather than throwing', async () => {
    const io = localStorageDeliveryIo({ getItem: () => 'not json', setItem: () => {} });
    expect(io.load()).toEqual({});
    expect(await createDeliverySettingsStore(io).get()).toEqual({ sendReceipts: true, allowFallback: false });
  });

  it('changing one setting does not reset the other', async () => {
    const mem = new Map();
    const io = localStorageDeliveryIo({ getItem: (k) => mem.get(k) ?? null, setItem: (k, v) => mem.set(k, v) });
    const store = createDeliverySettingsStore(io);
    await store.set({ sendReceipts: false });
    const after = await store.set({ allowFallback: true });
    expect(after).toEqual({ sendReceipts: false, allowFallback: true });
  });
});

describe('what a row shows', () => {
  it('labels my own message with its state', () => {
    // One namespace for the wording — the states share a home with the ones that already existed.
    expect(deliveryLabelFor(DELIVERY.REACHED)).toBe('circle.chat.delivery.reached_device');
    expect(deliveryLabelFor(DELIVERY.MAYBE)).toBe('circle.chat.delivery.maybe_received');
  });

  it('THE RULE: an unknown state renders NOTHING, never an "unknown" badge', () => {
    // A persistent "no information" marker on every message to someone with receipts off would let anyone
    // spot that setting by looking at the conversation.
    expect(deliveryLabelFor(undefined)).toBeNull();
    expect(deliveryLabelFor('read')).toBeNull();
    expect(deliveryLabelFor(null)).toBeNull();
  });

  it('never shows delivery on someone ELSE’s message', () => {
    // Their sending is not mine to report on.
    expect(deliveryLabelFor(DELIVERY.STORED, { mine: false })).toBeNull();
  });
});

describe('joining delivery onto rows', () => {
  const rows = [
    { id: 'm1', mine: true, text: 'hoi' },
    { id: 'm2', mine: false, text: 'dag' },
    { id: 'm3', mine: true, text: 'nog een' },
  ];

  it('annotates only my rows that have a known state', () => {
    const out = withDelivery(rows, { m1: DELIVERY.STORED, m2: DELIVERY.STORED });
    expect(out[0]).toMatchObject({ delivery: 'stored', deliveryLabelKey: expect.stringMatching(/^circle\./) });
    expect(out[1].delivery).toBeUndefined();   // theirs
    expect(out[2].delivery).toBeUndefined();   // mine, but nothing known yet
  });

  it('leaves a row untouched rather than adding empty fields', () => {
    // An annotated-but-null row would tempt a renderer into drawing a placeholder.
    const [row] = withDelivery([{ id: 'x', mine: true }], {});
    expect('delivery' in row).toBe(false);
    expect('deliveryLabelKey' in row).toBe(false);
  });

  it('accepts a Map as well as an object', () => {
    const out = withDelivery(rows, new Map([['m1', DELIVERY.REACHED]]));
    expect(out[0].delivery).toBe('reached-device');
  });

  it('survives junk input', () => {
    expect(withDelivery(null, {})).toEqual([]);
    expect(withDelivery([{ id: 'a', mine: true }], null)).toHaveLength(1);
  });
});

describe('recording an outcome', () => {
  it('advances and never demotes', () => {
    let map = recordDelivery(new Map(), 'm1', DELIVERY.REACHED);
    expect(map.get('m1')).toBe(DELIVERY.REACHED);

    map = recordDelivery(map, 'm1', DELIVERY.STORED);
    expect(map.get('m1')).toBe(DELIVERY.STORED);

    // A late transport-ack arriving after the app receipt must not undo it.
    map = recordDelivery(map, 'm1', DELIVERY.REACHED);
    expect(map.get('m1')).toBe(DELIVERY.STORED);
  });

  it('returns a NEW map, so a caller can diff', () => {
    const before = new Map();
    const after = recordDelivery(before, 'm1', DELIVERY.SENT);
    expect(after).not.toBe(before);
    expect(before.size).toBe(0);
  });

  it('ignores an unusable id or state', () => {
    expect(recordDelivery(new Map(), '', DELIVERY.SENT).size).toBe(0);
    expect(recordDelivery(new Map(), 'm1', 'read').size).toBe(0);
  });
});
