/**
 * A QUESTION finds what it asks about. Without an embedder the retriever is lexical, and a question carries words the
 * item does not ("waar", "staat", "wanneer"): the index's search matches only when every word is in the item, so a
 * question found nothing (measured 2026-11-16: "sleutel" found the note, "waar ligt de sleutel?" did not), in every
 * door with no embed route. The lexical tier ranks by the words a line and an item share, as `lexicalRank` says.
 */
import { describe, it, expect } from 'vitest';
import { makeCircleRetriever } from '../../src/v2/circleRetriever.js';

const items = [
  { id: 'n1', type: 'note', text: 'de sleutel ligt bij de buren' },
  { id: 'n2', type: 'note', text: 'melk halen' },
];

describe('lexical retrieval answers a question', () => {
  it('"waar ligt de sleutel?" finds the key note, and not the milk', async () => {
    const r = makeCircleRetriever({ loadItems: async () => items });
    const out = await r('waar ligt de sleutel?', {});
    expect(out.map((e) => e.id)).toEqual(['n1']);
  });
  it('a line that shares no word finds nothing (no irrelevant context)', async () => {
    const r = makeCircleRetriever({ loadItems: async () => items });
    expect(await r('hoe laat is het?', {})).toEqual([]);
  });
});
