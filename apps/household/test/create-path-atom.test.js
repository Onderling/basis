/**
 * B · Layer 1 — shared CREATE path (the `add` atom) parity gate.
 *
 * `addItem` (list nouns) and `addTask` (the `task` noun) are both noun-
 * specific spellings of the `add` atom.  They were consolidated onto a
 * single shared `createHouseholdItem` create path (additive, behaviour-
 * preserving).  This test pins that consolidation:
 *
 *   1. Both op handlers produce the SAME shape as calling the shared
 *      `createHouseholdItem` directly (byte-identical replies + the
 *      `item.added` stateUpdate), for a list-type item AND for a task.
 *   2. The pre-consolidation observable behaviour is preserved (reply
 *      wording, trimming, empty-text rejection, inline assignee).
 *
 * Mirrors the existing `test/skills/*.test.js` + `test/sp2-feature.test.js`
 * pattern (direct skill calls against `InMemoryStore` + a stub ctx).
 */

import { describe, it, expect } from 'vitest';

import { InMemoryStore } from '../src/storage/InMemoryStore.js';
import {
  addItem, addTask, createHouseholdItem,
} from '../src/skills/index.js';

function makeCtx(store, opts = {}) {
  return {
    store,
    chatId:      opts.chatId      ?? 'chat-1',
    senderWebid: opts.senderWebid ?? 'web:alice',
    bridgeId:    opts.bridgeId    ?? 'mock',
  };
}

// A reply's stateUpdate carries a fresh itemId; compare everything else.
function withoutItemId(reply) {
  return {
    replies:      reply.replies,
    stateUpdates: reply.stateUpdates.map(({ itemId, ...rest }) => rest),
  };
}

describe('B/L1 create-path atom: addItem === createHouseholdItem (list noun)', () => {
  it('addItem(shopping) matches the shared create path directly', async () => {
    const viaOp     = await addItem({ type: 'shopping', text: 'bread' }, makeCtx(new InMemoryStore()));
    const viaShared = await createHouseholdItem('shopping', { text: 'bread' }, makeCtx(new InMemoryStore()));

    expect(withoutItemId(viaOp)).toEqual(withoutItemId(viaShared));
    // Pre-consolidation observable behaviour is preserved exactly.
    expect(viaOp.replies[0].text).toBe('✓ added to shopping: bread');
    expect(viaOp.stateUpdates[0].kind).toBe('item.added');
    expect(viaOp.stateUpdates[0].chatId).toBe('chat-1');
    expect(typeof viaOp.stateUpdates[0].itemId).toBe('string');
  });

  it('trims text, and the created item lands in the store', async () => {
    const store = new InMemoryStore();
    const reply = await addItem({ type: 'errand', text: '  post office  ' }, makeCtx(store));
    expect(reply.replies[0].text).toBe('✓ added to errand: post office');
    const open = await store.listOpen({ type: 'errand' });
    expect(open).toHaveLength(1);
    expect(open[0].text).toBe('post office');
    expect(open[0].type).toBe('errand');
    expect(open[0].addedBy).toBe('web:alice');
  });

  it('rejects empty text with the list wording (no state change)', async () => {
    const store = new InMemoryStore();
    const reply = await addItem({ type: 'shopping', text: '   ' }, makeCtx(store));
    expect(reply.replies[0].text).toBe(`Couldn't add — text is empty.`);
    expect(reply.stateUpdates).toEqual([]);
    expect(await store.listOpen({ type: 'shopping' })).toHaveLength(0);
  });
});

describe('B/L1 create-path atom: addTask === createHouseholdItem (task noun)', () => {
  it('addTask matches the shared create path directly', async () => {
    const viaOp     = await addTask({ text: 'paint the hallway' }, makeCtx(new InMemoryStore()));
    const viaShared = await createHouseholdItem(
      'task', { text: 'paint the hallway' }, makeCtx(new InMemoryStore()),
      { emptyText: `Couldn't add task — text is empty.`, reply: (i) => `✓ added task: ${i.text}` },
    );

    expect(withoutItemId(viaOp)).toEqual(withoutItemId(viaShared));
    // Pre-consolidation observable behaviour is preserved exactly.
    expect(viaOp.replies[0].text).toBe('✓ added task: paint the hallway');
    expect(viaOp.stateUpdates[0].kind).toBe('item.added');
    expect(viaOp.stateUpdates[0].chatId).toBe('chat-1');
  });

  it('creates a `task` item and honours an inline assignee', async () => {
    const store = new InMemoryStore();
    await addTask(
      { text: 'mow the lawn', assignee: 'web:charlie' },
      makeCtx(store, { senderWebid: 'web:alice' }),
    );
    const [task] = await store.listOpen({ type: 'task' });
    expect(task.type).toBe('task');
    expect(task.text).toBe('mow the lawn');
    expect(task.assignee).toBe('web:charlie'); // rich task shape: owner is `assignee`
  });

  it('rejects empty text with the task wording (no state change)', async () => {
    const store = new InMemoryStore();
    const reply = await addTask({ text: '   ' }, makeCtx(store));
    expect(reply.replies[0].text).toBe(`Couldn't add task — text is empty.`);
    expect(reply.stateUpdates).toEqual([]);
    expect(await store.listOpen({ type: 'task' })).toHaveLength(0);
  });
});

describe('B/L1 nouns declaration conforms to the shared contract', () => {
  it('every nouns key is an itemType and every atom is a canonical atom', async () => {
    const { householdManifest } = await import('../manifest.js');
    const { isAtom, canonicalAtom } = await import('@onderling/app-manifest');

    const types = new Set(householdManifest.itemTypes);
    for (const [noun, decl] of Object.entries(householdManifest.nouns)) {
      expect(types.has(noun)).toBe(true);
      for (const verb of decl.atoms) {
        expect(isAtom(verb)).toBe(true);            // it is an atom (or alias)…
        expect(canonicalAtom(verb)).toBe(verb);     // …AND already canonical (no alias)
      }
    }
  });
});
