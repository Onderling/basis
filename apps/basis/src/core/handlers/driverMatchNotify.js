/**
 * Drivers match→notify (#5) — the on-device seam the feed calls per incoming item.
 *
 * When an item (a question/task/post carrying a driverSignature, or just tags/text) arrives, we match
 * it LOCALLY against the user's own drivers and, on a resonant match, fire ONE notification carrying
 * the explainable reason. The private drivers never leave the device; the match runs here.
 *
 * REUSE, not new machinery:
 *   - matching = `matchProfileDrivers` (@onderling/agent-registry) — tag overlap + optional injected judge.
 *   - drivers  = injected `getDrivers()` (→ getProfileDrivers on the active persona).
 *   - notify   = injected `notify()` (→ the existing publishEvent `{app,type:'notification'}` / wake path).
 *   - the OUTREACH (anonymous DM + reveal escalation) is the USER's follow-up on the notification via the
 *     EXISTING chat channel (respondToItem / chat-p2p + Reveals) — never automatic, never here.
 *
 * The notification text is built from the match's own reason so the "no unexplainable matches" invariant
 * holds end-to-end: a shared-tags match says the tags; a judge match says the judge's sentence.
 */

import { matchProfileDrivers } from '@onderling/agent-registry';

/**
 * Annotate noticeboard posts with driver RESONANCE for render (#5, item b). Each post that matches the
 * user's drivers gets `resonance: { reason, matches }`; the rest pass through unchanged. Reuses the same
 * on-device matcher; the private drivers never leave the device. The reach-out itself is the EXISTING
 * "respond" action on a resonant post (respondToItem → anonymous @handle DM) — not a new affordance.
 *
 * @param {object} a
 * @param {Array<object>} a.posts
 * @param {() => Promise<Record<string,object>>} a.getDrivers
 * @param {Function} [a.judge]
 * @param {boolean} [a.modelConsent=false]  the persona's word on a model judging its drivers (`modelConsentFor`);
 *                                          without a yes the judge is never called
 * @param {number} [a.minShared=1]
 * @returns {Promise<Array<object>>}  posts, each optionally carrying `resonance`
 */
export async function annotateResonantPosts({ posts, getDrivers, judge, modelConsent = false, minShared = 1 } = {}) {
  const list = Array.isArray(posts) ? posts : [];
  let drivers = {};
  try { drivers = (await getDrivers?.()) ?? {}; } catch { drivers = {}; }
  if (!drivers || Object.keys(drivers).length === 0) return list;
  return Promise.all(list.map(async (p) => {
    let matches = [];
    try { matches = await matchProfileDrivers({ properties: drivers, item: p, judge, modelConsent, minShared }); }
    catch { matches = []; }
    return matches.length ? { ...p, resonance: { reason: matchReasonText(matches[0]), matches } } : p;
  }));
}

/** Human reason for a single match — reused for the notification body. Deterministic, explainable. */
export function matchReasonText(match) {
  if (match?.reason?.kind === 'tags') return `you both care about: ${match.reason.tags.join(', ')}`;
  if (match?.reason?.kind === 'llm')  return match.reason.text || 'a resonant match';
  return 'a resonant match';
}

/**
 * Evaluate ONE incoming item against the user's drivers. Returns the explainable matches (possibly []).
 * Never throws — a matching failure yields no matches (the feed must not break on a bad item).
 *
 * @param {object} a
 * @param {object} a.item                         the incoming item (driverSignature | text/tags)
 * @param {() => Promise<Record<string,object>>} a.getDrivers   loads the active persona's drivers
 * @param {Function} [a.judge]                    optional injected LLM judge
 * @param {boolean} [a.modelConsent=false]        the persona's yes; the judge runs only under it
 * @param {number} [a.minShared=1]
 * @returns {Promise<Array<object>>}
 */
export async function evaluateItemForDrivers({ item, getDrivers, judge, modelConsent = false, minShared = 1 } = {}) {
  if (!item || typeof getDrivers !== 'function') return [];
  let drivers = {};
  try { drivers = (await getDrivers()) ?? {}; } catch { return []; }
  if (!drivers || Object.keys(drivers).length === 0) return [];
  try { return await matchProfileDrivers({ properties: drivers, item, judge, modelConsent, minShared }); }
  catch { return []; }
}

/**
 * Match an incoming item and, if it resonates, fire ONE notification. The notification payload carries
 * the item ref + the top match's explainable reason (so the UI can offer "reach out" via the existing
 * anonymous-talk channel, and show WHY). Returns `{ notified, matches }`.
 *
 * `notify(payload)` receives `{ itemId, itemTitle, matches, topReason, message }` — the caller maps it
 * onto the existing publishEvent `{app:'pinboard', type:'notification', payload:{message}}` shape.
 *
 * @param {object} a
 * @param {object} a.item
 * @param {() => Promise<Record<string,object>>} a.getDrivers
 * @param {(payload:object) => void} a.notify
 * @param {Function} [a.judge]
 * @param {number} [a.minShared=1]
 * @returns {Promise<{notified:boolean, matches:Array<object>}>}
 */
export async function notifyIfResonant({ item, getDrivers, notify, judge, modelConsent = false, minShared = 1 } = {}) {
  const matches = await evaluateItemForDrivers({ item, getDrivers, judge, modelConsent, minShared });
  if (!matches.length || typeof notify !== 'function') return { notified: false, matches };
  const top = matches[0];
  const itemTitle = item?.title ?? item?.text ?? '';
  const reason = matchReasonText(top);
  try {
    notify({
      itemId: item?.id ?? item?.source?.requestId ?? null,
      itemTitle,
      matches,
      topReason: reason,
      // Neutral, honest one-liner — names the resonance, invites (not forces) reaching out.
      message: `✨ Something you might resonate with${itemTitle ? ` — “${String(itemTitle).slice(0, 48)}”` : ''} (${reason})`,
    });
  } catch { /* a notify failure must not break feed ingestion */ }
  return { notified: true, matches };
}
