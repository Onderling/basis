/**
 * modelWatch — the box watches its model route, so what silences the assistant reaches the admin.
 *
 * Two things did, on 2026-10-03, and neither was said to anyone: the provider stopped serving the configured model
 * (Privatemode removed kimi-k2.6), and later the account went over its monthly token limit. The household only heard
 * "the assistant is not answering". Now: at start and once a day the box asks which models are served and tells the
 * admin, once, when its model or fallback is not among them; and a provider error that says the account is over its
 * limit is told to the admin at most once a day. A list that cannot be read is logged, not told (a blip is not news).
 *
 * And the KEY is checked by using it: a models list needs no key, so on 2026-10-29 the tablet's watch said every model
 * was served while its proxy refused every completion (401) and the household got "the assistant is unavailable". Each
 * tick now makes one authenticated one-token completion; the walk log keeps the secret's NAME and the status, and a
 * refusal goes to the box's alert chat (the admin's chat on a box without one) at most once an hour — the status, never
 * the key.
 */
import { param, PARAM_SCOPE, PARAM_KIND } from '@onderling/item-store';

/** How often the box checks its model route: the key (one one-token completion) and which models are served. */
export const MODEL_WATCH_EVERY_MS = param({ key: 'assistant.modelWatchEveryMs', scope: PARAM_SCOPE.DEVICE, kind: PARAM_KIND.INTERNAL, default: 3600 * 1000 });
/** An over-limit refusal is told at most this often. */
const LIMIT_TOLD_EVERY_MS = 24 * 3600 * 1000;
/** A refused key is told at most this often. */
const KEY_TOLD_EVERY_MS = 3600 * 1000;

/**
 * Which words a refused check gets, by its status: a key that no longer works (401/403), a limit or credit (402/429),
 * or a refusal of another kind. An alert that blames the key for a quota sends the operator to the wrong screen.
 */
export const keyAlertKey = (status) => ([401, 403].includes(Number(status)) ? 'circle.bot.secret_check_failed'
  : [402, 429].includes(Number(status)) ? 'circle.bot.secret_check_limit'
  : 'circle.bot.secret_check_refused');

/** Does this provider error say the account is over its limit (not a wrong key)? */
export const isOverLimit = (err) => /\b(exceeded|over)\b[^\n]*\blimit\b/i.test(String(err?.message ?? err ?? ''));

/**
 * @param {object} a
 * @param {() => Promise<string[]>} a.listModels  the models the provider serves now
 * @param {string|null} a.model
 * @param {string|null} a.fallback
 * @param {(key: string, params?: object) => string} a.t
 * @param {(text: string) => Promise<void>} a.tellAdmin  a line in the admin's private chat
 * @param {() => Promise<any>} [a.probe]  one authenticated one-token completion; throws (with `.status`) when refused
 * @param {string} [a.secretName]  the NAME of the secret the probe uses (the walk log and the alert say it; never its value)
 * @param {(text: string) => Promise<void>} [a.alertBox]  a line in the box's alert chat (absent → the admin's chat)
 * @param {(entry: object) => void} [a.log]  the walk log
 * @param {() => number} [a.now]
 */
export function createModelWatch({ listModels, model, fallback, t, tellAdmin, probe = null, secretName = 'PRIVATEMODE_API_KEY', alertBox = null, log = () => {}, now = Date.now }) {
  const toldMissing = new Set();
  let limitToldAt = null;
  let keyToldAt = null;
  const say = async (text) => { try { await tellAdmin(text); } catch { /* the walk log has it */ } };
  const alert = async (text) => { try { await (alertBox ?? tellAdmin)(text); } catch { /* the walk log has it */ } };
  /** Use the key once; a refusal is said with its status, at most once an hour. The error text is not passed on. */
  const checkKey = async () => {
    if (typeof probe !== 'function') return;
    let status = 200;
    try { await probe(); } catch (e) { status = Number(e?.status) || 0; }
    log({ kind: 'secret-check', secret: secretName, ok: status === 200, status });
    if (status === 200) { keyToldAt = null; return; }
    if (keyToldAt !== null && now() - keyToldAt < KEY_TOLD_EVERY_MS) return;
    keyToldAt = now();
    await alert(t(keyAlertKey(status), { secret: secretName, status: status || '—' }));
  };
  return {
    /** Use the key, then ask which models are served; tell the admin, once per model, when ours is not. */
    async check() {
      await checkKey();
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
