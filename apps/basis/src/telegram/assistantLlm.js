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
import { param, PARAM_SCOPE, PARAM_KIND } from '@onderling/item-store';

/** The model a turn is retried on ONCE when the primary times out. */
export const ASSISTANT_FALLBACK_MODEL = param({ key: 'assistant.fallbackModel', scope: PARAM_SCOPE.DEVICE, kind: PARAM_KIND.INTERNAL, default: 'gpt-oss-120b' });
/**
 * How long the model may take before the turn says it is slow and tries the fallback once. Well under a minute: a
 * person waiting 60 s for "even geduld" has given up (measured 2026-09-30: a normal model turn is about 2 s).
 */
export const ASSISTANT_MODEL_TIMEOUT_MS = param({ key: 'assistant.modelTimeoutMs', scope: PARAM_SCOPE.DEVICE, kind: PARAM_KIND.INTERNAL, default: 20_000 });

const isTimeout = (err) => err?.name === 'AbortError' || /\babort|timed? ?out\b/i.test(String(err?.message ?? ''));

/**
 * A provider that retries a turn ONCE on another model when the first times out — any other error goes on as it
 * is. The second provider is made on first need. `onFallback` hears of it (the box writes it to its walk log), and so
 * does the turn: a request's own `onSlow` (the door tells the person to wait).
 */
function withTimeoutFallback(primary, { makeFallback, fallbackModel, onFallback }) {
  let second = null;
  return {
    id: primary.id, endpoint: primary.endpoint, model: primary.model,
    async invoke(req) {
      try { return await primary.invoke(req); }
      catch (err) {
        if (!isTimeout(err) || !fallbackModel || fallbackModel === primary.model) throw err;
        second ??= await makeFallback();
        try { onFallback?.({ from: primary.model ?? null, to: fallbackModel, reason: 'timeout' }); } catch { /* a listener never breaks a turn */ }
        // …and the turn itself hears it is slow, so the person is told before the second wait (`req.onSlow`, per turn)
        try { req?.onSlow?.(); } catch { /* a listener never breaks a turn */ }
        return second.invoke(req);
      }
    },
  };
}

/**
 * @param {object} [a]
 * @param {() => (string|null|undefined)} [a.hasKey]       is a Privatemode key configured (env / file)?
 * @param {(o: {model?: string, timeoutMs: number}) => Promise<object>} [a.makeProvider]  the provider factory
 * @param {string} [a.model]                               the model name, when the operator chose one
 * @param {number} [a.timeoutMs]
 * @param {(msg: string) => void} [a.warn]
 * @param {string} [a.fallbackModel]    retried once on a timeout (`assistant.fallbackModel`)
 * @param {(e: {from: string|null, to: string, reason: string}) => void} [a.onFallback]
 * @returns {Promise<{ llm: LlmClient, model: string|null } | null>}
 */
export async function buildAssistantLlm({
  hasKey = readPrivatemodeKey,
  makeProvider = privatemodeProvider,
  model = undefined,
  timeoutMs = ASSISTANT_MODEL_TIMEOUT_MS,
  warn = (m) => console.warn(m),
  fallbackModel = ASSISTANT_FALLBACK_MODEL,
  onFallback = null,
} = {}) {
  if (!hasKey()) return null;
  try {
    const primary = await makeProvider({ model: model || undefined, timeoutMs });
    const provider = withTimeoutFallback(primary, {
      fallbackModel, onFallback, makeFallback: () => makeProvider({ model: fallbackModel, timeoutMs }),
    });
    return { llm: new LlmClient({ provider }), model: primary?.model ?? null };
  } catch (err) {
    warn(`device-runner: the confidential LLM route did not load (${err?.message ?? err}) — Telegram answers without a model; the device runs on.`);
    return null;
  }
}
