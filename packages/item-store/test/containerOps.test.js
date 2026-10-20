/**
 * containerOps — the composable-op engine: addChildTo + resolveContainerAdd
 * (the K0-deferred natural-verb "add X picks the child type by the active container").
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { CircleItemStore } from '../src/CircleItemStore.js';
import { memoryDataSource } from '../src/memoryDataSource.js';
import { addChildTo, resolveContainerAdd, buildAcceptsPolicy, resolveAddInContainer } from '../src/containerOps.js';
import { childIdsOf } from '../src/containment.js';

const registry = {
  validate: (it) => (['list', 'task', 'note', 'list-item'].includes(it.type) ? { ok: true } : { ok: false, errors: [{ message: `bad ${it.type}` }] }),
};

describe('addChildTo', () => {
  let store;
  beforeEach(() => { store = new CircleItemStore({ dataSource: memoryDataSource(), rootContainer: 'mem://circles/c/', registry }); });

  it('creates the child in the same store + contains it (ref + back-ref)', async () => {
    const list = await store.put({ type: 'list', text: 'chores' });
    const child = await addChildTo(store, list.id, { type: 'task', text: 'fix tap', createdBy: 'alice' });
    expect(child.id).toBeTruthy();
    expect(child.type).toBe('task');
    expect(child.containedBy).toEqual([list.id]);                 // back-ref
    expect(childIdsOf(await store.get(list.id))).toEqual([child.id]);  // edge on the container
  });

  it('the child goes out ONCE, already contained — never a half-made item on the wire', async () => {
    // A receiver that acts on a first, uncontained write (an answer on it) ticks above THAT write only; the creator's
    // second write (the back-ref) then out-clocks the answer and it is lost on both replicas (L350's RSVP).
    const list = await store.put({ type: 'list', text: 'agenda' });
    const sent = [];
    store.setSyncHook({ publishItem: (it) => { sent.push(it); } });
    const child = await addChildTo(store, list.id, { type: 'task', text: 'koffie' });
    const ofChild = sent.filter((it) => it.id === child.id);
    expect(ofChild.length, JSON.stringify(ofChild)).toBe(1);
    expect(ofChild[0].containedBy).toEqual([list.id]);
    expect(childIdsOf(sent.filter((it) => it.id === list.id).at(-1))).toEqual([child.id]);   // the edge still goes out
  });

  it('validates the child type via the store + guards bad input', async () => {
    const list = await store.put({ type: 'list', text: 'x' });
    await expect(addChildTo(store, list.id, { type: 'bogus' })).rejects.toThrow(/bad bogus/);
    await expect(addChildTo(store, list.id, {})).rejects.toThrow(/childItem\.type/);
    await expect(addChildTo(store, 'nope', { type: 'task' })).rejects.toThrow(/container "nope" not found/);
  });
});

describe('resolveContainerAdd (K0 natural-verb context resolution)', () => {
  it('no accepts → null (not composable here → normal add)', () => {
    expect(resolveContainerAdd({ accepts: [] })).toBeNull();
    expect(resolveContainerAdd({})).toBeNull();
  });

  it('single accepted type → that one', () => {
    expect(resolveContainerAdd({ accepts: [{ type: 'list-item', op: 'addItem' }] }))
      .toEqual({ type: 'list-item', op: 'addItem' });
  });

  it('multiple with a default → the default (e.g. a list defaults to list-item over task)', () => {
    const accepts = [{ type: 'task', op: 'addTask' }, { type: 'list-item', op: 'addItem', default: true }];
    expect(resolveContainerAdd({ accepts })).toEqual({ type: 'list-item', op: 'addItem' });
  });

  it('multiple, no default → ambiguous (the caller asks which)', () => {
    const accepts = [{ type: 'task', op: 'addTask' }, { type: 'note', op: 'addNote' }];
    expect(resolveContainerAdd({ accepts })).toEqual({ ambiguous: [{ type: 'task', op: 'addTask' }, { type: 'note', op: 'addNote' }] });
  });

  it('an explicit hint wins over default/ambiguity ("add a TASK …")', () => {
    const accepts = [{ type: 'task', op: 'addTask' }, { type: 'note', op: 'addNote', default: true }];
    expect(resolveContainerAdd({ accepts, hint: 'task' })).toEqual({ type: 'task', op: 'addTask' });
    // a hint that isn't accepted is ignored → falls back to default
    expect(resolveContainerAdd({ accepts, hint: 'event' })).toEqual({ type: 'note', op: 'addNote' });
  });
});

describe('buildAcceptsPolicy (the manifest surfacing contract)', () => {
  it('merges each app\'s accepts per container type (composable extensibility)', () => {
    // the tasks app + a notes app independently extend what a `list` accepts
    const tasksManifest = { accepts: { list: [{ type: 'task', op: 'addTask', default: true }], offer: [{ type: 'list', op: 'addList' }] } };
    const notesManifest = { accepts: { list: [{ type: 'note', op: 'addNote' }] } };
    const { acceptsFor } = buildAcceptsPolicy([tasksManifest, notesManifest]);
    expect(acceptsFor('list').map((a) => a.type).sort()).toEqual(['note', 'task']);
    expect(acceptsFor('list').find((a) => a.type === 'task').default).toBe(true);
    expect(acceptsFor('offer').map((a) => a.type)).toEqual(['list']);
    expect(acceptsFor('unknown')).toEqual([]);
  });

  it('first declarer wins on a child-type collision; ignores malformed entries', () => {
    const { acceptsFor } = buildAcceptsPolicy([
      { accepts: { list: [{ type: 'task', op: 'addTaskA' }, { type: 'bad' }] } },
      { accepts: { list: [{ type: 'task', op: 'addTaskB' }] } },
      { /* no accepts */ },
    ]);
    expect(acceptsFor('list')).toEqual([{ type: 'task', op: 'addTaskA' }]);
  });
});

describe('resolveAddInContainer (the dispatch bridge)', () => {
  const { acceptsFor } = buildAcceptsPolicy([{ accepts: {
    list:  [{ type: 'task', op: 'addTask', default: true }, { type: 'note', op: 'addNote' }],
    offer: [{ type: 'list', op: 'addList' }],
  } }]);

  it('bare "add X" in a list → the default child op, body preserved', () => {
    expect(resolveAddInContainer({ container: { type: 'list' }, acceptsFor, body: 'buy milk' }))
      .toEqual({ op: 'addTask', type: 'task', body: 'buy milk' });
  });

  it('a leading type word is the hint + is stripped ("add note remember the keys")', () => {
    expect(resolveAddInContainer({ container: { type: 'list' }, acceptsFor, body: 'note remember the keys' }))
      .toEqual({ op: 'addNote', type: 'note', body: 'remember the keys' });
  });

  it('single accept → that op (offer accepts only a list)', () => {
    expect(resolveAddInContainer({ container: { type: 'offer' }, acceptsFor, body: 'moving tasks' }))
      .toEqual({ op: 'addList', type: 'list', body: 'moving tasks' });
  });

  it('non-container / unaccepting → null (fall back to the normal add)', () => {
    expect(resolveAddInContainer({ container: { type: 'task' }, acceptsFor, body: 'x' })).toBeNull();
    expect(resolveAddInContainer({ container: null, acceptsFor, body: 'x' })).toBeNull();
  });

  it('ambiguous (multiple, no default, no hint) → asks which', () => {
    const amb = buildAcceptsPolicy([{ accepts: { box: [{ type: 'task', op: 'addTask' }, { type: 'note', op: 'addNote' }] } }]).acceptsFor;
    expect(resolveAddInContainer({ container: { type: 'box' }, acceptsFor: amb, body: 'something' }))
      .toEqual({ ambiguous: [{ type: 'task', op: 'addTask' }, { type: 'note', op: 'addNote' }] });
  });
});
