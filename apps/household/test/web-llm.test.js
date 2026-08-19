/**
 * household web — (PLAN-gui-chat-uplift.md).
 *
 * Smoke test for the LLM passthrough on the web surface.  Boots
 * `startHouseholdWeb({ llm: mockLlm })`, POSTs a free-text chat
 * message, and asserts:
 *
 *   1. The `chat` skill responds 200 with a `replies[]` payload.
 *   2. The mock LLM was actually invoked (proves we routed past the
 *      regex fast path into the manifest-built ChatAgent).
 *   3. The store reflects the scripted tool call (addItem → milk
 *      lands in shopping/listOpen).
 *   4. Regex fast-path messages (e.g. `/list shopping`) still work
 *      through the chat skill — no LLM invocation.
 *   5. Without an `llm`, the chat skill falls back to the help hint
 *      (preserves pre-A.4 behaviour when no LLM is configured).
 *
 * The mockProvider scripts return the exact tool-call shape
 * `renderChat(householdManifest)` exposes to the LLM (op id is
 * "addItem", not "household.addItem" — this is single-app, not the
 * manifest-host composition).
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';

import { LlmClient, mockProvider } from '@onderling/llm-client';

import { startHouseholdWeb } from '../bin/household-web.js';

const ACTOR = 'https://id.example/anne';

/** Helper — POST a chat message through the local UI and parse the reply. */
async function postChat(baseUrl, text) {
  const res = await fetch(`${baseUrl}/tasks/send`, {
    method:  'POST',
    headers: { 'Content-Type': 'application/json' },
    body:    JSON.stringify({
      skillId: 'chat',
      message: { parts: [{ type: 'DataPart', data: { text } }] },
    }),
  });
  const json = await res.json();
  const dp   = (json.artifacts?.[0]?.parts ?? []).find((p) => p?.type === 'DataPart');
  return { status: res.status, json, data: dp?.data ?? {} };
}

describe('household web UI — Slice A.4 LLM passthrough', () => {
  let handle, baseUrl, providerInvocations;

  beforeAll(async () => {
    providerInvocations = 0;
    // Mock provider: every invoke increments a counter so we can
    // assert the LLM was reached (vs the regex fast-path).  Scripts a
    // single `addItem(shopping, milk)` tool call — matches the
    // manifest's toolCatalogue shape exactly.
    const provider = {
      id: 'web-llm-mock',
      requiresKey: false,
      async invoke() {
        providerInvocations++;
        return {
          toolCall: { id: 'addItem', args: { type: 'shopping', text: 'milk' } },
          toolCalls: [{ id: 'addItem', args: { type: 'shopping', text: 'milk' } }],
          classification: 'actionable',
          replyText: null,
          raw: {},
        };
      },
    };
    const llm = new LlmClient({ provider });
    handle  = await startHouseholdWeb({ port: 0, actor: ACTOR, llm });
    baseUrl = handle.url;
  });

  afterAll(async () => {
    await handle?.stop();
  });

  it('chat → LLM tool call → store mutated', async () => {
    const beforeOpen = await handle.store.listOpen({ type: 'shopping' });
    expect(beforeOpen.find((it) => it.text === 'milk')).toBeUndefined();
    const invocationsBefore = providerInvocations;

    const { status, json, data } = await postChat(baseUrl, 'please add milk to the shopping list');
    expect(status).toBe(200);
    expect(json.status).toBe('completed');

    // The LLM was reached (slash grammar doesn't match the freeform text).
    expect(providerInvocations).toBe(invocationsBefore + 1);

    // The skill replies came back (addItem skill emits a confirmation).
    expect(Array.isArray(data.replies)).toBe(true);
    expect(data.replies.length).toBeGreaterThan(0);
    const allText = data.replies.map((r) => r.text ?? '').join('\n').toLowerCase();
    expect(allText).toContain('milk');

    // The store reflects the scripted tool call.
    const open = await handle.store.listOpen({ type: 'shopping' });
    expect(open.some((it) => it.text === 'milk' && it.type === 'shopping')).toBe(true);
  });

  it('chat with a slash command stays on the regex fast path (no LLM call)', async () => {
    // Seed an item via the regular addItem skill so /list has something to show.
    await fetch(`${baseUrl}/tasks/send`, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({
        skillId: 'addItem',
        message: { parts: [{ type: 'DataPart', data: { type: 'errand', text: 'pick up keys' } }] },
      }),
    });

    const invocationsBefore = providerInvocations;
    const { status, data } = await postChat(baseUrl, '/list errand');
    expect(status).toBe(200);
    // Regex fast path — must NOT have called the LLM.
    expect(providerInvocations).toBe(invocationsBefore);
    expect(Array.isArray(data.replies)).toBe(true);
    expect(data.replies.length).toBeGreaterThan(0);
    const allText = data.replies.map((r) => r.text ?? '').join('\n').toLowerCase();
    expect(allText).toContain('pick up keys');
  });
});

describe('household web UI — Slice A.4 chat without LLM', () => {
  let handle, baseUrl;

  beforeAll(async () => {
    handle  = await startHouseholdWeb({ port: 0, actor: ACTOR });   // no llm
    baseUrl = handle.url;
  });

  afterAll(async () => {
    await handle?.stop();
  });

  it('free-text without LLM falls back to the help hint', async () => {
    const { status, data } = await postChat(baseUrl, 'hello there');
    expect(status).toBe(200);
    expect(Array.isArray(data.replies)).toBe(true);
    expect(data.replies.length).toBeGreaterThan(0);
    // HOUSEHOLD_AGENT HELP_HINT_REPLY text — see HouseholdAgent.js.
    const allText = data.replies.map((r) => r.text ?? '').join('\n').toLowerCase();
    expect(allText).toMatch(/help|add|list|done/);
  });

  it('slash command without LLM still routes through the regex fast path', async () => {
    // Seed something.
    await fetch(`${baseUrl}/tasks/send`, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({
        skillId: 'addItem',
        message: { parts: [{ type: 'DataPart', data: { type: 'shopping', text: 'eggs' } }] },
      }),
    });
    const { status, data } = await postChat(baseUrl, '/list shopping');
    expect(status).toBe(200);
    const allText = data.replies.map((r) => r.text ?? '').join('\n').toLowerCase();
    expect(allText).toContain('eggs');
  });
});
