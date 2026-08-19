/**
 * Stoop chat surface adopts LLM tool-calling via
 * `renderChat(stoopManifest)`.
 *
 * Asserts:
 *   - free-text messages flow through the LLM, which emits a tool call
 *     against one of the manifest's 13 ops, which dispatches via the
 *     adapter to the underlying SDK skill — and the side-effect
 *     (item landed in the store) is observable.
 *   - slash commands continue to dispatch DIRECTLY against the SDK
 *     skill (the fast path) — the LLM is NOT consulted.  Slash and
 *     LLM live side-by-side; D.2 is purely additive.
 *   - the buildStoopSkillRegistry walker covers every manifest op
 *     1:1 against the live agent's skill set (no missing skills).
 *   - the LLM-side tool catalogue carries every manifest op + each
 *     hint pulls from `surfaces.chat.hint`.
 *   - graceful degradation: an LLM that emits no tool call simply
 *     produces no side-effect (no spurious item posts).
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { AgentIdentity, InternalBus, InternalTransport, DataPart } from '@onderling/core';
import { VaultMemory } from '@onderling/vault';
import { mockProvider, LlmClient } from '@onderling/llm-client';

import { createNeighbourhoodAgent } from '../src/index.js';
import { stoopManifest }           from '../manifest.js';
import {
  createLlmChat,
  buildStoopSkillRegistry,
  STOOP_SHELL_ONLY_OPS,
} from '../src/chat/llmChat.js';

const ANNE = 'https://id.example/anne';

async function buildBundle() {
  const id = await AgentIdentity.generate(new VaultMemory());
  const tx = new InternalTransport(new InternalBus(), id.pubKey);
  const bundle = await createNeighbourhoodAgent({
    identity: id, transport: tx,
    offeringMatch: { group: 'oosterpoort', localActor: ANNE, peers: [] },
    members:    [{ webid: ANNE }],
  });
  await bundle.offeringMatch.start();
  return bundle;
}

async function callSkill(agent, skillId, args, from = ANNE) {
  const def = agent.skills.get(skillId);
  if (!def) throw new Error(`callSkill: no such skill: ${skillId}`);
  return def.handler({
    parts:    args === undefined ? [] : [DataPart(args)],
    from,
    agent,
    envelope: null,
  });
}

describe('Stoop Slice D.2 — LLM tool-calling on chat via renderChat', () => {
  /** @type {Awaited<ReturnType<typeof buildBundle>>} */
  let bundle;

  beforeEach(async () => {
    bundle = await buildBundle();
  });

  it('skillRegistry covers every substrate-backed manifest op against the live agent', () => {
    const { skillRegistry, missing } = buildStoopSkillRegistry(bundle);
    // Zero ops missing — every manifest entry either has a backing skill
    // (directly or via the listFeed→listOpen / getStoopProfile→
    // getMyProfile alias) or is a documented basis-shell-only op.
    expect(missing).toEqual([]);
    for (const op of stoopManifest.operations) {
      // Part G dissolve (2026-06-17) — shell-only ops (wizards / [DM]
      // button / synthesized /groups) have no standalone substrate skill.
      if (STOOP_SHELL_ONLY_OPS.has(op.id)) continue;
      expect(skillRegistry, `skillRegistry must have op ${op.id}`).toHaveProperty(op.id);
      expect(typeof skillRegistry[op.id]).toBe('function');
    }
  });

  it('the renderChat-projected tool catalogue exposes every manifest op with its chat hint', () => {
    const provider = mockProvider({ responses: [{ replyText: null }] });
    const llm = new LlmClient({ provider });
    const { chatAgent } = createLlmChat({ bundle, llm, localActor: ANNE });
    // ChatAgent stores #toolCatalogue privately; introspect via a probe
    // request by triggering an invoke that captures the tools array.
    let capturedTools = null;
    const captureLlm = {
      id: 'capture', requiresKey: false,
      async invoke(req) { capturedTools = req.tools; return { toolCall: null, replyText: null, raw: {} }; },
    };
    const captureChat = createLlmChat({ bundle, llm: captureLlm, localActor: ANNE });
    return captureChat.onFreeText('test', { chatId: 'cap', senderWebid: ANNE }).then(() => {
      expect(Array.isArray(capturedTools)).toBe(true);
      const ids = capturedTools.map((t) => t.id);
      for (const op of stoopManifest.operations) {
        expect(ids).toContain(op.id);
      }
      const postRequest = capturedTools.find((t) => t.id === 'postRequest');
      expect(postRequest.description).toBe(stoopManifest.operations
        .find((o) => o.id === 'postRequest').surfaces.chat.hint);
      // Sanity check: chatAgent is the one we built, not captured one
      void chatAgent;
    });
  });

  it('free-text → LLM tool call (postRequest) → item lands in store', async () => {
    const provider = mockProvider({
      responses: [{
        toolCall: { id: 'postRequest', args: { intent: 'ask', text: 'borrow drill' } },
        replyText: null,
      }],
    });
    const llm = new LlmClient({ provider });
    const { onFreeText } = createLlmChat({ bundle, llm, localActor: ANNE });

    const result = await onFreeText('hi neighbours, anyone got a drill I can borrow?', {
      senderWebid: ANNE,
      chatId:      'd2-test',
    });

    // The tool call ran + produced one reply line.
    expect(result.replies.length).toBeGreaterThanOrEqual(1);
    expect(result.replies[0].text).toMatch(/^posted/);

    // Side-effect: the item landed in the open-board.
    const open = await bundle.itemStore.listOpen();
    const drill = open.find((i) => i.text === 'borrow drill');
    expect(drill).toBeTruthy();
    // intent=ask → canonical type=request (per intentToCanonicalDraft).
    expect(drill.type).toBe('request');
    expect(drill.addedBy).toBe(ANNE);
  });

  it('free-text → LLM tool call (listOpen) → returns the items array', async () => {
    // Seed two items via the direct SDK skill (the slash fast-path
    // equivalent — fully unchanged by D.2).
    await callSkill(bundle.agent, 'postRequest', { intent: 'ask',   text: 'paint roller' });
    await callSkill(bundle.agent, 'postRequest', { intent: 'offer', text: 'spare jam jars' });

    const provider = mockProvider({
      responses: [{ toolCall: { id: 'listOpen', args: {} }, replyText: null }],
    });
    const llm = new LlmClient({ provider });
    const { onFreeText } = createLlmChat({ bundle, llm, localActor: ANNE });

    const result = await onFreeText('what is on the board?', { senderWebid: ANNE });

    expect(result.replies).toHaveLength(1);
    // Both seeded items render in the formatted list.
    expect(result.replies[0].text).toContain('paint roller');
    expect(result.replies[0].text).toContain('spare jam jars');
  });

  it('slash command (direct dispatch) still works WITHOUT consulting the LLM', async () => {
    // Build the LLM adapter but bypass it entirely — the consumer's
    // slash fast-path calls the SDK skill directly, the way wireChat
    // and the existing chat surface have always done.  D.2 is
    // additive: this confirms the slash side stays intact.
    let invokeCount = 0;
    const provider = {
      id: 'should-not-be-called', requiresKey: false,
      async invoke() { invokeCount++; return { toolCall: null, replyText: null, raw: {} }; },
    };
    const llm = new LlmClient({ provider });
    createLlmChat({ bundle, llm, localActor: ANNE });

    // Simulate the slash fast-path that the existing chat surface
    // would take on `/withdraw <id>` — direct SDK-skill dispatch.
    const posted = await callSkill(bundle.agent, 'postRequest', {
      intent: 'ask', text: 'borrow ladder',
    });
    const withdrawn = await callSkill(bundle.agent, 'cancelRequest', {
      requestId: posted.requestId,
    });

    expect(withdrawn).toMatchObject({ id: posted.requestId });
    // The LLM was never called.
    expect(invokeCount).toBe(0);
    // The item is gone.
    const open = await bundle.itemStore.listOpen();
    expect(open.find((i) => i.id === posted.requestId)).toBeFalsy();
  });

  it('LLM returns no tool call → no side-effect, no spurious posts', async () => {
    const provider = mockProvider({
      responses: [{ toolCall: null, replyText: 'I am not sure what you meant.' }],
    });
    const llm = new LlmClient({ provider });
    const { onFreeText } = createLlmChat({ bundle, llm, localActor: ANNE });

    // Snapshot store size before.
    const beforeCount = (await bundle.itemStore.listOpen()).length;

    const result = await onFreeText('haha that is funny', { senderWebid: ANNE });

    // Free-text reply surfaces, no tool calls fired.
    expect(result.replies.map((r) => r.text).join('\n')).toMatch(/not sure/i);

    // Store unchanged.
    const afterCount = (await bundle.itemStore.listOpen()).length;
    expect(afterCount).toBe(beforeCount);
  });

  it('LLM tool call with `error` return value surfaces a clean error reply', async () => {
    const provider = mockProvider({
      responses: [{
        // assignLend on a non-existent item → skill returns {error:'not-found'}
        toolCall: { id: 'assignLend', args: { itemId: 'nope', borrowerWebid: 'urn:x' } },
        replyText: null,
      }],
    });
    const llm = new LlmClient({ provider });
    const { onFreeText } = createLlmChat({ bundle, llm, localActor: ANNE });

    const result = await onFreeText('assign the missing ladder to bob', { senderWebid: ANNE });

    expect(result.replies).toHaveLength(1);
    expect(result.replies[0].text).toMatch(/^error: not-found/);
  });
});
