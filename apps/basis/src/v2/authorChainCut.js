/**
 * WHERE AN AUTHOR STOPPED, by their own hash chain: every statement an author signs on a lane names their previous one
 * there (`parentHash`), so "signed before X" is provable — it is X or one of X's ancestors along that author's own
 * chain — the same on every device, in any arrival order, with no clock. Used where a later statement of the same
 * author draws a line: a re-key retiring an address (`upTo`), and a settings change raising the rule the author's own
 * later acts are judged by (their earlier ones keep the rule they were signed under).
 */

/** Is `hash` the statement `upTo` or one of its ancestors along `author`'s own parent chain? `chainOf(hash)` → the body. */
export function inAuthorChainUpTo(chainOf, author, upTo, hash) {
  if (hash === upTo) return true;
  let at = upTo;
  for (let steps = 0; steps < 100000 && at; steps++) {
    const b = chainOf(at);
    if (!b || b.author !== author) return false;   // a gap, or the chain leaves the author: not provably before the cut
    at = b.parentHash ?? null;
    if (at === hash) return true;
  }
  return false;
}
