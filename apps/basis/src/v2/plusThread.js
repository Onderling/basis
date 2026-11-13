/**
 * The "+" as the person's ASSISTANT THREAD: one ongoing conversation they can drop into at any moment. What they type
 * and what the assistant answered are kept as the bot's own turn entries (`assistant-turn`, `botThreads`) on the
 * device's log: the chat retention class, so they age out on the device's chat window through the log's compactor,
 * and the person can empty the thread at once (`forget`, the log's own scoped purge). What a line DID (a list entry,
 * an appointment) is a store row and stays; the words are the conversation around it. One model both shells paint.
 */
import { param, PARAM_SCOPE, PARAM_KIND } from '@onderling/item-store';

/** How many of the last turns the "+" sheet shows above its line. */
export const PLUS_TURNS_SHOWN = param({ key: 'assistant.plusTurnsShown', scope: PARAM_SCOPE.DEVICE, kind: PARAM_KIND.INTERNAL, default: 20 });

/** The person's own "+" thread id: one per person on this device, never a circle's. Null without a self. */
export function plusThreadId(selfRef) {
  return typeof selfRef === 'string' && selfRef ? `own:${selfRef}` : null;
}

/**
 * @param {object} a
 * @param {ReturnType<import('./botThreads.js').createBotThreads>} a.threads   the bot threads over this device's log
 * @param {string|null} a.threadId                                          `plusThreadId(self)`
 */
export function createPlusThread({ threads, threadId } = {}) {
  if (!threads?.memory) throw new TypeError('createPlusThread: bot threads are required');
  return {
    threadId,
    /** The person's line, as they typed it. */
    heard(text) { if (threadId) threads.memory.remember(threadId, 'you', text); },
    /** What the "+" answered: what it did, what it asks, or that it could not read the line. */
    answered(text) { if (threadId) threads.memory.remember(threadId, 'assistant', text); },
    /** The last `n` turns, oldest first: `{who: 'you'|'assistant'|'system', text, ts}`. */
    turns(n = PLUS_TURNS_SHOWN) { return threadId ? threads.memory.turns(threadId, n) : []; },
    /** Empty the thread now; returns how many turns went. */
    forget() { return threadId ? threads.memory.forget(threadId) : 0; },
  };
}
