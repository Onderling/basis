/**
 * chunkBubble — split a long bubble into a preview HEAD and the REST, at a natural boundary.
 *
 * A bot answer can run to several paragraphs. Rendering it whole overflows the bubble; cutting it at a
 * fixed character count cuts mid-word. So the preview ends at the latest natural boundary inside the
 * budget — paragraph break, then line break, then sentence end, then space — and the shells render a
 * "show more" toggle when `rest` is non-empty. Text that fits comes back with `rest: ''`, which the
 * shells paint as an ordinary bubble with no toggle.
 *
 * Shared web ≡ mobile so both chunk identically: `web/v2/circleView.js` and mobile's
 * `CircleLauncherScreen` both call it for bot lines in the ORDINARY circle view.
 *
 * Lifted here 2026-09-01 from `src/feedback/feedbackSurface.js`, where it had been living. It was never
 * a feedback concern — it is a chat-bubble concern that happened to be written while building one — and
 * parking the feedback feature out of basis would have taken the circle view's bot bubbles with it.
 *
 * @param {string} text
 * @param {number} [max=320]  soft length budget for the preview
 * @returns {{head: string, rest: string}}
 */
export function chunkBubble(text, max = 320) {
  const s = String(text ?? '');
  if (s.length <= max) return { head: s, rest: '' };
  const lo = Math.floor(max * 0.6);                 // don't cut earlier than 60% of the budget
  const slice = s.slice(0, max);
  // Prefer the latest natural boundary within [lo, max]: paragraph break > line break > sentence end > space.
  // Cut AFTER the delimiter (`+ len`) so the preview keeps the sentence/word intact and `rest` starts clean.
  const sentence = Math.max(slice.lastIndexOf('. '), slice.lastIndexOf('! '), slice.lastIndexOf('? '));
  const b = [
    { i: slice.lastIndexOf('\n\n'), len: 2 },
    { i: slice.lastIndexOf('\n'), len: 1 },
    { i: sentence, len: 2 },
    { i: slice.lastIndexOf(' '), len: 1 },
  ].find((x) => x.i >= lo);
  const at = b ? b.i + b.len : max;                 // no good boundary → hard cut at the budget
  return { head: s.slice(0, at).trimEnd(), rest: s.slice(at).trimStart() };
}
