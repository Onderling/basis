/**
 * modelWatch — the box watches its model route, so what silences the assistant reaches the admin.
 *
 * Two things did, on 2026-10-03, and neither was said to anyone: the provider stopped serving the configured model
 * (Privatemode removed kimi-k2.6), and later the account went over its monthly token limit. The household only heard
 * "the assistant is not answering". Now: at start and once a day the box asks which models are served and tells the
 * admin, once, when its model or fallback is not among them; and a provider error that says the account is over its
 * limit is told to the admin at most once a day. A list that cannot be read is logged, not told (a blip is not news).
 */
import { param, PARAM_SCOPE, PARAM_KIND } from '@onderling/item-store';

/** How often the box asks which models are served. */
export const MODEL_WATCH_EVERY_MS = param({ key: 'assistant.modelWatchEveryMs', scope: PARAM_SCOPE.DEVICE, kind: PARAM_KIND.INTERNAL, default: 24 * 3600 * 1000 });
/** An over-limit refusal is told at most this often. */
const LIMIT_TOLD_EVERY_MS = 24 * 3600 * 1000;

/** Does this provider error say the account is over its limit (not a wrong key)? */
export const isOverLimit = (err) => /\b(exceeded|over)\b[^\n]*\blimit\b/i.test(String(err?.message ?? err ?? ''));

/**
 * @param {object} a
 * @param {() => Promise<string[]>} a.listModels  the models the provider serves now
 * @param {string|null} a.model
 * @param {string|null} a.fallback
 * @param {(key: string, params?: object) => string} a.t
 * @param {(text: string) => Promise<void>} a.tellAdmin  a line in the admin's private chat
 * @param {(entry: object) => void} [a.log]  the walk log
 * @param {() => number} [a.now]
 */
export function createModelWatch({ listModels, model, fallback, t, tellAdmin, log = () => {}, now = Date.now }) {
  const toldMissing = new Set();
  let limitToldAt = null;
  const say = async (text) => { try { await tellAdmin(text); } catch { /* the walk log has it */ } };
  return {
    /** Ask which models are served; tell the admin, once per model, when ours is not. */
    async check() {
      let served;
      try { served = await listModels(); } catch (e) { log({ kind: 'model-watch', error: String(e?.message ?? e).slice(0, 120) }); return; }
      const missing = [model, fallback].filter((m) => m && !served.includes(m));
      log({ kind: 'model-watch', served: served.length, missing });
      for (const m of missing) {
        if (toldMissing.has(m)) continue;
        toldMissing.add(m);
        const using = [model, fallback].find((x) => x && served.includes(x)) ?? null;
        await say(t('circle.bot.model_not_served', { model: m, using: using ?? '—' }));
      }
    },
    /** A provider error: an account over its limit is told to the admin, at most once a day. */
    async providerError(err) {
      if (!isOverLimit(err)) return;
      log({ kind: 'model-watch', overLimit: true });
      if (limitToldAt !== null && now() - limitToldAt < LIMIT_TOLD_EVERY_MS) return;
      limitToldAt = now();
      await say(t('circle.bot.model_over_limit'));
    },
  };
}
