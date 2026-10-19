/**
 * AN ITEM'S CIRCLE DECIDES WHO THE DEVICE IS ON IT. `acceptResponder` and `markReturned` name an item, not a circle, so
 * the host's call arrives as the device's general self even when the item lives in a persona's circle. The device's own
 * call acts there as the self it is in THAT circle — the completion records the persona, never the general persona's
 * ref (which would link the two on the circle's wire). A foreign caller stays who they are.
 */
import { describe, it, expect } from 'vitest';
import { DataPart, MemorySource } from '@onderling/core';
import { createTaskStore, CircleItemStore } from '@onderling/item-store';
import { buildSkills } from '../src/skills/index.js';

const LOCAL = 'webid:anna';
const PERSONA = 'webid:anna-werk';
const selfWebidFor = (cid) => (cid === 'circle:werk' ? PERSONA : null);

function skills() {
  const store = createTaskStore(new CircleItemStore({ dataSource: new MemorySource(), rootContainer: 'mem://t/' }));
  const byId = new Map(buildSkills({ store, localActor: LOCAL, selfWebidFor }).map((s) => [s.id, s]));
  const call = (op, args, from = LOCAL) => byId.get(op).handler({ parts: [DataPart(args)], from, envelope: null });
  return { store, call };
}
const seed = (store, circle, by, extra = {}) => store.addItems([{
  type: 'offer', kind: 'lend', text: 'ladder', requiredSkills: [], visibility: 'household', source: { groupId: circle }, ...extra,
}], { actor: by }).then(([i]) => i);

describe("an item's circle decides the device's self on it", () => {
  it("markReturned in a persona's circle records the persona", async () => {
    const { store, call } = skills();
    const item = await seed(store, 'circle:werk', PERSONA);
    const r = await call('markReturned', { requestId: item.id });
    expect(r.item.completedBy).toBe(PERSONA);
    expect(JSON.stringify(await store.getById(item.id)).includes(`"${LOCAL}"`)).toBe(false);
  });
  it("acceptResponder in a persona's circle records the persona", async () => {
    const { store, call } = skills();
    const item = await seed(store, 'circle:werk', PERSONA, { type: 'request', kind: undefined, source: { groupId: 'circle:werk', responders: ['webid:mel'] } });
    const r = await call('acceptResponder', { requestId: item.id, responderWebid: 'webid:mel' });
    expect(r.request.completedBy).toBe(PERSONA);
  });
  it('the general self in its own circle, and a foreign caller as themselves', async () => {
    const { store, call } = skills();
    const home = await seed(store, 'circle:thuis', LOCAL);
    expect((await call('markReturned', { requestId: home.id })).item.completedBy).toBe(LOCAL);
    const theirs = await seed(store, 'circle:werk', 'webid:mel');
    expect((await call('markReturned', { requestId: theirs.id }, 'webid:mel')).item.completedBy).toBe('webid:mel');
  });
});

describe('only the poster completes their post', () => {
  it("markReturned: the poster's own call in a persona's circle → ok; a co-member, an admin → not-the-poster", async () => {
    const { store, call } = skills();
    const item = await seed(store, 'circle:werk', PERSONA);
    expect((await call('markReturned', { requestId: item.id }, 'webid:mel')).error).toBe('not-the-poster');
    expect((await call('markReturned', { requestId: item.id }, 'webid:admin')).error).toBe('not-the-poster');
    expect((await store.getById(item.id)).completedAt ?? null).toBe(null);
    expect((await call('markReturned', { requestId: item.id })).item.completedBy).toBe(PERSONA);
  });
  it('acceptResponder: a co-member, an admin → not-the-poster; the poster → accepted, the responder as the claim', async () => {
    const { store, call } = skills();
    const req = await seed(store, 'circle:werk', PERSONA, { type: 'request', kind: undefined, source: { groupId: 'circle:werk', responders: ['webid:mel'] } });
    expect((await call('acceptResponder', { requestId: req.id, responderWebid: 'webid:mel' }, 'webid:bram')).error).toBe('not-the-poster');
    expect((await call('acceptResponder', { requestId: req.id, responderWebid: 'webid:mel' }, 'webid:admin')).error).toBe('not-the-poster');
    expect((await store.getById(req.id)).completedAt ?? null).toBe(null);
    const r = await call('acceptResponder', { requestId: req.id, responderWebid: 'webid:mel' });
    expect(r.request.completedBy).toBe(PERSONA);
    expect(r.request.assignee).toBe('webid:mel');
  });
});
