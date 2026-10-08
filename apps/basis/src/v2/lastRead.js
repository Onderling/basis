/**
 * lastRead — what a person just READ, handed to the model for the ONE turn after it.
 *
 * A short follow-up after a read ("en nu?", "wat staat er nog op") is about that list. The thread's memory carries the
 * last turns as a conversation; this adds the read itself — the list's title and its lines, capped — as a line of the
 * next turn's own part of the prompt (below the turn marker), so the model knows which list "it" is. One turn only: a
 * turn later it is gone (a new read replaces it). Kept for the process, never written anywhere; a person who keeps no
 * memory (`/geheugen off`) is kept nothing here either.
 */
import { param, PARAM_SCOPE, PARAM_KIND } from '@onderling/item-store';

/** How many of a read's lines the model is handed after it. */
export const LAST_READ_MAX_LINES = param({ key: 'assistant.lastReadMaxLines', scope: PARAM_SCOPE.DEVICE, kind: PARAM_KIND.INTERNAL, default: 12 });
/** …and in how many characters at most. */
export const LAST_READ_MAX_CHARS = param({ key: 'assistant.lastReadMaxChars', scope: PARAM_SCOPE.DEVICE, kind: PARAM_KIND.INTERNAL, default: 600 });

/**
 * A read as the model is handed it: its title, then its lines, cut at the caps with how many were left out. LLM-facing.
 * @param {{title?: string|null, lines?: string[]}} read
 * @returns {string|null}
 */
export function lastReadLine({ title = null, lines = [] } = {}) {
  const name = String(title ?? '').trim() || 'a list';
  const all = (Array.isArray(lines) ? lines : []).map((l) => String(l ?? '').trim()).filter(Boolean);
  const head = `The member just read ${name} (a short follow-up such as "en nu?" or "wat staat er nog op" is about this list; to show it again, call the same read):`;
  if (!all.length) return `${head}\n(empty)`;
  const kept = [];
  let size = 0;
  for (const l of all.slice(0, LAST_READ_MAX_LINES)) {
    const line = `- ${l}`;
    if (size + line.length + 1 > LAST_READ_MAX_CHARS) break;
    kept.push(line);
    size += line.length + 1;
  }
  const more = all.length - kept.length;
  return [head, ...kept, ...(more > 0 ? [`(and ${more} more)`] : [])].join('\n');
}

/**
 * The last reads of a door's threads, each for one turn.
 * @param {{keeps?: (threadId: string) => boolean}} [a]  does this thread keep memory at all (false: nothing is kept)
 */
export function createLastReads({ keeps = () => true } = {}) {
  /** threadId → { line, fresh }: `fresh` while the turn that read it runs */
  const byThread = new Map();
  return {
    /** A read was shown in this thread's turn. */
    saw(threadId, read) {
      if (!threadId || !keeps(threadId)) { byThread.delete(threadId); return; }
      const line = lastReadLine(read);
      if (line) byThread.set(threadId, { line, fresh: true });
    },
    /** The lines the model is handed for this thread now (the read of the turn before, if any). */
    hintsFor(threadId) {
      const e = byThread.get(threadId);
      return e && keeps(threadId) ? [e.line] : [];
    },
    /** A turn of this thread ended: the read it made lives one turn more; an older one goes. */
    turnEnded(threadId) {
      const e = byThread.get(threadId);
      if (!e) return;
      if (e.fresh) e.fresh = false;
      else byThread.delete(threadId);
    },
  };
}
