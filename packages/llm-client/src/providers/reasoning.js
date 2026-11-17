/**
 * The reasoning switch per model FAMILY, for any OpenAI-compatible endpoint (Privatemode, a proxy before it, a local
 * server). Pure: no node module, so every shell can send it. Moved out of `privatemode.js` (which re-exports it) so the
 * person's own route, built in shared code the phone bundles, asks for low reasoning too.
 */
/**
 * Privatemode has no unified reasoning switch — it is per model family (`chat_template_kwargs` for
 * Kimi and Gemma, `reasoning_effort` for gpt-oss and GLM). GLM's reasoning cannot be switched off: its
 * `reasoning_effort` takes low | high | max, and with nothing sent it reasons at max (Privatemode's models page,
 * 2026-10-03) — which is why GLM "returned nothing in 5.5 s" in September. A tool pick is a clear task:
 * reasoning off/low keeps latency and tokens down.
 * @param {string} model
 * @param {'off'|'low'|'on'} [thinking='off']
 */
export function reasoningBodyFor(model, thinking = 'off') {
  const m = String(model || '').toLowerCase();
  if (thinking === 'on') return null;
  if (/kimi/.test(m))   return { chat_template_kwargs: { thinking: false } };
  if (/gemma/.test(m))  return { chat_template_kwargs: { enable_thinking: false } };
  if (/gpt-oss/.test(m)) return { reasoning_effort: thinking === 'off' ? 'low' : thinking };
  if (/glm/.test(m))     return { reasoning_effort: 'low' };   // off and low are both its lowest
  return null;
}
