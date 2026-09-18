/**
 * THE DEVICE OUTLIVES ITS MODEL.
 *
 * The always-on device is a device first and an assistant second: it holds the person's circles, takes
 * delivery of what arrives while their phone is in a drawer, and hands each turn on. The confidential LLM
 * route is the optional half of the Telegram half. On the first personal box (2026-09-18) a key was put in,
 * the SDK did not load (`openai` missing from the image), the boot threw, and the container crash-looped —
 * the DEVICE was down because a MODEL was unavailable. That order is wrong: a route that does not load is a
 * warning and a Telegram that answers without a model, never a device that is not there.
 */
import { describe, it, expect } from 'vitest';
import { buildAssistantLlm } from '../../src/telegram/assistantLlm.js';

describe('buildAssistantLlm — the confidential route is optional at every step', () => {
  it('no key → no model, no warning: that is the plain "device only" shape', async () => {
    const warned = [];
    const r = await buildAssistantLlm({ hasKey: () => false, makeProvider: async () => { throw new Error('must not be called'); }, warn: (m) => warned.push(m) });
    expect(r).toBeNull();
    expect(warned).toEqual([]);
  });

  it('a key and a provider that loads → a client on that provider, its model named', async () => {
    const provider = { id: 'privatemode', model: 'kimi-k2.6', invoke: async () => ({ text: 'ok' }) };
    const r = await buildAssistantLlm({ hasKey: () => true, makeProvider: async () => provider, warn: () => {} });
    expect(r?.model).toBe('kimi-k2.6');
    expect(r?.llm).toBeTruthy();
  });

  it('a key and a provider that fails to load → null and ONE warning that names the cause; nothing thrown', async () => {
    const warned = [];
    const r = await buildAssistantLlm({
      hasKey: () => true,
      makeProvider: async () => { throw Object.assign(new Error("Cannot find package 'openai'"), { code: 'ERR_MODULE_NOT_FOUND' }); },
      warn: (m) => warned.push(m),
    });
    expect(r).toBeNull();
    expect(warned.length).toBe(1);
    expect(warned[0]).toMatch(/confidential LLM route/i);
    expect(warned[0]).toContain("Cannot find package 'openai'");
    expect(warned[0]).toMatch(/without a model/i);
  });

  it('the model name from the environment reaches the provider', async () => {
    let seen = null;
    await buildAssistantLlm({ hasKey: () => true, makeProvider: async (o) => { seen = o; return { model: o.model }; }, model: 'some-model', warn: () => {} });
    expect(seen?.model).toBe('some-model');
    expect(seen?.timeoutMs).toBeGreaterThan(0);
  });
});
