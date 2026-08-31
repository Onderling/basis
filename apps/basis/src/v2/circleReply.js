// basis v2 — shared one-line circle-bubble text from a runDispatch reply (web + mobile).

import { translatorOr } from '../locales/translatorOr.js';
//
// The circle stream renders plain chat bubbles (no rich cards), so a dispatched command surfaces as a
// one-line confirmation; the real effect (task added/completed, …) propagates through the substrate to
// all members. Unifies web's `circleReplyText` and mobile's `circleReplyText`, which had drifted (web
// showed `✓ <label>` for EVERYTHING — add and complete were indistinguishable; mobile showed the raw
// payload text or "Done."). Now the op's VERB selects an Added:/Completed: phrasing.
//
// `circle.bot.*` locale keys (added, completed, ok, failed, listed, done) must exist in both bundles.

/**
 * @param {{error?:{message?:string}, payload?:any}} reply  a runDispatch result
 * @param {{verb?:string, t?:function}} [opts]  the dispatched op's verb (distinguishes add/complete) + the localiser
 * @returns {string}
 */
export function circleReplyText(reply, { verb, t } = {}) {
  const tr = translatorOr(t, 'circleReply.js');
  if (reply && reply.error) {
    return tr('circle.bot.failed', { msg: (reply.error && reply.error.message) || String(reply.error || '') });
  }
  const p0 = reply ? reply.payload : null;
  // §1b — a GENERIC capability reply wraps the effect under `{via:'generic', result}` (dispatchCapability's
  // envelope). Unwrap it so the SAME label/items rendering applies (add → "Added: …", list → enumerated).
  const p = (p0 && typeof p0 === 'object' && p0.via === 'generic' && p0.result && typeof p0.result === 'object')
    ? p0.result
    : p0;
  // The human label of the affected item, across the shapes the apps return (`body` = the generic note field).
  const label = (p && typeof p === 'object')
    ? (p.task?.text ?? p.title ?? p.text ?? p.item?.label ?? p.item?.body ?? p.body ?? p.name ?? null)
    : (typeof p === 'string' && p.trim() ? p : null);
  if (label) {
    if (verb === 'complete') return tr('circle.bot.completed', { label });
    if (verb === 'add' || verb === 'create') return tr('circle.bot.added', { label });
    return tr('circle.bot.ok', { label });        // "✓ {{label}}" — other verbs
  }
  if (p && Array.isArray(p.items)) {
    if (p.items.length === 0) return tr('circle.bot.listEmpty');
    // Enumerate the items (a "what's on the shopping list?" answer should SHOW them, not just count).
    const labels = p.items.map((it) => (it && (it.label ?? it.text ?? it.title ?? it.body ?? it.name ?? it.id)) || '').filter(Boolean);
    if (!labels.length) return tr('circle.bot.listed', { n: p.items.length });
    const shown = labels.slice(0, 12).map((l) => `• ${l}`).join('\n');
    return labels.length > 12 ? `${shown}\n…(+${labels.length - 12} more)` : shown;
  }
  return tr('circle.bot.done');
}
