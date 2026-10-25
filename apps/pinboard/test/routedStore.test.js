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
