/**
 * A post lives in its circle's own store; everything else stays in pinboard's pile. The skills' verbs keep working
 * over the union: list, read one, claim, complete, remove.
 */
import { describe, it, expect } from 'vitest';
import { createCircleStores, memoryDataSource, createTaskStore, CircleItemStore } from '@onderling/item-store';
import { MemorySource } from '@onderling/core';
import { validate } from '@onderling/item-types';
import { createRoutedStore } from '../src/lib/routedStore.js';

const ANN = 'https://id.example/ann';
function setup() {
  const stores = createCircleStores({ dataSource: memoryDataSource(), registry: { validate } });
  const pile = createTaskStore(new CircleItemStore({ dataSource: new MemorySource(), rootContainer: 'mem://neighbourhood/' }));
  const routed = createRoutedStore({ pile, hostCircles: { storeFor: (c) => stores.getStore(c), circlesOf: () => ['kring-a', 'kring-b'] } });
  return { stores, pile, routed };
}
const ask = (groupId, extra = {}) => ({ type: 'request', text: 'wie heeft er een ladder?', source: { targets: [{ kind: 'group', groupId }] }, ...extra });

describe('createRoutedStore', () => {
  it('a post goes to its circle\'s store, not the pile; a non-post stays in the pile', async () => {
    const { stores, pile, routed } = setup();
    const [post] = await routed.addItems([ask('kring-a')], { actor: ANN });
    const [rules] = await routed.addItems([{ type: 'group-rules', text: 'wees aardig', source: { groupId: 'kring-a' } }], { actor: ANN });
    expect(await stores.getStore('kring-a').get(post.id)).toBeTruthy();
    expect(await pile.getById(post.id).catch(() => null)).toBeFalsy();
    expect(await pile.getById(rules.id)).toBeTruthy();
    expect(await stores.getStore('kring-a').get(rules.id)).toBeFalsy();
    const body = await stores.getStore('kring-a').get(post.id);
    expect(body.body).toBe('wie heeft er een ladder?');
  });

  it('a post that names no circle goes to each of the author\'s circles under one id', async () => {
    const { stores, routed } = setup();
    const [post] = await routed.addItems([{ type: 'request', text: 'een boormachine', source: {} }], { actor: ANN });
    expect((await stores.getStore('kring-a').get(post.id))?.id).toBe(post.id);
    expect((await stores.getStore('kring-b').get(post.id))?.id).toBe(post.id);
    expect((await routed.listOpen({})).filter((it) => it.id === post.id)).toHaveLength(1);
  });

  it('reads see both, and the lifecycle verbs reach the post where it lives', async () => {
    const { stores, routed } = setup();
    const [post] = await routed.addItems([ask('kring-a')], { actor: ANN });
    await routed.addItems([{ type: 'report', text: 'spam', source: { groupId: 'kring-a' } }], { actor: ANN });
    const open = await routed.listOpen({});
    expect(open.map((i) => i.type).sort()).toEqual(['report', 'request']);
    expect((await routed.getById(post.id))?.id).toBe(post.id);
    await routed.update(post.id, { notes: 'bijgewerkt' }, { actor: ANN });
    expect((await stores.getStore('kring-a').get(post.id))?.notes).toBe('bijgewerkt');
    await routed.markComplete([{ id: post.id }], { actor: ANN });
    expect((await routed.listOpen({})).some((i) => i.id === post.id)).toBe(false);
    expect((await routed.listClosed({})).some((i) => i.id === post.id)).toBe(true);
  });

  it('a claim on a post reaches its circle store (the accept path claims before it completes)', async () => {
    const { stores, routed } = setup();
    const [post] = await routed.addItems([ask('kring-a')], { actor: ANN });
    const BEA = 'https://id.example/bea';
    const r = await routed.claim(post.id, { actor: BEA });
    expect(r?.error).toBeUndefined();
    expect((await stores.getStore('kring-a').get(post.id))?.assignees).toContain(BEA);
  });
});

describe('createRoutedStore — no circle yet', () => {
  it('a post no circle can hold stays in the pile and is still listed and found', async () => {
    const pile = createTaskStore(new CircleItemStore({ dataSource: new MemorySource(), rootContainer: 'mem://neighbourhood/' }));
    const stores = createCircleStores({ dataSource: memoryDataSource(), registry: { validate } });
    const routed = createRoutedStore({ pile, hostCircles: { storeFor: (c) => stores.getStore(c), circlesOf: () => [] } });
    const [post] = await routed.addItems([{ type: 'request', text: 'een boormachine', source: {} }], { actor: ANN });
    expect(await pile.getById(post.id)).toBeTruthy();
    expect((await routed.listOpen({})).map((i) => i.id)).toEqual([post.id]);
    expect((await routed.getById(post.id))?.id).toBe(post.id);
  });
});


describe('createRoutedStore — the poster\'s own knowledge stays on the device', () => {
  it('who answered my post is never written to the circle store, yet my reads see it', async () => {
    const { stores, routed } = setup();
    const [post] = await routed.addItems([ask('kring-a')], { actor: ANN });
    await routed.update(post.id, { source: { ...post.source, responders: ['https://id.example/bob'] } }, { actor: ANN });
    const inCircle = await stores.getStore('kring-a').get(post.id);
    expect(inCircle.source?.responders, 'the circle store (what syncs) holds no responders').toBeUndefined();
    expect((await routed.getById(post.id))?.source?.responders).toEqual(['https://id.example/bob']);
    expect((await routed.listOpen({})).find((i) => i.id === post.id)?.source?.responders).toEqual(['https://id.example/bob']);
  });
});

describe('createRoutedStore — the roster trail lives in its circle\'s store', () => {
  const trail = (groupId, extra = {}) => ({ type: 'membership-redemption', text: 'redeemed', source: { groupId, redeemedBy: 'pk-bram', role: 'member', circleAddress: 'addr-1', ...extra } });

  it('a trail row goes to its circle\'s store, not the pile, and the type-filtered read finds it there', async () => {
    const { stores, pile, routed } = setup();
    const [row] = await routed.addItems([trail('kring-a')], { actor: ANN });
    expect(await stores.getStore('kring-a').get(row.id)).toBeTruthy();
    expect(await pile.getById(row.id).catch(() => null)).toBeFalsy();
    const reds = await routed.listOpen({ type: 'membership-redemption' });
    expect(reds.map((r) => r.id)).toEqual([row.id]);
  });

  it('an ingest (the roster seed) puts the row in its circle; a patch in place lands there too', async () => {
    const { stores, routed } = setup();
    const r = await routed.ingestItems([{ id: 'seed-1', ...trail('kring-b') }], { actor: ANN });
    expect(r.ingested.length).toBe(1);
    expect(await stores.getStore('kring-b').get('seed-1')).toBeTruthy();
    const cur = await routed.getById('seed-1');
    await routed.update('seed-1', { source: { ...cur.source, circleAddress: 'addr-2' } }, { actor: ANN });
    expect((await stores.getStore('kring-b').get('seed-1')).source.circleAddress).toBe('addr-2');
  });
  it('after a restart, a circle that holds rows here but is not open yet is still read — and not opened by the read', async () => {
    const ds = memoryDataSource();
    const before = createCircleStores({ dataSource: ds, registry: { validate } });
    const pile = createTaskStore(new CircleItemStore({ dataSource: new MemorySource(), rootContainer: 'mem://neighbourhood/' }));
    const host = (stores) => ({
      storeFor: (c, { write = false } = {}) => (write || stores.has(c) ? stores.getStore(c) : null),
      circlesOf: () => ['kring-a'],
      openCircles: () => stores.ids(),
      heldCircles: () => stores.heldIds(),
      peekFor: (c) => stores.peek(c),
    });
    const [row] = await createRoutedStore({ pile, hostCircles: host(before) }).addItems([trail('kring-a')], { actor: ANN });
    const after = createCircleStores({ dataSource: ds, registry: { validate } });   // the next run: nothing open
    const routed = createRoutedStore({ pile, hostCircles: host(after) });
    expect((await routed.listOpen({ type: 'membership-redemption', groupId: 'kring-a' })).map((r) => r.id)).toEqual([row.id]);
    expect((await routed.listOpen({ type: 'membership-redemption' })).map((r) => r.id)).toEqual([row.id]);
    expect((await routed.getById(row.id))?.id).toBe(row.id);
    expect(after.has('kring-a')).toBe(false);
  });
});
