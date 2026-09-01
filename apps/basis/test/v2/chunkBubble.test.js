/**
 * chunkBubble — the bot bubble's preview cut.
 *
 * Moved here 2026-09-01 with the function itself, out of `test/feedback/feedbackSurface.test.js`. Both
 * shells call it for bot lines in the ORDINARY circle view, so it outlives the feedback feature that
 * happened to be under construction when it was written.
 */
import { test, expect } from 'vitest';
import { chunkBubble } from '../../src/v2/chunkBubble.js';

test('chunkBubble — short text is not chunked; long text splits at a boundary and round-trips', () => {
  expect(chunkBubble('kort bericht')).toEqual({ head: 'kort bericht', rest: '' });

  const long = `${'Dit is een lange samenvatting. '.repeat(20)}Einde.`;
  const { head, rest } = chunkBubble(long, 120);
  expect(head.length).toBeLessThanOrEqual(120);
  expect(rest).not.toBe('');
  // no content lost (modulo the trimmed boundary whitespace)
  expect((head + ' ' + rest).replace(/\s+/g, ' ').trim()).toBe(long.replace(/\s+/g, ' ').trim());
  // preferred a sentence boundary (head ends on a period, not mid-word)
  expect(head.endsWith('.')).toBe(true);
});

test('chunkBubble — a hard cut when there is no boundary in-window', () => {
  const noSpaces = 'x'.repeat(500);
  const { head, rest } = chunkBubble(noSpaces, 200);
  expect(head.length).toBe(200);
  expect(rest.length).toBe(300);
});
