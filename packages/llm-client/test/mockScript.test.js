/**
 * The mock provider's SCRIPT mode — a stand-in model for tests that run the whole route (the prompt the engine
 * builds, the tools it hands over, how the answer is read): each entry answers the first request whose newest member
 * message matches it, once, in order. Two entries for one line answer a read-then-act turn: the read first, the act
 * after. A line the script does not know is answered with nothing (no tool, no words), as a model that declines.
 */
import { describe, it, expect } from 'vitest';
import { mockProvider } from '../src/providers/mock.js';

const req = (text) => ({ system: 's', messages: [{ role: 'user', content: text }], tools: [] });

describe('mockProvider script mode', () => {
  it('answers in order, each entry once; a read then an act for the same line', async () => {
    const p = mockProvider({ script: [
      { when: 'haal de melk eraf', toolCall: { id: 'listEntries', args: { list: 'Boodschappen' } } },
      { when: 'haal de melk eraf', toolCall: { id: 'removeFromList', args: { item: 'melk' } } },
      { when: /^hallo/i, replyText: 'Hoi!' },
    ] });
    expect((await p.invoke(req('haal de melk eraf'))).toolCall).toEqual({ id: 'listEntries', args: { list: 'Boodschappen' } });
    expect((await p.invoke(req('haal de melk eraf'))).toolCall).toEqual({ id: 'removeFromList', args: { item: 'melk' } });
    expect((await p.invoke(req('Hallo daar'))).replyText).toBe('Hoi!');
    const none = await p.invoke(req('iets anders'));
    expect(none.toolCall).toBeNull();
    expect(none.replyText).toBeNull();
  });

  it('it can say what it was asked (the prompt, the tools), so a spec checks the whole route', async () => {
    const seen = [];
    const p = mockProvider({ script: [{ when: 'x', replyText: 'y' }], onRequest: (r) => seen.push(r) });
    await p.invoke({ system: 'the rules', messages: [{ role: 'user', content: 'x' }], tools: [{ name: 'addToList' }] });
    expect(seen[0].tools.map((t) => t.name)).toEqual(['addToList']);
  });
});
