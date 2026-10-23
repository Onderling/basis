/**
 * ollama.test.js — Phase 3 unit tests for the Ollama provider's
 * response-parsing helpers.  The full provider is exercised in the
 * llm-roundtrip e2e via a fake provider; here we lock down the
 * native-tool-calls / loose-JSON / noise / free-text branches.
 */
import { describe, it, expect } from 'vitest';

import { parseOpenAIChatResponse, parseLooseToolCall, ollamaProvider } from '../../src/llm/providers/ollama.js';

describe('ollama — parseOpenAIChatResponse', () => {
  it('extracts a native tool call', () => {
    const result = parseOpenAIChatResponse({
      choices: [{
        message: {
          tool_calls: [{
            function: { name: 'addItem', arguments: JSON.stringify({ type: 'shopping', text: 'bread' }) },
          }],
        },
      }],
    });
    expect(result.toolCall).toEqual({ id: 'addItem', args: { type: 'shopping', text: 'bread' } });
    expect(result.classification).toBe('actionable');
  });

  it('handles tool_calls.arguments as an object (not stringified)', () => {
    const result = parseOpenAIChatResponse({
      choices: [{
        message: {
          tool_calls: [{
            function: { name: 'listOpenItems', arguments: { type: 'shopping' } },
          }],
        },
      }],
    });
    expect(result.toolCall.args).toEqual({ type: 'shopping' });
  });

  it('falls back to loose JSON parsing when no native tool call', () => {
    const result = parseOpenAIChatResponse({
      choices: [{ message: { content: '{"tool":"addItem","args":{"type":"shopping","text":"milk"}}' } }],
    });
    expect(result.toolCall).toEqual({ id: 'addItem', args: { type: 'shopping', text: 'milk' } });
  });

  it('classifies "noise" as noise', () => {
    const result = parseOpenAIChatResponse({ choices: [{ message: { content: 'noise' } }] });
    expect(result.classification).toBe('noise');
    expect(result.toolCall).toBeNull();
  });

  it('classifies a JSON-shaped {"classification":"noise"} as noise', () => {
    const result = parseOpenAIChatResponse({
      choices: [{ message: { content: '{"classification":"noise"}' } }],
    });
    expect(result.classification).toBe('noise');
  });

  it('falls through to free-text reply', () => {
    const result = parseOpenAIChatResponse({
      choices: [{ message: { content: 'Sure, I can help with that.' } }],
    });
    expect(result.toolCall).toBeNull();
    expect(result.classification).toBeNull();
    expect(result.replyText).toBe('Sure, I can help with that.');
  });

  it('handles empty/missing choices gracefully', () => {
    const result = parseOpenAIChatResponse({});
    expect(result.toolCall).toBeNull();
    expect(result.replyText).toBeNull();
  });
});

describe('ollama — parseLooseToolCall', () => {
  it('parses a clean JSON tool call', () => {
    const result = parseLooseToolCall('{"tool":"addItem","args":{"text":"bread"}}');
    expect(result).toEqual({ id: 'addItem', args: { text: 'bread' } });
  });

  it('returns null for non-object text', () => {
    expect(parseLooseToolCall('hello world')).toBeNull();
  });

  it('returns null when the JSON has no `tool` field', () => {
    expect(parseLooseToolCall('{"foo":"bar"}')).toBeNull();
  });

  it('returns null when args is not an object', () => {
    expect(parseLooseToolCall('{"tool":"x","args":"oops"}')).toBeNull();
  });

  it('returns null on malformed JSON', () => {
    expect(parseLooseToolCall('{not valid')).toBeNull();
  });
});

describe('ollamaProvider — wiring', () => {
  it('builds a provider with id "ollama" and requiresKey false', () => {
    const p = ollamaProvider({ baseUrl: 'http://localhost:11434' });
    expect(p.id).toBe('ollama');
    expect(p.requiresKey).toBe(false);
  });

  it('POSTs to /v1/chat/completions on the configured baseUrl, with model + messages', async () => {
    let captured;
    const fakeFetch = async (url, init) => {
      captured = { url, body: JSON.parse(init.body) };
      return {
        ok: true,
        async json() { return { choices: [{ message: { content: 'noise' } }] }; },
      };
    };
    const p = ollamaProvider({ baseUrl: 'http://example/', model: 'qwen2.5:3b-instruct', fetchFn: fakeFetch });
    await p.invoke({ system: 's', messages: [{ role: 'user', content: 'hi' }] });
    expect(captured.url).toBe('http://example/v1/chat/completions');
    expect(captured.body.model).toBe('qwen2.5:3b-instruct');
    expect(captured.body.messages[0]).toEqual({ role: 'system', content: 's' });
    expect(captured.body.stream).toBe(false);
  });

  it('throws PROVIDER_ERROR on non-ok response', async () => {
    const fakeFetch = async () => ({
      ok: false, status: 500,
      async text() { return 'oops'; },
    });
    const p = ollamaProvider({ fetchFn: fakeFetch });
    await expect(p.invoke({ system: 's', messages: [{ role: 'user', content: 'x' }] }))
      .rejects.toThrow(/ollama: 500/);
  });
});
