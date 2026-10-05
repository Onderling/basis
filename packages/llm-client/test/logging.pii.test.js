/**
 * LlmClient — @onderling/logger coverage + PII-safety (logging, LLM path).
 *
 * Drives invoke() success + error through a mock provider and asserts:
 *   1. llm.request / llm.response / llm.error land in `dumpLogs()`;
 *   2. every field is a PII-SAFE scalar — route labels + COUNTS only, never the
 *      prompt system/messages or the completion reply text.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { LlmClient, mockProvider } from '../src/index.js';
import { dumpLogs, clearLogs } from '@onderling/logger';

// Distinctive strings that must NEVER appear in any log field.
const SECRET_PROMPT = 'my-social-security-number-is-SECRET';
const SECRET_REPLY  = 'the-model-said-something-CONFIDENTIAL';

const ALLOWED_KEYS = new Set([
  'provider', 'model', 'endpoint', 'msgs', 'tools',
  'ms', 'replyChars', 'toolCalls', 'promptTokens', 'cachedPromptTokens', 'completionTokens', 'estimated', 'err',
]);
const FORBIDDEN = ['SECRET', 'CONFIDENTIAL', 'social-security', 'my-', 'the-model-said'];

function assertPiiSafe(records) {
  for (const r of records) {
    if (!r.f) continue;
    for (const [k, v] of Object.entries(r.f)) {
      expect(ALLOWED_KEYS.has(k), `unexpected field key "${k}" in ${r.tag}/${r.code}`).toBe(true);
      expect(['number', 'boolean', 'string']).toContain(typeof v);
      if (typeof v === 'string') {
        for (const bad of FORBIDDEN) {
          expect(v.toLowerCase().includes(bad.toLowerCase()), `field ${k}="${v}" leaks "${bad}"`).toBe(false);
        }
      }
    }
  }
}

describe('LlmClient — logger coverage + PII-safety', () => {
  beforeEach(() => clearLogs());

  it('logs llm.request (labels + counts) and llm.response (duration + counts) on success', async () => {
    const provider = mockProvider({
      responses: [{ replyText: SECRET_REPLY, classification: null }],
      model: 'qwen2.5:7b-instruct',
      endpoint: 'enclave',
    });
    const llm = new LlmClient({ provider, model: 'qwen2.5:7b-instruct', endpoint: 'enclave' });

    await llm.invoke({
      system: SECRET_PROMPT,
      messages: [{ role: 'user', content: SECRET_PROMPT }, { role: 'assistant', content: SECRET_REPLY }],
      tools: [{ id: 'a' }, { id: 'b' }],
    });

    const req = dumpLogs().filter(r => r.tag === 'llm' && r.code === 'llm.request');
    const res = dumpLogs().filter(r => r.tag === 'llm' && r.code === 'llm.response');
    expect(req.length).toBe(1);
    expect(res.length).toBe(1);
    expect(req[0].f.msgs).toBe(2);          // COUNT, not the messages
    expect(req[0].f.tools).toBe(2);
    expect(req[0].f.model).toBe('qwen2.5:7b-instruct');   // route label — safe
    expect(res[0].f.replyChars).toBe(SECRET_REPLY.length); // length, not the reply
    expect(typeof res[0].f.ms).toBe('number');
    assertPiiSafe(dumpLogs());
  });

  it('logs llm.error with error name + duration only, then re-throws', async () => {
    const provider = mockProvider({ invoke: async () => { throw new TypeError('boom'); } });
    const llm = new LlmClient({ provider });
    await expect(
      llm.invoke({ system: SECRET_PROMPT, messages: [{ role: 'user', content: SECRET_PROMPT }] }),
    ).rejects.toThrow('boom');

    const errs = dumpLogs().filter(r => r.tag === 'llm' && r.code === 'llm.error');
    expect(errs.length).toBe(1);
    expect(errs[0].f.err).toBe('TypeError');   // error NAME, not the message "boom"
    expect(typeof errs[0].f.ms).toBe('number');
    assertPiiSafe(dumpLogs());
  });
});
