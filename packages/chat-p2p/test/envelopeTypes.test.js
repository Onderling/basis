/**
 * Substrate-side smoke for chat-p2p's envelope-type config.
 * The original Pinboard wireChat tests cover the end-to-end behaviour
 * via apps/pinboard/test/phase14.test.js + phase27.test.js. These
 * tests pin the substrate's specific contract: configurable
 * accept/emit envelope types, mixed-version interop.
 */

import { describe, it, expect, vi } from 'vitest';
import { wireChat } from '../index.js';

/** Build a stub agent + itemStore + members for the substrate. */
function buildHarness({ acceptedEnvelopeTypes, emitEnvelopeType }) {
  const messageHandlers = [];
  const oneWayCalls = [];
  const items = [];
  const transport = {
    sendOneWay: vi.fn(async (toPubKey, env) => { oneWayCalls.push({ toPubKey, env }); }),
  };
  const agent = {
    on: (name, fn) => { if (name === 'message') messageHandlers.push(fn); },
    off: (name, fn) => {
      if (name === 'message') {
        const i = messageHandlers.indexOf(fn);
        if (i >= 0) messageHandlers.splice(i, 1);
      }
    },
    emit: vi.fn(),
    transport,
    // wireChat now routes per-peer via agent.transportFor — the stub
    // returns the same single transport for any peer (the substrate
    // doesn't care which transport it gets, only that one comes back).
    transportFor: vi.fn(async () => transport),
  };
  const itemStore = {
    addItems: vi.fn(async (drafts) => {
      const persisted = drafts.map((d) => ({ id: 'id-' + items.length, ...d }));
      items.push(...persisted);
      return persisted;
    }),
    getById: vi.fn(),
    listOpen: vi.fn(async () => items),
  };
  const members = {
    resolveByWebid: vi.fn(async () => null),
  };
  const ctrl = wireChat({
    agent, itemStore, members,
    muted: new Set(),
    metrics: { record: vi.fn() },
    localActor:    'urn:me',
    localStableId: 'me-stable',
    emitEnvelopeType,
    acceptedEnvelopeTypes,
  });
  return { agent, itemStore, oneWayCalls, items, messageHandlers, ctrl };
}

describe('chat-p2p — envelope type config', () => {
  it('emits the configured envelope type', async () => {
    const h = buildHarness({
      acceptedEnvelopeTypes: ['p2p-chat', 'pinboard-chat'],
      emitEnvelopeType:      'p2p-chat',
    });
    await h.ctrl.send({
      toPubKey: 'peer-1', threadId: 't1', body: 'hi',
      subtype: 'chat-message',
    });
    const env = h.oneWayCalls[0].env;
    const data = env.parts[0].data;
    expect(data.type).toBe('p2p-chat');
    expect(data.subtype).toBe('chat-message');
  });

  it('accepts both p2p-chat AND pinboard-chat by default', async () => {
    const h = buildHarness({
      acceptedEnvelopeTypes: ['p2p-chat', 'pinboard-chat'],
      emitEnvelopeType:      'p2p-chat',
    });
    // Inject a legacy 'pinboard-chat' envelope (a broadcast post: a kind this receiver keeps a row of).
    const legacyEnv = {
      from: 'peer-pub',
      parts: [{ type: 'DataPart', data: {
        type:     'pinboard-chat',
        subtype:  'broadcast-post',
        postId:   'post-1',
        text:     'legacy hello',
        fromWebid: 'urn:peer',
        nonce:    'n1',
      }}],
    };
    await h.messageHandlers[0](legacyEnv);
    expect(h.itemStore.addItems).toHaveBeenCalledOnce();
    expect(h.items[0].type).toBe('request');

    // Then a new 'p2p-chat' envelope.
    const newEnv = {
      from: 'peer-pub',
      parts: [{ type: 'DataPart', data: {
        type:     'p2p-chat',
        subtype:  'broadcast-post',
        postId:   'post-2',
        text:     'new hello',
        fromWebid: 'urn:peer',
        nonce:    'n2',
      }}],
    };
    await h.messageHandlers[0](newEnv);
    expect(h.items.length).toBe(2);
  });

  it('rejects non-accepted envelope types', async () => {
    const h = buildHarness({
      acceptedEnvelopeTypes: ['p2p-chat'],
      emitEnvelopeType:      'p2p-chat',
    });
    const evilEnv = {
      from: 'peer-pub',
      parts: [{ type: 'DataPart', data: {
        type: 'tasks-chat',     // NOT in acceptedEnvelopeTypes
        subtype: 'broadcast-post',
        postId: 'post-3',
        text: 'spoofed',
        fromWebid: 'urn:peer',
        nonce: 'n3',
      }}],
    };
    await h.messageHandlers[0](evilEnv);
    expect(h.itemStore.addItems).not.toHaveBeenCalled();
  });

  it('Pinboard-style config: emit pinboard-chat, accept both', async () => {
    const h = buildHarness({
      acceptedEnvelopeTypes: ['p2p-chat', 'pinboard-chat'],
      emitEnvelopeType:      'pinboard-chat',          // Pinboard's back-compat sender
    });
    await h.ctrl.send({
      toPubKey: 'peer-1', threadId: 't1', body: 'hi',
      subtype: 'chat-message',
    });
    expect(h.oneWayCalls[0].env.parts[0].data.type).toBe('pinboard-chat');
  });

  it('default config emits p2p-chat + accepts both', async () => {
    const h = buildHarness({});   // no overrides
    await h.ctrl.send({
      toPubKey: 'peer-1', threadId: 't1', body: 'hi',
      subtype: 'chat-message',
    });
    expect(h.oneWayCalls[0].env.parts[0].data.type).toBe('p2p-chat');

    // Legacy reader path still works.
    await h.messageHandlers[0]({
      from: 'peer-pub',
      parts: [{ type: 'DataPart', data: {
        type: 'pinboard-chat', subtype: 'chat-message', threadId: 't1',
        body: 'legacy', fromWebid: 'urn:p', nonce: 'nz',
      }}],
    });
    expect(h.items.length).toBe(0);     // accepted, and nothing stored (a chat turn's record is the contact thread)
  });
});
