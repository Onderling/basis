/**
 * modelWatch — the box watches its model route, so what silences the assistant reaches the admin.
 *
 * Two things did, on 2026-10-03, and neither was said to anyone: the provider stopped serving the configured model
 * (Privatemode removed kimi-k2.6), and later the account went over its monthly token limit. The household only heard
 * "the assistant is not answering". Now: at start and once a day the box asks which models are served and tells the
 * admin, once, when its model or fallback is not among them. A list that cannot be read is logged, not told (a blip is
 * not news).
 *
 * And the KEY is checked by using it: a models list needs no key, so on 2026-10-29 the tablet's watch said every model
 * was served while its proxy refused every completion (401) and the household got "the assistant is unavailable". Each
 * tick now makes one authenticated one-token completion; the walk log keeps the secret's NAME and the status, and a
 * refusal goes to the box's alert chat at most once an hour — the status, never the key.
 *
 * And the household's ADMIN hears that the model is not answering as it should, in their own chat: once when it starts
 * (a failed check, or a refusal on a live turn), once an hour while it lasts with how long, once when it recovers —
 * with the cause in plain words (the key, a limit, another refusal, too slow, unreachable), never a status or the key.
 * What the person whose question went unanswered is told (`replyClass`) names the same cause, coarser.
 */
import { param, PARAM_SCOPE, PARAM_KIND } from '@onderling/item-store';

/** How often the box checks its model route: the key (one one-token completion) and which models are served. */
export const MODEL_WATCH_EVERY_MS = param({ key: 'assistant.modelWatchEveryMs', scope: PARAM_SCOPE.DEVICE, kind: PARAM_KIND.INTERNAL, default: 3600 * 1000 });
/** A refused key is told in the alert chat at most this often; and the admin hears a lasting trouble this often. */
const TOLD_EVERY_MS = 3600 * 1000;

/** Does this provider error say the account is over its limit (not a wrong key)? */
export const isOverLimit = (err) => /\b(exceeded|over)\b[^\n]*\blimit\b/i.test(String(err?.message ?? err ?? ''));
/**
 * The Privatemode SDK's shape for an answer it could not get: '502 Connection error'. An expired key gives exactly this
 * (2026-10-30: weeks after a key expired, the smoke failed so, not with a 401), and so does a route that does not reach
 * the enclave — the shape cannot tell them apart, so neither is blamed alone.
 */
const isKeyOrRoute = (err) => (Number(err?.status) || 0) === 502 && /\bconnection error\b/i.test(String(err?.message ?? ''));
const isSlow = (err) => err?.name === 'AbortError' || /\babort|timed? ?out\b/i.test(String(err?.message ?? ''));

/**
 * What kind of trouble a model failure is: `key` (401/403: the key no longer works), `limit` (402/429, or a refusal that
 * says the account is over its limit — Privatemode sends that as a 401), `refused` (another 4xx), `slow` (it did not
 * answer in time), `key_or_route` (the SDK's '502 Connection error': an expired key or a route that does not reach the
 * provider, which that shape cannot tell apart), `unreachable` (no answer, or the provider's own failure).
 * @param {any} err
 * @returns {'key'|'limit'|'refused'|'slow'|'key_or_route'|'unreachable'}
 */
export function troubleCause(err) {
  const status = Number(err?.status) || 0;
  if (isOverLimit(err) || status === 402 || status === 429) return 'limit';
  if (status === 401 || status === 403) return 'key';
  if (status >= 400 && status < 500) return 'refused';
  if (isSlow(err)) return 'slow';
  if (isKeyOrRoute(err)) return 'key_or_route';
  return 'unreachable';
}

/** What the person is told, coarser: refused (the admin is told) · slow · unreachable. */
export const replyClass = (cause) => (cause === 'key' || cause === 'limit' || cause === 'refused' ? 'refused' : cause === 'slow' ? 'slow' : 'unreachable');

const ALERT_KEY = { key: 'circle.bot.secret_check_failed', limit: 'circle.bot.secret_check_limit', key_or_route: 'circle.bot.secret_check_key_or_route' };
/** The alert chat's words by cause (an alert that blames the key for a quota sends the operator to the wrong screen). */
const alertKeyFor = (cause) => ALERT_KEY[cause] ?? 'circle.bot.secret_check_refused';
/** …and by status alone. */
export const keyAlertKey = (status) => alertKeyFor(troubleCause({ status }));

/**
 * @param {object} a
 * @param {() => Promise<string[]>} a.listModels  the models the provider serves now
 * @param {string|null} a.model
 * @param {string|null} a.fallback
 * @param {(key: string, params?: object) => string} a.t
 * @param {(text: string) => Promise<void>} a.tellAdmin  a line in the household admin's private chat
 * @param {() => Promise<any>} [a.probe]  one authenticated one-token completion; throws (with `.status`) when refused
 * @param {string} [a.secretName]  the NAME of the secret the probe uses (the walk log and the alert say it; never its value)
 * @param {(text: string) => Promise<void>} [a.alertBox]  a line in the box's alert chat (absent → none; the admin hears the trouble)
 * @param {(entry: object) => void} [a.log]  the walk log
 * @param {() => number} [a.now]
 */
export function createModelWatch({ listModels, model, fallback, t, tellAdmin, probe = null, secretName = 'PRIVATEMODE_API_KEY', alertBox = null, log = () => {}, now = Date.now }) {
  const toldMissing = new Set();
  let keyToldAt = null;
  /** The trouble the admin knows of: since when, why, when they last heard. */
  let trouble = null;
  const say = async (text) => { try { await tellAdmin(text); } catch { /* the walk log has it */ } };
  const minutesSince = (at) => Math.max(1, Math.round((now() - at) / 60_000));
  const failing = async (cause) => {
    if (!trouble) {
      trouble = { since: now(), cause, toldAt: now() };
      log({ kind: 'model-trouble', state: 'start', cause });
      await say(t('circle.bot.model_trouble_start', { cause: t(`circle.bot.model_cause_${cause}`) }));
      return;
    }
    trouble.cause = cause;
    if (now() - trouble.toldAt < TOLD_EVERY_MS) return;
    trouble.toldAt = now();
    const minutes = minutesSince(trouble.since);
    log({ kind: 'model-trouble', state: 'ongoing', cause, minutes });
    await say(t('circle.bot.model_trouble_ongoing', { cause: t(`circle.bot.model_cause_${cause}`), minutes }));
  };
  const recovered = async () => {
    if (!trouble) return;
    const minutes = minutesSince(trouble.since);
    trouble = null;
    log({ kind: 'model-trouble', state: 'recovered', minutes });
    await say(t('circle.bot.model_trouble_recovered', { minutes }));
  };
  /** Use the key once. The walk log and the alert chat hear the status; the admin hears the trouble. The error text is not passed on. */
  const checkKey = async () => {
    if (typeof probe !== 'function') return;
    let err = null;
    const startedAt = now();
    try { await probe(); } catch (e) { err = e ?? new Error('refused'); }
    const status = err ? (Number(err?.status) || 0) : 200;
    // a one-token call: its time is the provider's latency, apart from any prompt a turn sends
    log({ kind: 'secret-check', secret: secretName, ok: !err, status, ms: now() - startedAt });
    if (!err) { keyToldAt = null; await recovered(); return; }
    const cause = troubleCause(err);
    await failing(cause);
    // the alert chat hears what the provider ANSWERED (a status); no answer at all (a timeout, no connection) is the admin's
    if (typeof alertBox !== 'function' || !status) return;
    if (keyToldAt !== null && now() - keyToldAt < TOLD_EVERY_MS) return;
    keyToldAt = now();
    try { await alertBox(t(alertKeyFor(cause), { secret: secretName, status: status || '—' })); } catch { /* the walk log has it */ }
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
    /** A live turn's provider error: a REFUSAL starts (or continues) the trouble at once; a slow or lost turn waits for the check. */
    async providerError(err) {
      const cause = troubleCause(err);
      if (replyClass(cause) !== 'refused') return;
      await failing(cause);
    },
  };
}
