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
/**
 * Split remembered turns into what was SAID and what was DONE. The member's and the assistant's turns become chat
 * messages (`you` → user, `assistant` → assistant) so the model reads its earlier words as a conversation; an op's
 * result (the `system` voice) nobody said, so it stays a context line.
 * @param {string[]} lines  `"<who>: <text>"`, oldest first (as `recentCircleTurns` and the engine's memory give them)
 * @returns {{history: Array<{role: 'user'|'assistant', content: string}>, context: string[]}}
 */
/** How an op's result is marked in the conversation the model reads. LLM-facing. */
export const RESULT_NOTE = 'the app answered:';

export function splitRecentTurns(lines) {
  const history = [];
  const context = [];
  for (const line of Array.isArray(lines) ? lines : []) {
    const m = /^(you|assistant|system):\s*([\s\S]*)$/.exec(String(line ?? ''));
    if (!m || !m[2].trim()) { if (String(line ?? '').trim()) context.push(String(line)); continue; }
    // An op's result stays IN the conversation at its place, so the request it answered reads as answered (moved
    // out, the model saw an unanswered request and did it again) — but never in the assistant's voice, which the
    // model would imitate ("✓ added …") instead of calling the tool.
    if (m[1] === 'system') history.push({ role: 'user', content: `(${RESULT_NOTE} ${m[2].trim()})` });
    else history.push({ role: m[1] === 'assistant' ? 'assistant' : 'user', content: m[2].trim() });
  }
  return { history, context };
}

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
