import { describe, it, expect, vi } from 'vitest';
import { LlmClient, mockProvider } from '@onderling/llm-client';
import { ChatAgent, InMemoryBridge } from '../src/index.js';

const SYS = 'You are a test assistant.';

const TOOL_CATALOGUE = [
  { id: 'addItems', description: 'Add items', schema: { type: 'object' } },
  { id: 'markComplete', description: 'Mark items complete', schema: { type: 'object' } },
];

function buildAgent({ responses, toolHandlers = {}, contextBuilder, ...extra } = {}) {
  const bridge = new InMemoryBridge({ id: 'memory' });
  const llm = new LlmClient({ provider: mockProvider({ responses: responses ?? [{ replyText: 'ok', classification: null }] }) });
  const agent = new ChatAgent({
    bridges:        [bridge],
    llm,
    toolCatalogue:    TOOL_CATALOGUE,
    toolHandlers,
    systemPrompt:   SYS,
    contextBuilder: contextBuilder ?? (async () => 'No open items.'),
    ...extra,
  });
  return { agent, bridge };
}

describe('ChatAgent — basics', () => {
  it('starts and stops idempotently', async () => {
    const { agent } = buildAgent();
    await agent.start();
    await agent.start();
    await agent.stop();
    await agent.stop();
  });

  it('rejects construction without required fields', () => {
    // bridges is optional (headless mode supported); llm is required.
    expect(() => new ChatAgent({})).toThrow(/llm/);
  });

  it('accepts headless mode (no bridges) for embedded use', async () => {
    const llm = new LlmClient({ provider: mockProvider({ responses: [{ replyText: 'ok' }] }) });
    const agent = new ChatAgent({
      llm,
      toolCatalogue:    TOOL_CATALOGUE,
      toolHandlers:   {},
      systemPrompt:   SYS,
      contextBuilder: async () => '',
    });
    // start()/stop() are no-ops in headless mode.
    await agent.start();
    await agent.stop();
    // processMessage is the headless entry point.
    const result = await agent.processMessage({
      bridgeId: 'x', chatId: 'c1', messageId: 'm1', isAddressed: true,
      sender: { bridgeUid: 'u1', displayName: 'U' }, text: 'hi',
    });
    expect(result.replies[0].text).toBe('ok');
  });
});

describe('ChatAgent — message handling', () => {
  it('runs the LLM with a free-text reply and posts it', async () => {
    const { agent, bridge } = buildAgent({
      responses: [{ replyText: 'Hi there!', classification: null }],
    });
    await agent.start();
    await bridge.simulateIncoming({ text: 'hi' });

    expect(bridge.outbox).toHaveLength(1);
    expect(bridge.outbox[0].text).toBe('Hi there!');
  });

  it('emits a reply event', async () => {
    const events = [];
    const { agent, bridge } = buildAgent({
      responses: [{ replyText: 'Hi!', classification: null }],
    });
    agent.on('reply', (e) => events.push(e));
    await agent.start();
    await bridge.simulateIncoming({ text: 'hi' });

    expect(events).toHaveLength(1);
    expect(events[0].text).toBe('Hi!');
  });

  it('skips messages with isAddressed=false', async () => {
    const { agent, bridge } = buildAgent({
      responses: [{ replyText: 'should not run', classification: null }],
    });
    await agent.start();
    await bridge.simulateIncoming({ text: 'hi', isAddressed: false });
    expect(bridge.outbox).toHaveLength(0);
  });
});

describe('ChatAgent — tool dispatch', () => {
  it('dispatches a single tool call and combines its reply', async () => {
    const handler = vi.fn(async (args) => ({
      reply: `added ${args.items.length} items`,
      data:  { ids: ['x', 'y'] },
    }));
    const { agent, bridge } = buildAgent({
      responses: [{
        toolCall:       { id: 'addItems', args: { items: [{ text: 'a' }, { text: 'b' }] } },
        classification: 'actionable',
      }],
      toolHandlers: { addItems: handler },
    });

    await agent.start();
    await bridge.simulateIncoming({ text: 'add a and b' });

    expect(handler).toHaveBeenCalledOnce();
    expect(bridge.outbox[0].text).toBe('added 2 items');
  });

  it('dispatches multiple tool calls in order', async () => {
    const calls = [];
    const handlers = {
      addItems:     vi.fn(async () => { calls.push('add');     return { reply: 'added' }; }),
      markComplete: vi.fn(async () => { calls.push('done');    return { reply: 'completed' }; }),
    };
    const { agent, bridge } = buildAgent({
      responses: [{
        toolCall:  { id: 'addItems', args: {} },
        toolCalls: [
          { id: 'addItems',     args: {} },
          { id: 'markComplete', args: {} },
        ],
        classification: 'actionable',
      }],
      toolHandlers: handlers,
    });

    await agent.start();
    await bridge.simulateIncoming({ text: 'add x and complete y' });

    expect(calls).toEqual(['add', 'done']);
    // Each tool reply now lands as its own bridge message — preserves
    // per-reply buttons / metadata.  Apps that want one consolidated
    // message can join them at the tool-handler layer.
    // Consecutive text-only replies are collated into one bridge
    // message — keeps per-tool confirmations from spamming the chat.
    expect(bridge.outbox.map((m) => m.text)).toEqual(['added\ncompleted']);
  });

  it('emits tool-call events', async () => {
    const events = [];
    const { agent, bridge } = buildAgent({
      responses: [{
        toolCall:       { id: 'addItems', args: { items: [] } },
        classification: 'actionable',
      }],
      toolHandlers: { addItems: async () => ({ reply: 'ok', data: { count: 0 } }) },
    });
    agent.on('tool-call', (e) => events.push(e));
    await agent.start();
    await bridge.simulateIncoming({ text: 'add' });

    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      tool: 'addItems',
      args: { items: [] },
      result: { reply: 'ok', data: { count: 0 } },
    });
  });

  it('emits error event on unknown tool but still continues', async () => {
    const errors = [];
    const { agent, bridge } = buildAgent({
      responses: [{
        toolCall:       { id: 'doesNotExist', args: {} },
        classification: 'actionable',
      }],
    });
    agent.on('error', (e) => errors.push(e));
    await agent.start();
    await bridge.simulateIncoming({ text: 'x' });

    expect(errors[0].error.message).toMatch(/unknown tool/);
  });

  it('emits error event when handler throws', async () => {
    const errors = [];
    const { agent, bridge } = buildAgent({
      responses: [{
        toolCall:       { id: 'addItems', args: {} },
        classification: 'actionable',
      }],
      toolHandlers: { addItems: async () => { throw new Error('handler-broke'); } },
    });
    agent.on('error', (e) => errors.push(e));
    await agent.start();
    await bridge.simulateIncoming({ text: 'x' });

    expect(errors[0].error.message).toBe('handler-broke');
  });
});

describe('ChatAgent — sessions + context', () => {
  it('builds context once per session and reuses it', async () => {
    const ctxBuilder = vi.fn(async () => 'snapshot');
    const { agent, bridge } = buildAgent({
      responses: [
        { replyText: 'one', classification: null },
        { replyText: 'two', classification: null },
      ],
      contextBuilder: ctxBuilder,
    });
    await agent.start();
    await bridge.simulateIncoming({ text: 'a' });
    await bridge.simulateIncoming({ text: 'b' });

    expect(ctxBuilder).toHaveBeenCalledOnce();
  });

  it('rebuilds context for a new session after TTL expiry', async () => {
    const ctxBuilder = vi.fn(async () => 'snapshot');
    const { agent, bridge } = buildAgent({
      responses: [
        { replyText: 'one', classification: null },
        { replyText: 'two', classification: null },
      ],
      contextBuilder: ctxBuilder,
      sessionTtlMs:   1,                 // expire immediately
    });
    await agent.start();
    await bridge.simulateIncoming({ text: 'a' });
    await new Promise((r) => setTimeout(r, 5));
    await bridge.simulateIncoming({ text: 'b' });

    expect(ctxBuilder).toHaveBeenCalledTimes(2);
  });

  it('memberResolver fills in webid when bridge does not', async () => {
    const resolver = vi.fn(async (chatId, sender) => ({
      webid:       `https://id.example/${sender.bridgeUid}`,
      displayName: sender.displayName,
    }));
    const handler = vi.fn(async () => ({ reply: 'ok' }));
    const { agent, bridge } = buildAgent({
      responses: [{
        toolCall:       { id: 'addItems', args: {} },
        classification: 'actionable',
      }],
      toolHandlers:   { addItems: handler },
      memberResolver: resolver,
    });

    await agent.start();
    await bridge.simulateIncoming({
      text: 'x',
      sender: { bridgeUid: 'u42', displayName: 'Anne' },
    });

    expect(resolver).toHaveBeenCalledOnce();
    const ctx = handler.mock.calls[0][1];
    expect(ctx.actorWebid).toBe('https://id.example/u42');
    expect(ctx.actorDisplayName).toBe('Anne');
  });
});

describe('ChatAgent — outbound dispatch', () => {
  it('dispatch() posts to the named bridge', async () => {
    const { agent, bridge } = buildAgent();
    await agent.start();
    await agent.dispatch('chat-A', 'hello!');
    expect(bridge.outbox).toEqual([{ chatId: 'chat-A', text: 'hello!' }]);
  });
});

describe('ChatAgent — schema fallback for typo\'d tool names', () => {
  it('routes an unknown tool to the only schema-matching catalogue entry', async () => {
    const addItems = vi.fn().mockResolvedValue({});
    const markComplete = vi.fn().mockResolvedValue({});
    const catalogue = [
      { id: 'addItems',     schema: { type: 'object', required: ['listName', 'item']  } },
      { id: 'markComplete', schema: { type: 'object', required: ['listName', 'match'] } },
    ];
    const bridge = new InMemoryBridge({ id: 'memory' });
    const agent = new ChatAgent({
      bridges:        [bridge],
      llm:            new LlmClient({ provider: mockProvider({ responses: [{
        toolCall:       { id: 'addodelist', args: { listName: 'b', item: 'kaas' } },
        classification: 'actionable',
      }] }) }),
      toolCatalogue:    catalogue,
      toolHandlers:   { addItems, markComplete },
      systemPrompt:   SYS,
      contextBuilder: async () => '',
    });
    agent.on('error', () => {});  // schema-fallback emits an info-level error
    await agent.start();
    await bridge.simulateIncoming({ text: 'voeg kaas toe' });
    expect(addItems).toHaveBeenCalledTimes(1);
    expect(markComplete).not.toHaveBeenCalled();
  });

  it('drops the call when args match more than one tool', async () => {
    const handler = vi.fn();
    const catalogue = [
      { id: 'addItems', schema: { type: 'object', required: ['listName'] } },
      { id: 'showList', schema: { type: 'object', required: ['listName'] } },
    ];
    const bridge = new InMemoryBridge({ id: 'memory' });
    const agent = new ChatAgent({
      bridges:        [bridge],
      llm:            new LlmClient({ provider: mockProvider({ responses: [{
        toolCall:       { id: 'mystery', args: { listName: 'b' } },
        classification: 'actionable',
      }] }) }),
      toolCatalogue:    catalogue,
      toolHandlers:   { addItems: handler, showList: handler },
      systemPrompt:   SYS,
      contextBuilder: async () => '',
    });
    agent.on('error', () => {});
    await agent.start();
    await bridge.simulateIncoming({ text: 'x' });
    expect(handler).not.toHaveBeenCalled();
  });
});

describe('ChatAgent — duplicate tool calls in one turn', () => {
  it('dedupes identical {id, args} calls before dispatching', async () => {
    const handler = vi.fn().mockResolvedValue({});
    const { agent, bridge } = buildAgent({
      responses: [{
        toolCalls: [
          { id: 'addItems', args: { listName: 'b', item: 'kaas' } },
          { id: 'addItems', args: { listName: 'b', item: 'kaas' } },
          { id: 'addItems', args: { item: 'kaas', listName: 'b' } }, // key-order swap
        ],
        classification: 'actionable',
      }],
      toolHandlers: { addItems: handler },
    });
    await agent.start();
    await bridge.simulateIncoming({ text: 'voeg kaas toe' });
    expect(handler).toHaveBeenCalledTimes(1);
  });
});

describe('ChatAgent — suppressFreeTextOnToolCalls', () => {
  it('drops the LLM free text when tools fired and option is on', async () => {
    const { agent, bridge } = buildAgent({
      responses: [{
        toolCall:       { id: 'addItems', args: { item: 'x' } },
        replyText:      'Some meta-explanation prose...',
        classification: 'actionable',
      }],
      toolHandlers:   { addItems: vi.fn().mockResolvedValue({}) },
      suppressFreeTextOnToolCalls: true,
    });
    await agent.start();
    await bridge.simulateIncoming({ text: 'voeg x toe' });
    // No free-text reply should reach the bridge.
    expect(bridge.outbox).toEqual([]);
  });

  it('keeps the LLM free text when no tool fired even with the option on', async () => {
    const { agent, bridge } = buildAgent({
      responses: [{ replyText: 'Hi!', classification: null }],
      suppressFreeTextOnToolCalls: true,
    });
    await agent.start();
    await bridge.simulateIncoming({ text: 'hoi' });
    expect(bridge.outbox).toEqual([{ chatId: 'chat-1', text: 'Hi!' }]);
  });
});

describe('ChatAgent — history records silent tool calls', () => {
  it('appends an assistant turn even when tools fired with no replyText', async () => {
    // Captures every `messages` array the LLM sees, in order, so we
    // can assert the assistant turn lands in history.
    const seenHistories = [];
    const responses = [
      { toolCall: { id: 'addItems', args: { item: 'melk'  } }, classification: 'actionable', replyText: null },
      { toolCall: { id: 'addItems', args: { item: 'afwas' } }, classification: 'actionable', replyText: null },
    ];
    let cursor = 0;
    const provider = {
      id: 'mock', requiresKey: false,
      async invoke({ messages }) {
        seenHistories.push(messages.map((m) => ({ role: m.role, content: m.content })));
        return responses[cursor++];
      },
    };
    const bridge = new InMemoryBridge({ id: 'memory' });
    const agent = new ChatAgent({
      bridges:        [bridge],
      llm:            new LlmClient({ provider }),
      toolCatalogue:    TOOL_CATALOGUE,
      toolHandlers:   { addItems: vi.fn().mockResolvedValue({}) },
      systemPrompt:   SYS,
      contextBuilder: async () => '',
    });
    await agent.start();

    await bridge.simulateIncoming({ text: 'voeg melk toe' });
    await bridge.simulateIncoming({ text: 'zet afwas erbij' });

    // First turn sees only the first user message.
    expect(seenHistories[0]).toEqual([
      { role: 'user', content: 'voeg melk toe' },
    ]);
    // Second turn MUST see the assistant's prior action recorded —
    // otherwise the LLM thinks turn 1 was never handled and replays it.
    expect(seenHistories[1]).toHaveLength(3);
    expect(seenHistories[1][0]).toEqual({ role: 'user', content: 'voeg melk toe' });
    expect(seenHistories[1][1].role).toBe('assistant');
    expect(seenHistories[1][1].content).toMatch(/addItems/);
    expect(seenHistories[1][1].content).toMatch(/melk/);
    expect(seenHistories[1][2]).toEqual({ role: 'user', content: 'zet afwas erbij' });
  });
});
