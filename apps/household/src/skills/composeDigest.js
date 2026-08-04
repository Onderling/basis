/**
 * skills/composeDigest — compose the daily digest message.
 *
 * Per Q-H2.7, the bot posts a daily summary at 20:00 local each day.
 * This skill composes the message body; the scheduler decides when to
 * post and to which chat.
 *
 * args : { chatId: string, windowMs?: number }   // windowMs default 24h
 * ctx  : SkillContext
 * reply: a single plain-text message, no buttons (informational).  If
 *        every section is empty, returns `{ replies: [], … }` so the
 *        caller can skip posting silently.
 *
 * Three sections, each elided if empty:
 *   - "Open right now"        — every open item, grouped by type
 *   - "Done in the last 24h"  — items completed within the window
 *   - "Open >7 days"          — stale open items (addedAt older than
 *                               7 days, still open)
 *
 * No state mutation; no stateUpdates emitted.
 *
 * Storage gap (v0): the `Store` interface (Phase 1) only exposes
 * `listOpen` — there is no method to enumerate completed items in a
 * window.  Pragmatic fallback: try `ctx.store.listAll?.()` if a store
 * happens to implement it; otherwise the "Done in the last 24h"
 * section is silently elided.  Convergence may extend `Store` with a
 * `listSince` / `listCompletedSince` method if/when this section
 * becomes mandatory.
 */

const TYPE_ORDER = ['shopping', 'errand', 'repair', 'schedule'];
const TYPE_LABEL_WIDTH = 10; // padded width for the type column
const DAY_MS = 24 * 60 * 60 * 1000;
const STALE_AGE_MS = 7 * DAY_MS;
const DEFAULT_WINDOW_MS = DAY_MS;

/**
 * @type {import('../types.js').SkillHandler}
 */
export async function composeDigest(args, ctx) {
  const { windowMs = DEFAULT_WINDOW_MS } = args ?? {};

  const now = Date.now();
  const sinceCompleted = now - windowMs;
  const staleBefore = now - STALE_AGE_MS;

  const open = await ctx.store.listOpen();

  // "Done in the last <window>" — only available if the store exposes
  // a `listAll` method (v0 storage-interface gap; see header comment).
  let doneInWindow = [];
  if (typeof ctx.store.listAll === 'function') {
    const all = await ctx.store.listAll();
    doneInWindow = all.filter(
      (it) => it.completedAt != null && it.completedAt >= sinceCompleted,
    );
  }

  const stale = open.filter((it) => it.addedAt < staleBefore);

  // Empty everywhere → empty reply (caller skips posting).
  if (open.length === 0 && doneInWindow.length === 0 && stale.length === 0) {
    return { replies: [], stateUpdates: [] };
  }

  const sections = [];

  if (open.length > 0) {
    sections.push(`Open right now:\n${renderGrouped(open)}`);
  }

  if (doneInWindow.length > 0) {
    sections.push(
      `Done in the last ${formatWindow(windowMs)}:\n${renderDone(doneInWindow)}`,
    );
  }

  if (stale.length > 0) {
    sections.push(`Open >7 days:\n${renderStale(stale)}`);
  }

  const header = `Daily digest — ${formatHeaderDate(new Date())}`;
  const footer =
    "— that's it for today.  Reply with `done <item>` to mark anything off.";

  const text = `${header}\n\n${sections.join('\n\n')}\n\n${footer}`;

  return {
    replies: [{ text }],
    stateUpdates: [],
  };
}

/**
 * Group items by type and render as `  type      · text` lines, with
 * the type label only on the first row of each group.
 *
 * @param {Array<import('../types.js').Item>} items
 * @returns {string}
 */
function renderGrouped(items) {
  const byType = new Map();
  for (const it of items) {
    if (!byType.has(it.type)) byType.set(it.type, []);
    byType.get(it.type).push(it);
  }

  const lines = [];
  for (const type of TYPE_ORDER) {
    const group = byType.get(type);
    if (!group || group.length === 0) continue;
    const label = type.padEnd(TYPE_LABEL_WIDTH, ' ');
    const blank = ' '.repeat(TYPE_LABEL_WIDTH);
    group.forEach((it, idx) => {
      const prefix = idx === 0 ? label : blank;
      lines.push(`  ${prefix}· ${it.text}`);
    });
  }
  // Catch any unexpected types not in TYPE_ORDER (defensive).
  for (const [type, group] of byType.entries()) {
    if (TYPE_ORDER.includes(type)) continue;
    const label = type.padEnd(TYPE_LABEL_WIDTH, ' ');
    const blank = ' '.repeat(TYPE_LABEL_WIDTH);
    group.forEach((it, idx) => {
      const prefix = idx === 0 ? label : blank;
      lines.push(`  ${prefix}· ${it.text}`);
    });
  }
  return lines.join('\n');
}

/**
 * Render the "done in window" section: one bullet per item, marked
 * with ✓.
 *
 * @param {Array<import('../types.js').Item>} items
 * @returns {string}
 */
function renderDone(items) {
  return items.map((it) => `  ✓ ${it.type} · ${it.text}`).join('\n');
}

/**
 * Render the "open >7 days" section: bullet + (added YYYY-MM-DD).
 *
 * @param {Array<import('../types.js').Item>} items
 * @returns {string}
 */
function renderStale(items) {
  return items
    .map((it) => `  · ${it.text} (added ${formatDateOnly(new Date(it.addedAt))})`)
    .join('\n');
}

/**
 * Format the digest header date — `YYYY-MM-DD HH:MM` (UTC, per spec).
 *
 * @param {Date} d
 * @returns {string}
 */
function formatHeaderDate(d) {
  return d.toISOString().slice(0, 16).replace('T', ' ');
}

/**
 * `YYYY-MM-DD` only, used by the stale-items section.
 *
 * @param {Date} d
 * @returns {string}
 */
function formatDateOnly(d) {
  return d.toISOString().slice(0, 10);
}

/**
 * Render the window duration in a human-friendly way: 24h, 48h, 7d, …
 *
 * @param {number} ms
 * @returns {string}
 */
function formatWindow(ms) {
  if (ms % DAY_MS === 0) {
    const days = ms / DAY_MS;
    if (days === 1) return '24h';
    return `${days}d`;
  }
  const hours = Math.round(ms / (60 * 60 * 1000));
  return `${hours}h`;
}
