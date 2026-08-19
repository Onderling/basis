/**
 * circleMemory — conversation context for the circle bot.
 *
 * Threads the last few circle turns into `interpretToCommand`'s existing `context`
 * param (RAG lines woven into the LLM system prompt), so follow-ups resolve
 * against what was just said: "en schoenen ook", "remove the milk", "that one".
 *
 * Circle-bot-local — no store; just the rows already on screen. Pure + shared
 * web↔mobile. The lines are self-describing ("you: …" / "assistant: …") so the
 * model reads them as the recent conversation.
 */

/**
 * Build the recent-conversation context lines from circle stream rows.
 *
 * @param {object} [args]
 * @param {Array}  [args.rows]    circle stream rows (any order — sorted by ts here)
 * @param {number} [args.limit]   how many recent turns to include
 * @param {string} [args.botActor] the actor value used for bot rows (default 'bot')
 * @returns {string[]} chronological turn lines, oldest → newest
 */
export function recentCircleTurns({ rows = [], limit = 6, botActor = 'bot' } = {}) {
  const turns = [];
  for (const r of Array.isArray(rows) ? rows : []) {
    const p = r?.event?.payload;
    if (!p || p.kind !== 'chat-message') continue;
    const text = typeof p.text === 'string' ? p.text.trim() : '';
    if (!text) continue;
    const ts = Number(r.ts ?? r.event?.ts ?? 0) || 0;
    const who = r.actor === botActor ? 'assistant' : 'you';
    turns.push({ ts, line: `${who}: ${text}` });
  }
  turns.sort((a, b) => a.ts - b.ts);
  const n = Number.isFinite(limit) && limit > 0 ? limit : 6;
  return turns.slice(-n).map((tn) => tn.line);
}
