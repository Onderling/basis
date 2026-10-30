/**
 * A circle an admin removed me from stays in my list, MARKED, until I close it: the launcher's one source lists it
 * with `removed: true`, and the composer gate every shell asks says it cannot be posted to, with the words that say so.
 */
import { describe, it, expect } from 'vitest';
import { circleSourcesFromAgent } from '../../src/v2/circleSources.js';
import { loadCircles, loadRemovedCircles } from '../../src/v2/circleModel.js';
import { composerGate } from '../../src/v2/circlePolicy.js';

describe('a removed circle in the launcher', () => {
  it('is a tile of its own, with its name, marked removed — never in the main list', async () => {
    const callSkill = async (op) => (op === 'listMyCircles'
      ? { circles: ['kept'], names: { kept: 'Blijft' }, left: [], removed: [{ id: 'gone', name: 'Weg' }] }
      : { circles: [] });
    const sources = circleSourcesFromAgent({ callSkill });
    expect(await loadRemovedCircles(sources)).toEqual([expect.objectContaining({ id: 'gone', name: 'Weg', removed: true })]);
    // …and never in the main list, which sharing, invites and presence read
    expect((await loadCircles(sources)).map((c) => c.id)).toEqual(['kept']);
  });
  it('cannot be posted to; the gate names the words and the close', () => {
    expect(composerGate(null, { id: 'gone', removed: true })).toEqual({ canPost: false, noteKey: 'circle.membership.removed_note', canClose: true });
    expect(composerGate(null, { id: 'kept' })).toEqual({ canPost: true, noteKey: null, canClose: false });
    expect(composerGate({ features: { chat: false } }, { id: 'kept' })).toEqual({ canPost: false, noteKey: 'circle.view.chat_disabled', canClose: false });
  });
});
