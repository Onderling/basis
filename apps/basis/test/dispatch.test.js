/**
 * basis — dispatch tests. v0.1.
 */
import { describe, it, expect, vi } from 'vitest';

import { runDispatch } from '../src/dispatch.js';

const readyDispatch = {
  kind:       'ready',
  opId:       'markComplete',
  args:       { choreText: 'dishwasher' },
  appOrigin:  'household',
  threadId:   't-1',
  replyShape: 'text',
};

describe('runDispatch — happy path', () => {
  it('calls callSkill(appOrigin, opId, args) and wraps the payload', async () => {
    const callSkill = vi.fn(async () => ({ ok: true, itemId: 'chore-42' }));
    const reply = await runDispatch(readyDispatch, callSkill);

    expect(callSkill).toHaveBeenCalledOnce();
    expect(callSkill).toHaveBeenCalledWith(
      'household', 'markComplete', { choreText: 'dishwasher' },
    );

    expect(reply).toEqual({
      payload:  { ok: true, itemId: 'chore-42' },
      shape:    'text',
      threadId: 't-1',
    });
    expect(reply.error).toBeUndefined();
  });

  it('honours the replyShape from the dispatch (Q28-effective)', async () => {
    const listDispatch = { ...readyDispatch, replyShape: 'list' };
    const callSkill = async () => ({ items: [] });
    const reply = await runDispatch(listDispatch, callSkill);
    expect(reply.shape).toBe('list');
  });

  it('passes threadId through; nullable', async () => {
    const noThread = { ...readyDispatch, threadId: null };
    const reply = await runDispatch(noThread, async () => ({ ok: true }));
    expect(reply.threadId).toBeNull();
  });

  it('payload can be any shape (opaque to chat shell)', async () => {
    const stringPayload = await runDispatch(readyDispatch, async () => 'hello');
    expect(stringPayload.payload).toBe('hello');

    const arrayPayload = await runDispatch(readyDispatch, async () => [1, 2, 3]);
    expect(arrayPayload.payload).toEqual([1, 2, 3]);

    const nullPayload = await runDispatch(readyDispatch, async () => null);
    expect(nullPayload.payload).toBeNull();
  });
});

describe('runDispatch — error path', () => {
  it('catches thrown errors + surfaces them as Reply.error (no rethrow)', async () => {
    const reply = await runDispatch(readyDispatch, async () => {
      throw new Error('skill exploded');
    });
    expect(reply.error).toEqual({ code: 'dispatch-error', message: 'skill exploded' });
    expect(reply.payload).toBeNull();
    expect(reply.shape).toBe('text');         // errors always text in v0.1
    expect(reply.threadId).toBe('t-1');
  });

  it('honours err.code when the thrown error carries one', async () => {
    class CustomError extends Error {
      constructor(msg, code) { super(msg); this.code = code; }
    }
    const reply = await runDispatch(readyDispatch, async () => {
      throw new CustomError('not authorised', 'unauthorised');
    });
    expect(reply.error).toEqual({ code: 'unauthorised', message: 'not authorised' });
  });

  it('handles non-Error thrown values gracefully', async () => {
    const reply = await runDispatch(readyDispatch, async () => {
      throw 'string error';   // eslint-disable-line no-throw-literal
    });
    expect(reply.error.message).toBe('string error');
    expect(reply.error.code).toBe('dispatch-error');
  });
});

describe('runDispatch — input validation', () => {
  it('throws when the dispatch is not "ready"', async () => {
    await expect(runDispatch({ kind: 'needsConfirm' }, async () => {})).rejects.toThrow(
      /expected ready dispatch/,
    );
    await expect(runDispatch({ kind: 'unknown' }, async () => {})).rejects.toThrow();
    await expect(runDispatch(null, async () => {})).rejects.toThrow();
  });

  it('throws when callSkill is not a function', async () => {
    await expect(runDispatch(readyDispatch, 'not-a-function')).rejects.toThrow(
      /callSkill must be a function/,
    );
    await expect(runDispatch(readyDispatch, null)).rejects.toThrow();
  });
});

describe('runDispatch — integration with parser + router + manifestMerge', () => {
  it('end-to-end: parse → resolve → dispatch on a real-ish catalogue', async () => {
    const { parseInput }      = await import('../src/parser.js');
    const { mergeManifests }  = await import('../src/manifestMerge.js');
    const { resolveDispatch } = await import('../src/router.js');

    const m = {
      app:       'household', itemTypes: ['chore'],
      operations: [{
        id: 'markComplete', verb: 'complete',
        params: [{ name: 'choreText', kind: 'string', required: true }],
        surfaces: { slash: { command: '/done' }, chat: { reply: 'text' } },
      }],
      views: [{ id: 'tasks', title: 'C', type: 'chore' }],
    };
    const catalogue = mergeManifests([{ manifest: m }]);

    const calls = [];
    const callSkill = async (appOrigin, opId, args) => {
      calls.push({ appOrigin, opId, args });
      return { ok: true };
    };

    const parse = parseInput('/done dishwasher', catalogue, { threadId: 't-9' });
    const ready = resolveDispatch(parse, catalogue);
    expect(ready.kind).toBe('ready');

    const reply = await runDispatch(ready, callSkill);
    expect(reply.payload).toEqual({ ok: true });
    expect(reply.shape).toBe('text');
    expect(reply.threadId).toBe('t-9');
    expect(calls).toEqual([
      { appOrigin: 'household', opId: 'markComplete', args: { choreText: 'dishwasher' } },
    ]);
  });
});
