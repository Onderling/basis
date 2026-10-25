/**
 * A circle's invite code is the ADMIN's secret: with a host own store, it lives there — written as the self the admin is
 * in that circle (so it rides that self's own-devices lane only) — and never in the pile or a circle's store.
 */
import { describe, it, expect } from 'vitest';
import { createCircleStores, memoryDataSource, createTaskStore, CircleItemStore } from '@onderling/item-store';
import { MemorySource } from '@onderling/core';
import { validate } from '@onderling/item-types';
import { createRoutedStore } from '../src/lib/routedStore.js';

const ANN = 'pk-default';
function setup() {
  const stores = createCircleStores({ dataSource: memoryDataSource(), registry: { validate } });
  const own = createCircleStores({ dataSource: memoryDataSource(), registry: { validate }, rootPrefix: 'mem://own/' }).getStore('own');
  const pile = createTaskStore(new CircleItemStore({ dataSource: new MemorySource(), rootContainer: 'mem://neighbourhood/' }));
  const routed = createRoutedStore({ pile, hostCircles: {
    storeFor: (c) => stores.getStore(c), circlesOf: () => ['kring-a', 'kring-p'], ownStore: async () => own,
    // the self this device is in each circle: the persona's key in the persona's circle
    writerIn: (c, actor) => (c === 'kring-p' ? 'pk-persona' : actor),
  } });
  return { stores, own, pile, routed };
}
const code = (groupId, c) => ({ type: 'membership-code', text: 'code', source: { groupId, code: c, issuedAt: 1, expiresAt: 2 } });

describe('a membership code lives on the host\'s own store', () => {
  it('written as the circle\'s self, never in the pile or the circle\'s store', async () => {
    const { stores, own, pile, routed } = setup();
    const [a] = await routed.addItems([code('kring-a', 'GEHEIM-A')], { actor: ANN });
    const [p] = await routed.addItems([code('kring-p', 'GEHEIM-P')], { actor: ANN });
    expect(await pile.getById(a.id).catch(() => null)).toBeFalsy();
    expect(await stores.getStore('kring-a').get(a.id)).toBeFalsy();
    expect((await own.get(a.id))?.createdBy).toBe(ANN);
    expect((await own.get(p.id))?.createdBy, "a persona circle's code is the persona's").toBe('pk-persona');
  });

  it('the invite paths read and supersede it where it lives', async () => {
    const { own, routed } = setup();
    const [a] = await routed.addItems([code('kring-a', 'GEHEIM-A')], { actor: ANN });
    expect((await routed.listOpen({ type: 'membership-code' })).map((r) => r.source.code)).toEqual(['GEHEIM-A']);
    expect((await routed.getById(a.id))?.source?.code).toBe('GEHEIM-A');
    await routed.update(a.id, { source: { ...a.source, supersededAt: 3 } }, { actor: ANN });
    const row = await own.get(a.id);
    expect(row.source.supersededAt).toBe(3);
    expect(row.createdBy, 'an update keeps the lane it was written on').toBe(ANN);
  });
});

describe('who answered my post lives on the host\'s own store', () => {
  it('kept as the self of the post\'s circle, folded back into my reads, never in the pile or the circle store', async () => {
    const { stores, own, pile, routed } = setup();
    const [post] = await routed.addItems([{ type: 'request', text: 'wie heeft een ladder?', source: { groupId: 'kring-p' } }], { actor: ANN });
    await routed.update(post.id, { source: { ...post.source, responders: ['pk-bea'] } }, { actor: ANN });
    const answers = (await own.listByType('post-answers')).filter((r) => r?.source?.itemId === post.id);
    expect(answers.map((r) => r.source.responders)).toEqual([['pk-bea']]);
    expect(answers[0].createdBy, "a persona circle's post: the persona's to know").toBe('pk-persona');
    expect((await pile.listOpen({ type: 'post-answers' })) ?? []).toEqual([]);
    expect((await stores.getStore('kring-p').get(post.id))?.source?.responders).toBeUndefined();
    expect((await routed.getById(post.id))?.source?.responders).toEqual(['pk-bea']);
    expect((await routed.listOpen({})).some((r) => r.type === 'post-answers')).toBe(false);
  });
});
