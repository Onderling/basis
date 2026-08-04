/**
 * feature tests. Verifies the household feature delta:
 *
 *   - addTask creates a `task` item.
 *   - listTasks lists open tasks (with claim-buttons when ≤10).
 *   - claim assigns an open task; double-claim surfaces "already claimed".
 *   - reassign updates the task's assignee.
 *   - registerName creates a `contact` item.
 *
 * Skills are tested directly against `InMemoryStore` + a stub
 * SkillContext — mirroring the existing `test/skills/*.test.js` pattern.
 */

import { describe, it, expect } from 'vitest';

import { InMemoryStore } from '../src/storage/InMemoryStore.js';
import {
  addTask, listTasks, claim, reassign, registerName,
} from '../src/skills/index.js';

function buildCtx(store, opts = {}) {
  return {
    store,
    chatId:      opts.chatId      ?? 'chat-1',
    senderWebid: opts.senderWebid ?? 'web:alice',
    bridgeId:    opts.bridgeId    ?? 'mock',
    agent:       {},
  };
}

describe('SP-2: addTask', () => {
  it('adds a task item; emits item.added', async () => {
    const store = new InMemoryStore();
    const reply = await addTask({ text: 'paint the hallway' }, buildCtx(store));
    expect(reply.replies[0].text).toMatch(/added task: paint the hallway/);
    expect(reply.stateUpdates).toEqual([
      expect.objectContaining({ kind: 'item.added', chatId: 'chat-1' }),
    ]);
    const tasks = await store.listOpen({ type: 'task' });
    expect(tasks).toHaveLength(1);
    expect(tasks[0].text).toBe('paint the hallway');
    expect(tasks[0].type).toBe('task');
  });

  it('rejects empty / whitespace-only text', async () => {
    const store = new InMemoryStore();
    const r1 = await addTask({ text: '' },     buildCtx(store));
    const r2 = await addTask({ text: '   ' }, buildCtx(store));
    expect(r1.replies[0].text).toMatch(/text is empty/);
    expect(r2.replies[0].text).toMatch(/text is empty/);
    expect(await store.listOpen({ type: 'task' })).toHaveLength(0);
  });

  it('honours an inline assignee', async () => {
    const store = new InMemoryStore();
    await addTask(
      { text: 'mow the lawn', assignee: 'web:charlie' },
      buildCtx(store, { senderWebid: 'web:alice' }),
    );
    const [task] = await store.listOpen({ type: 'task' });
    expect(task.assignee).toBe('web:charlie'); // rich task shape: owner is `assignee`
  });
});

describe('SP-2: listTasks', () => {
  it('says nothing when there are no open tasks', async () => {
    const store = new InMemoryStore();
    const reply = await listTasks({}, buildCtx(store));
    expect(reply.replies[0].text).toMatch(/Nothing open in tasks/);
    expect(reply.replies[0].buttons).toBeUndefined();
  });

  it('numbers and renders open tasks with claim-buttons (≤10)', async () => {
    const store = new InMemoryStore();
    await addTask({ text: 'one' }, buildCtx(store));
    await addTask({ text: 'two' }, buildCtx(store));
    const reply = await listTasks({}, buildCtx(store));
    expect(reply.replies[0].text).toMatch(/1\. one/);
    expect(reply.replies[0].text).toMatch(/2\. two/);
    expect(reply.replies[0].buttons).toHaveLength(2);
    expect(reply.replies[0].buttons[0].id).toMatch(/^claim /);
    expect(reply.replies[0].buttons[0].label).toMatch(/Take/);
  });
});

describe('SP-2: claim', () => {
  it('claims an open task; emits item.claimed', async () => {
    const store = new InMemoryStore();
    await addTask({ text: 'water the plants' }, buildCtx(store, { senderWebid: 'web:alice' }));
    const reply = await claim({ match: 'plants' }, buildCtx(store, { senderWebid: 'web:bob' }));
    expect(reply.replies[0].text).toMatch(/claimed: water the plants/);
    expect(reply.stateUpdates).toEqual([
      expect.objectContaining({ kind: 'item.claimed', chatId: 'chat-1' }),
    ]);
    const [task] = await store.listOpen({ type: 'task' });
    expect(task.assignee).toBe('web:bob');
  });

  it('reports "already claimed" on second claim', async () => {
    const store = new InMemoryStore();
    await addTask({ text: 'fix the tap' }, buildCtx(store));
    await claim({ match: 'tap' }, buildCtx(store, { senderWebid: 'web:alice' }));
    const reply = await claim({ match: 'tap' }, buildCtx(store, { senderWebid: 'web:bob' }));
    expect(reply.replies[0].text).toMatch(/already claimed/);
  });

  it('returns "no match" when nothing matches', async () => {
    const store = new InMemoryStore();
    const reply = await claim({ match: 'unknown' }, buildCtx(store));
    expect(reply.replies[0].text).toMatch(/Couldn't find an open task/);
  });

  it('lists candidates when ambiguous', async () => {
    const store = new InMemoryStore();
    await addTask({ text: 'paint the hallway' }, buildCtx(store));
    await addTask({ text: 'paint the kitchen' }, buildCtx(store));
    const reply = await claim({ match: 'paint' }, buildCtx(store));
    expect(reply.replies[0].text).toMatch(/Multiple matches/);
    expect(reply.stateUpdates).toEqual([]);
  });
});

describe('SP-2: reassign', () => {
  it('reassigns a task to a new webid; emits item.reassigned', async () => {
    const store = new InMemoryStore();
    await addTask({ text: 'mow the lawn' }, buildCtx(store, { senderWebid: 'web:alice' }));
    const reply = await reassign(
      { match: 'lawn', assignee: 'web:charlie' },
      buildCtx(store, { senderWebid: 'web:alice' }),
    );
    expect(reply.replies[0].text).toMatch(/reassigned: mow the lawn → web:charlie/);
    expect(reply.stateUpdates).toEqual([
      expect.objectContaining({ kind: 'item.reassigned' }),
    ]);
    const [task] = await store.listOpen({ type: 'task' });
    expect(task.assignee).toBe('web:charlie');
  });

  it('rejects a missing assignee', async () => {
    const store = new InMemoryStore();
    await addTask({ text: 'mow the lawn' }, buildCtx(store));
    const reply = await reassign({ match: 'lawn' }, buildCtx(store));
    expect(reply.replies[0].text).toMatch(/no assignee/);
  });

  it('rejects a missing match keyword', async () => {
    const store = new InMemoryStore();
    const reply = await reassign({ assignee: 'web:x' }, buildCtx(store));
    expect(reply.replies[0].text).toMatch(/no match keyword/);
  });
});

describe('SP-2: registerName', () => {
  it("creates a `contact` item with the user's name", async () => {
    const store = new InMemoryStore();
    const reply = await registerName(
      { text: 'Frits' },
      buildCtx(store, { senderWebid: 'web:frits' }),
    );
    expect(reply.replies[0].text).toMatch(/registered: Frits/);
    expect(reply.stateUpdates).toEqual([
      expect.objectContaining({ kind: 'item.added' }),
    ]);
    const contacts = await store.listOpen({ type: 'contact' });
    expect(contacts).toHaveLength(1);
    expect(contacts[0].text).toBe('Frits');
    expect(contacts[0].addedBy).toBe('web:frits');
    expect(contacts[0].type).toBe('contact');
  });

  it('rejects empty / whitespace-only name', async () => {
    const store = new InMemoryStore();
    const r1 = await registerName({ text: '' },     buildCtx(store));
    const r2 = await registerName({ text: '   ' }, buildCtx(store));
    expect(r1.replies[0].text).toMatch(/name is empty/);
    expect(r2.replies[0].text).toMatch(/name is empty/);
    expect(await store.listOpen({ type: 'contact' })).toHaveLength(0);
  });
});

describe('SP-2: itemTypes coexistence', () => {
  it('list-item types and task / contact items coexist in the same store', async () => {
    const store = new InMemoryStore();
    // Add one of each, asserting types are kept separate.
    await store.addItem({
      type: 'shopping', text: 'bread', addedBy: 'web:alice',
      source: { tg: { chatId: 'c', messageId: '1' } },
    });
    await addTask     ({ text: 'paint hallway' }, buildCtx(store));
    await registerName({ text: 'Frits' },         buildCtx(store, { senderWebid: 'web:frits' }));

    expect(await store.listOpen({ type: 'shopping' })).toHaveLength(1);
    expect(await store.listOpen({ type: 'task'     })).toHaveLength(1);
    expect(await store.listOpen({ type: 'contact'  })).toHaveLength(1);
    // Asking for one type doesn't leak the others.
    const t = await store.listOpen({ type: 'task' });
    expect(t[0].text).toBe('paint hallway');
  });
});
