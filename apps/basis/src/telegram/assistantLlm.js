/**
 * The assistant's confidential LLM route — optional at every step, never a reason the device is down.
 *
 * The always-on device is a device first: it holds the person's circles and takes delivery for their
 * other devices. The model behind the Telegram half is the optional half of that optional half. So a
 * missing key is the plain "device only" shape (no warning: nothing was asked for), and a key whose SDK
 * does not load is ONE warning naming the cause and a Telegram that answers without a model — measured
 * the other way round on the first personal box (2026-09-18), where a key without its SDK in the image
 * threw at boot and the container crash-looped: the device gone because a model was unavailable.
 */
import { LlmClient } from '@onderling/llm-client';
import { privatemodeProvider, readPrivatemodeKey } from '@onderling/llm-client/providers/privatemode';

/**
 * @param {object} [a]
 * @param {() => (string|null|undefined)} [a.hasKey]       is a Privatemode key configured (env / file)?
 * @param {(o: {model?: string, timeoutMs: number}) => Promise<object>} [a.makeProvider]  the provider factory
 * @param {string} [a.model]                               the model name, when the operator chose one
 * @param {number} [a.timeoutMs]
 * @param {(msg: string) => void} [a.warn]
 * @returns {Promise<{ llm: LlmClient, model: string|null } | null>}
 */
export async function buildAssistantLlm({
  hasKey = readPrivatemodeKey,
  makeProvider = privatemodeProvider,
  model = undefined,
  timeoutMs = 60_000,
  warn = (m) => console.warn(m),
} = {}) {
  if (!hasKey()) return null;
  try {
    const provider = await makeProvider({ model: model || undefined, timeoutMs });
    return { llm: new LlmClient({ provider }), model: provider?.model ?? null };
  } catch (err) {
    warn(`device-runner: the confidential LLM route did not load (${err?.message ?? err}) — Telegram answers without a model; the device runs on.`);
    return null;
  }
}
