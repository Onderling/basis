import { describe, it, expect } from 'vitest';
import { buildToolDescriptors, interpretToCommand } from '../../src/v2/interpretCommand.js';

// The LLM is host-supplied + duck-typed (`llm.invoke(req) → result`), so the test fakes it directly
// rather than depending on @onderling/llm-client — mirroring how the host injects the client.
const llmReturning = (result) => ({ invoke: async () => result });
const llmInspecting = (capture) => ({ invoke: async (req) => { capture(req); return { toolCall: null, raw: {} }; } });

// A merged-catalogue stand-in: just the `opsById` Map the descriptors are built from.
function catalogueOf(ops) {
  return { opsById: new Map(ops.map((o) => [o.key ?? o.id, { op: o, appOrigin: o.appOrigin ?? 'household' }])) };
}

const CHORES = catalogueOf([
  { id: 'addTask', params: [{ name: 'title', kind: 'string', required: true }],
    surfaces: { chat: { hint: 'add a task to the list' } } },
  { id: 'markComplete', verb: 'complete', params: [{ name: 'choreId', kind: 'string', required: true }],
    surfaces: { slash: { command: '/done' }, chat: { hint: 'mark a chore complete' } } },
  { id: 'listOpen', params: [], surfaces: { chat: { reply: 'list' } } },
]);

describe('buildToolDescriptors', () => {
  it('projects ops → {id, description, schema} with required params', () => {
    const tools = buildToolDescriptors(CHORES);
    expect(tools.map((t) => t.id)).toEqual(['addTask', 'markComplete', 'listOpen']);
    const add = tools.find((t) => t.id === 'addTask');
    expect(add.description).toBe('add a task to the list');
    expect(add.schema).toEqual({ type: 'object', properties: { title: { type: 'string' } }, required: ['title'] });
    // no params → no required key
    expect(tools.find((t) => t.id === 'listOpen').schema).toEqual({ type: 'object', properties: {} });
  });

  it('passes enum values into the param schema (so the model knows the valid choices)', () => {
    const cat = catalogueOf([
      { id: 'addItem', verb: 'add', surfaces: { chat: { hint: 'add to a list' } },
        params: [
          { name: 'type', kind: 'enum', of: ['shopping', 'errand', 'repair', 'schedule'], required: true },
          { name: 'text', kind: 'string', required: true },
        ] },
    ]);
    const t = buildToolDescriptors(cat).find((x) => x.id === 'addItem');
    expect(t.schema.properties.type.enum).toEqual(['shopping', 'errand', 'repair', 'schedule']);
    expect(t.schema.required).toEqual(['type', 'text']);
  });

  it('falls back to verb / id for the description and tolerates a missing catalogue', () => {
    expect(buildToolDescriptors(null)).toEqual([]);
    expect(buildToolDescriptors({}).length).toBe(0);
    const t = buildToolDescriptors(CHORES).find((x) => x.id === 'markComplete');
    expect(t.description).toBe('mark a chore complete');
  });
});

describe('interpretToCommand', () => {
  it('returns {opId,args} when the LLM tool-calls', async () => {
    const llm = llmReturning({ toolCall: { id: 'addTask', args: { title: 'milk' } }, classification: 'actionable' });
    const cmd = await interpretToCommand('add milk to the list', { catalogue: CHORES, llm });
    expect(cmd).toEqual({ opId: 'addTask', args: { title: 'milk' } });
  });

  it('returns {reply} when the LLM emits a free reply (no tool call) — bot can converse', async () => {
    const llm = llmReturning({ toolCall: null, replyText: 'nice weather' });
    const cmd = await interpretToCommand('how are you?', { catalogue: CHORES, llm });
    expect(cmd).toEqual({ reply: 'nice weather' });
  });

  it('returns null when there is neither a tool call nor any reply text', async () => {
    const llm = llmReturning({ toolCall: null, replyText: '' });
    const cmd = await interpretToCommand('…', { catalogue: CHORES, llm });
    expect(cmd).toBeNull();
  });

  it('threads prior conversation turns (history) into the LLM messages', async () => {
    let seenMessages = null;
    const llm = llmInspecting((req) => { seenMessages = req.messages; });
    await interpretToCommand('shopping', {
      catalogue: CHORES, llm,
      history: [{ role: 'user', content: 'what is on the list' }, { role: 'assistant', content: 'which list?' }],
    });
    expect(seenMessages.map((m) => m.role)).toEqual(['user', 'assistant', 'user']);
    expect(seenMessages[2].content).toBe('shopping');
  });

  it('passes the catalogue ops to the LLM as tools', async () => {
    let seenTools = null;
    const llm = llmInspecting((req) => { seenTools = req.tools; });
    await interpretToCommand('do something', { catalogue: CHORES, llm });
    expect(seenTools.map((t) => t.id)).toEqual(['addTask', 'markComplete', 'listOpen']);
  });

  it('never calls the LLM when text is blank, llm missing, or catalogue empty', async () => {
    let called = 0;
    const llm = { invoke: async () => { called++; return { toolCall: null, raw: {} }; } };
    expect(await interpretToCommand('   ', { catalogue: CHORES, llm })).toBeNull();
    expect(await interpretToCommand('x', { catalogue: CHORES, llm: null })).toBeNull();
    expect(await interpretToCommand('x', { catalogue: catalogueOf([]), llm })).toBeNull();
    expect(called).toBe(0);
  });

  it('coerces a missing args object to {}', async () => {
    const llm = llmReturning({ toolCall: { id: 'listOpen' } });   // no args
    const cmd = await interpretToCommand('what is open?', { catalogue: CHORES, llm });
    expect(cmd).toEqual({ opId: 'listOpen', args: {} });
  });

  it('weaves RAG context into the system prompt (strings, entries, and {entry,score})', async () => {
    let seenSystem = null;
    const llm = llmInspecting((req) => { seenSystem = req.system; });
    await interpretToCommand('add milk', { catalogue: CHORES, llm, context: [
      'wash the dishes',
      { meaning: 'buy bread' },
      { entry: { label: 'take out bins' }, score: 0.8 },
    ] });
    expect(seenSystem).toMatch(/Relevant items already in this circle/);
    expect(seenSystem).toMatch(/wash the dishes/);
    expect(seenSystem).toMatch(/buy bread/);
    expect(seenSystem).toMatch(/take out bins/);
  });

  it('no context → the base system prompt is unchanged', async () => {
    let seenSystem = null;
    const llm = llmInspecting((req) => { seenSystem = req.system; });
    await interpretToCommand('x', { catalogue: CHORES, llm });
    expect(seenSystem).not.toMatch(/Relevant items/);
  });
});
