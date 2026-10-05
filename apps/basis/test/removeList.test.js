/**
 * A list made by mistake can go ("werktaken" on the test bot). `removeList` takes the list and everything on it; it is
 * everyone's on a household bot (it can be put back for 30 days), and it asks first (a danger confirm, in the household's words).
 */
import { describe, it, expect, afterAll } from 'vitest';
import { bootRealAgentNode, teardown } from './support/pairRealAgents.js';
import { listsManifest } from '../../lists/manifest.js';
import { resolveDispatch } from '../src/router.js';
import { mergeManifests } from '../src/manifestMerge.js';
import { BOT_OP_MAP } from '../src/v2/botOpMap.js';
import { createCircleStores, memoryDataSource, contain, addChildTo } from '@onderling/item-store';
import { createRegistry, registerCanonicalTypes } from '@onderling/item-types';
import { makeListsOps } from '../src/v2/listsOps.js';
import { createTelegramRunner } from '../src/telegram/runner.js';
import { InMemoryBridge } from '@onderling/chat-agent';

function listsWorld() {
  const registry = createRegistry();
  registerCanonicalTypes(registry);
  const stores = createCircleStores({ dataSource: memoryDataSource(), registry });
  const t = (k, v) => (v ? `${k} ${JSON.stringify(v)}` : k);
  const ops = makeListsOps({ storeFor: (cid) => stores.getStore(cid), t, activeCircle: () => 'c1' });
  return { ops, store: stores.getStore('c1') };
}

const nodes = [];
afterAll(() => teardown(nodes));

describe('removing a list', () => {
  it('takes the list and its entries; the admin\'s; and it asks first', async () => {
    const node = await bootRealAgentNode('lists-remove');
    nodes.push(node);
    const call = (a, o, x) => node.agent.callSkill(a, o, x);
    await call('lists', 'createList', { text: 'Boodschappen' });
    await call('lists', 'createList', { text: 'werktaken' });
    await call('lists', 'addToList', { list: 'werktaken', text: 'mail beantwoorden' });
    // the preview crosses the real waist (a read: nothing goes)
    const asked = await call('lists', 'removeList', { list: 'werktaken', preview: true });
    expect(asked, JSON.stringify(asked)).toMatchObject({ ok: true, vars: { entries: 1 } });
    expect(asked.message).toMatch(/remove_list_confirm|werktaken/);
    const gone = await call('lists', 'removeList', { list: 'werktaken' });
    expect(gone.ok, JSON.stringify(gone)).toBe(true);
    const names = ((await call('lists', 'listLists', {})).items ?? []).map((i) => i.label ?? i.text);
    expect(names).toContain('Boodschappen');
    expect(names).not.toContain('werktaken');
    expect((await call('lists', 'removeList', { list: 'werktaken' })).ok).toBe(false);

    // everyone's since it can come back for 30 days (Frits 2026-10-05; `restoreList.test.js`)
    expect(BOT_OP_MAP.member).toContain('removeList');
    const r = resolveDispatch({ kind: 'slash', opId: 'removeList', args: { list: 'Boodschappen' } }, mergeManifests([{ manifest: listsManifest }]));
    expect(r.kind).toBe('needsConfirm');
    expect(r.messageKey).toBe('circle.lists.remove_list_confirm');
  }, 90_000);

  it('a child on another list stays there; children of children go with the list; the confirm counts the chores', async () => {
    const { ops, store } = listsWorld();
    await ops.createList({ text: 'Klusjes', defaultChild: 'task' });
    await ops.createList({ text: 'werktaken' });
    const lists = (await ops.listLists({})).items;
    const werk = lists.find((l) => (l.label ?? l.text) === 'werktaken').id;
    const klus = lists.find((l) => (l.label ?? l.text) === 'Klusjes').id;
    const mail = await addChildTo(store, werk, { type: 'task', text: 'mail beantwoorden', assignees: ['telegram:1'] });
    const bel = await addChildTo(store, werk, { type: 'task', text: 'bellen' });
    const sub = await addChildTo(store, mail.id, { type: 'task', text: 'bijlage zoeken' });
    const both = await addChildTo(store, werk, { type: 'task', text: 'rekening betalen' });
    await contain(store, klus, both.id);   // on two lists

    const preview = await ops.removeList({ list: 'werktaken', preview: true });
    expect(preview).toMatchObject({ ok: true, vars: { chores: 3, held: 1, kept: 1 } });
    expect(await store.get(mail.id), 'a preview removes nothing').toBeTruthy();

    expect((await ops.removeList({ list: 'werktaken' })).ok).toBe(true);
    expect(await store.get(mail.id)).toBeNull();
    expect(await store.get(bel.id)).toBeNull();
    expect(await store.get(sub.id), 'a child of a child is not left pointing at nothing').toBeNull();
    const kept = await store.get(both.id);
    expect(kept, 'on another list: detached, not deleted').toBeTruthy();
    expect(kept.containedBy).toEqual([klus]);
  });

  it('the confirm declares its preview, so the question can say what goes', () => {
    const op = listsManifest.operations.find((o) => o.id === 'removeList');
    expect(op.surfaces.ui.confirm.preview).toBe(true);
  });

  it('the bot asks with the preview\'s words, as the person — and the act runs only on yes', async () => {
    const bridge = new InMemoryBridge({ id: 'telegram' });
    const calls = [];
    const callSkill = async (app, op, args, ctx) => {
      calls.push({ op, args, caller: ctx?.caller ?? null });
      return args?.preview ? { ok: true, message: 'De lijst "werktaken" verwijderen, met 3 klusjes (1 opgepakt)?' } : { ok: true, message: 'weg' };
    };
    const runner = createTelegramRunner({ bridge, t: (k, v) => (v?.message ? `${k} ${v.message}` : k), collectMs: 0, catalogue: mergeManifests([{ manifest: listsManifest }]), callSkill });
    await runner.start();
    await bridge.simulateIncoming({ chatId: '9', text: '/list-delete werktaken', sender: { bridgeUid: '9' } });
    await runner.idle();
    expect(bridge.outbox.map((m) => m.text).join('\n')).toContain('met 3 klusjes (1 opgepakt)');
    expect(calls.map((c) => c.args?.preview ?? false)).toEqual([true]);
  });

  it('a preview the op refuses is said, and nothing is asked or left pending', async () => {
    const bridge = new InMemoryBridge({ id: 'telegram' });
    const callSkill = async (_a, _o, args) => (args?.preview ? { ok: false, error: { code: 'locked', message: 'eerst de sleutel openen' } } : { ok: true, message: 'weg' });
    const runner = createTelegramRunner({ bridge, t: (k, v) => (v?.message ? `${k} ${v.message}` : k), collectMs: 0, catalogue: mergeManifests([{ manifest: listsManifest }]), callSkill });
    await runner.start();
    await bridge.simulateIncoming({ chatId: '10', text: '/list-delete werktaken', sender: { bridgeUid: '10' } });
    await runner.idle();
    expect(bridge.outbox.map((m) => m.text)).toEqual(['eerst de sleutel openen']);
    expect(bridge.outbox[0].buttons ?? []).toEqual([]);
    expect(runner.hasPending?.('10') ?? false).toBe(false);
  });
});
