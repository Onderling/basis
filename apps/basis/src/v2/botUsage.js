/**
 * botUsage — what the bot's model use costs, counted per calendar month (UTC, as a provider's monthly limit runs).
 *
 * Counts only, never words: calls, prompt tokens (of them, served from the prompt cache) and completion tokens. A
 * person's own calls are on their thread row; every call is also in the household's total. A person sees their own; the
 * total is the admin's, and everyone's only when the admin says so (`assistant.usageVisible`). One person's count is
 * never shown to another.
 */

/** The month a moment falls in: `YYYY-MM`, UTC. */
export const monthOf = (ms) => new Date(ms).toISOString().slice(0, 7);

/** Nothing counted yet this month. */
export const emptyUsage = (month) => ({ month, calls: 0, prompt: 0, cached: 0, completion: 0 });

/**
 * Counts so far plus one call — a count from an earlier month starts over.
 * @param {object|null} counts
 * @param {{promptTokens?: number, cachedPromptTokens?: number, completionTokens?: number}} u
 * @param {string} month
 */
export function addUsage(counts, u, month) {
  const base = counts?.month === month ? counts : emptyUsage(month);
  const n = (v) => (Number.isFinite(v) && v > 0 ? Math.round(v) : 0);
  return { month, calls: base.calls + 1, prompt: base.prompt + n(u?.promptTokens), cached: base.cached + n(u?.cachedPromptTokens), completion: base.completion + n(u?.completionTokens) };
}

/** The share of the prompt the cache served, in whole percent. */
export const cachedShare = (c) => (c?.prompt ? Math.round((c.cached / c.prompt) * 100) : 0);
