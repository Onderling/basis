import { describe, it, expect, vi } from 'vitest';
import { createTokenGate } from '../../src/v2/tokenGate.js';

describe('createTokenGate', () => {
  it('blank input → skip', async () => {
    const g = createTokenGate({});
    expect((await g.evaluate('   ')).via).toBe('skip');
  });

  it('a skip rule short-circuits the LLM (clearly not for the bot)', async () => {
    const retrieve = vi.fn();
    const g = createTokenGate({ rules: [{ name: 'greeting', test: /^(hi|hoi|hey)\b/i }], retrieve });
    const r = await g.evaluate('hoi allemaal');
    expect(r.via).toBe('skip');
    expect(r.reason).toBe('greeting');
    expect(retrieve).not.toHaveBeenCalled();          // the LLM (and retrieval) is never reached
  });

  it('a route rule dispatches a command directly (no LLM)', async () => {
    const retrieve = vi.fn();
    const g = createTokenGate({
      rules: [{ name: 'add', test: /^add\s+(.+)/i, command: (t) => ({ opId: 'addTask', args: { title: t.replace(/^add\s+/i, '') } }) }],
      retrieve,
    });
    const r = await g.evaluate('add milk to the list');
    expect(r.via).toBe('rule');
    expect(r.command).toEqual({ opId: 'addTask', args: { title: 'milk to the list' } });
    expect(retrieve).not.toHaveBeenCalled();
  });

  it('a route rule that cannot build a command falls through to the LLM', async () => {
    const g = createTokenGate({ rules: [{ name: 'maybe', test: /maybe/, command: () => null }] });
    expect((await g.evaluate('maybe do something')).via).toBe('llm');
  });

  it('no rule match → LLM with retrieved RAG context (capped)', async () => {
    const hits = Array.from({ length: 8 }, (_, i) => ({ id: `c${i}`, score: 1 - i * 0.1 }));
    const retrieve = vi.fn(async () => hits);
    const g = createTokenGate({ rules: [], retrieve, maxContext: 3 });
    const r = await g.evaluate('what did we decide about the dishes?');
    expect(r.via).toBe('llm');
    expect(r.context).toHaveLength(3);                 // capped at maxContext
    expect(r.context[0].id).toBe('c0');
    expect(retrieve).toHaveBeenCalledWith('what did we decide about the dishes?', {});
  });

  it('no retriever → LLM with empty context', async () => {
    const g = createTokenGate({ rules: [] });
    expect(await g.evaluate('free text')).toEqual({ via: 'llm', context: [] });
  });

  it('first matching rule wins (order matters)', async () => {
    const g = createTokenGate({ rules: [
      { name: 'skip-q', test: /\?$/, reason: 'question' },
      { name: 'add', test: /^add/i, command: (t) => ({ opId: 'addTask', args: { title: t } }) },
    ] });
    expect((await g.evaluate('add milk?')).via).toBe('skip');   // the ? rule comes first
  });

  it('supports a function test with ctx', async () => {
    const g = createTokenGate({ rules: [{ name: 'off', test: (t, ctx) => ctx.muted === true, reason: 'muted' }] });
    expect((await g.evaluate('anything', { muted: true })).via).toBe('skip');
    expect((await g.evaluate('anything', { muted: false })).via).toBe('llm');
  });
});
