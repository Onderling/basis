// Platform-neutral feedback MOUNT — the small command/routing glue between a chat shell's text
// input and the feedback surface, shared by web + mobile (rule of two: 2 consumers). The shell
// injects HOW to append a user/bot bubble (DOM on web, RN state on mobile); the mount owns the
// platform-independent decisions: enter feedback mode (`/feedback [code]`), leave it
// (`/feedback-stop`), route free text to the bot while active, and expose the agent contact item +
// its open action. UI confirmation text stays the shell's job (so it can localise) — the mount
// emits no hardcoded strings.

import { createFeedbackSurface, feedbackContactItem } from './feedbackSurface.js';

// The feedback BOT's own slash commands — forwarded to the bot while a session is active (instead of
// passing through to the circle bot). Mirrors apps/feedback-pipeline/src/channel/actions.js
// (`/help` → help; `/klaar` | `/done` | `/review` → review). `/klaar` is the review/submit step the
// bot's guidance tells users to type, so it MUST reach the bot.
const FEEDBACK_BOT_SLASH = new Set(['/klaar', '/done', '/review', '/help']);

/**
 * @param {object} a
 * @param {object} [a.surface]            a pre-built feedback surface (else one is created from the
 *                                        remaining opts with an emit sink that calls appendBotBubble)
 * @param {(threadId:string, text:string)=>void} a.appendUserBubble  echo the user's input
 * @param {(threadId:string, text:string)=>void} a.appendBotBubble   render a bot reply
 * @param {object} [a.surfaceOpts]        forwarded to createFeedbackSurface (config/pod/identity/llmBaseURL)
 */
export function createFeedbackMount({ surface, appendUserBubble, appendBotBubble, ...surfaceOpts } = {}) {
  if (typeof appendUserBubble !== 'function' || typeof appendBotBubble !== 'function') {
    throw new Error('createFeedbackMount: appendUserBubble + appendBotBubble required');
  }
  const fb = surface || createFeedbackSurface({
    ...surfaceOpts,
    emit: ({ chatId, text, buttons }) => appendBotBubble(chatId, formatBody(text, buttons)),
  });

  return {
    surface: fb,
    /** The feedback bot as a distinct agent contact (for the /contacts list). */
    contactItem: (opts) => feedbackContactItem(opts),
    /** Enter feedback mode directly (e.g. from the contact's openFeedback action). */
    async open(threadId) { await fb.start(threadId); },
    isActive: (threadId) => fb.isActive(threadId),
    /**
     * Try to handle one text turn. Returns true when the mount took it (the caller should stop):
     *   • `/feedback [code]`  → enter feedback mode
     *   • `/feedback-stop`    → leave feedback mode (caller may show its own localised confirmation)
     *   • free text while a thread is in feedback mode → route to the bot
     * Anything else (incl. other slash commands, even while active) → returns false (caller dispatches normally).
     */
    async tryHandle(text, threadId) {
      const trimmed = String(text ?? '').trim();
      if (/^\/feedback(?:\s+\S+)?$/.test(trimmed)) { appendUserBubble(threadId, trimmed); await fb.start(threadId); return true; }
      if (trimmed === '/feedback-stop') { fb.stop(threadId); return true; }
      // While active, forward to the bot: free text, AND the bot's OWN slash commands (the most
      // important being `/klaar` — the review/submit step its guidance advertises). Previously the
      // `!startsWith('/')` guard sent ALL slash commands to the circle bot, so `/klaar` (and `/help`,
      // `/done`, `/review`) were unreachable inside canopy-chat (device-verify 2026-06-11). Genuine
      // circle commands (anything not in FEEDBACK_BOT_SLASH) still pass through (return false).
      if (trimmed && fb.isActive(threadId)) {
        const head = trimmed.split(/\s+/)[0].toLowerCase();
        if (!trimmed.startsWith('/') || FEEDBACK_BOT_SLASH.has(head)) {
          appendUserBubble(threadId, trimmed);
          await fb.handle(trimmed, threadId);
          return true;
        }
      }
      return false;
    },
  };
}

function formatBody(text, buttons) {
  return buttons?.length ? `${text}\n${buttons.map((b) => `• ${b.label}`).join('\n')}` : text;
}
