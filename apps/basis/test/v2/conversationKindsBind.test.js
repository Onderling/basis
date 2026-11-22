/**
 * A circle's conversation kinds are a VIEW filter, and a filter binds only when every reader of an arrived line asks it.
 * A member whose app still posts a kind the circle has switched off: the line is kept on the log (switching the kind
 * back on brings it back), but no reader on this device shows it, counts it, or lists it as news.
 * The kinds reach the readers through the policy store: whatever store read or wrote the circle's policy, the readers know.
 */
import { describe, it, expect } from 'vitest';
import { createCirclePolicyStore } from '../../src/v2/circlePolicyStore.js';
import {
  knownConversationKindsOf, showsInConversation, conversationKindsOf, warmConversationKinds,
} from '../../src/v2/conversationKinds.js';
import { buildTilePreviews, countsAsUnread } from '../../src/v2/circleTilePreviews.js';
import { notificationRows } from '../../src/v2/notifications.js';

const t = (k, v = {}) => `${k.split('.').pop()}${Object.keys(v).length ? ` ${JSON.stringify(v)}` : ''}`;
const NOW = Date.UTC(2026, 10, 20, 12);
const memStore = () => {
  const m = new Map();
  return createCirclePolicyStore({ load: async (id) => m.get(id) ?? null, save: async (id, p) => { m.set(id, p); } });
};
const chatLine = (id, circleId) => ({ id, ts: NOW - 1000, landedAt: NOW - 1000, type: 'chat-message', actor: 'other', payload: { circleId, text: 'hoi' } });
const askLine = (id, circleId) => ({ id, ts: NOW - 900, landedAt: NOW - 900, type: 'ask', actor: 'other', payload: { circleId, text: 'wie heeft een ladder?' } });

describe('the conversation kinds bind on every reader', () => {
  it('a policy write is known to the readers; a policy never read is not known (nothing filtered)', async () => {
    const store = memStore();
    expect(knownConversationKindsOf('kb-1')).toBeNull();
    await store.update('kb-1', { conversationKinds: ['ask'] });
    expect(knownConversationKindsOf('kb-1')).toEqual(['ask']);
    await store.update('kb-1', { conversationKinds: ['ask', 'chat-message'] });
    expect(knownConversationKindsOf('kb-1')).toEqual(['ask', 'chat-message']);
  });

  it('warming reads every listed circle, so a template default is known too (a neighbourhood shows no open chat)', async () => {
    const m = new Map([['kb-2', { kind: 'neighbourhood' }]]);
    const store = createCirclePolicyStore({ load: async (id) => m.get(id) ?? null, save: async () => {} });
    await warmConversationKinds(store, [{ id: 'kb-2' }]);
    expect(knownConversationKindsOf('kb-2')).toEqual(conversationKindsOf({ policy: { kind: 'neighbourhood' } }));
    expect(knownConversationKindsOf('kb-2')).not.toContain('chat-message');
  });

  it('a kind the circle has off: no count, no subtitle, no news row; an allowed kind still counts', async () => {
    await memStore().update('kb-3', { conversationKinds: ['ask'] });
    const circles = [{ id: 'kb-3', name: 'Straat' }];
    const hidden = chatLine('h1', 'kb-3');
    expect(countsAsUnread(hidden, { myRefs: ['me'] })).toBe(false);
    const tile = buildTilePreviews({ events: [hidden], circles, myRefs: ['me'] })['kb-3'];
    expect(tile.unread).toBe(0);
    expect(tile.subtitle).toBeNull();
    expect(notificationRows({ events: [hidden], circles, myRefs: ['me'], t, now: NOW })).toEqual([]);

    const shown = askLine('a1', 'kb-3');
    expect(countsAsUnread(shown, { myRefs: ['me'] })).toBe(true);
    expect(buildTilePreviews({ events: [hidden, shown], circles, myRefs: ['me'] })['kb-3'].unread).toBe(1);
    expect(notificationRows({ events: [hidden, shown], circles, myRefs: ['me'], t, now: NOW }).map((r) => r.id)).toEqual(['a1']);
  });

  it('turning the kind back on brings the line back (a filter, nothing dropped)', async () => {
    const store = memStore();
    await store.update('kb-4', { conversationKinds: ['ask'] });
    const line = chatLine('h2', 'kb-4');
    expect(countsAsUnread(line, { myRefs: ['me'] })).toBe(false);
    await store.update('kb-4', { conversationKinds: ['ask', 'chat-message'] });
    expect(countsAsUnread(line, { myRefs: ['me'] })).toBe(true);
  });

  it('only the human lane is judged: a system row or a landed item is not cut by the kinds', () => {
    expect(showsInConversation({ type: 'governance' }, [])).toBe(true);
    expect(showsInConversation({ type: 'chat-message' }, [])).toBe(false);
    expect(showsInConversation({ type: 'chat-message' }, null)).toBe(true);
  });
});
