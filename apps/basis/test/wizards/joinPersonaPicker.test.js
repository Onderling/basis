/**
 * THE PERSONA PICKER AT JOIN — painted on both shells, and until 2026-09-23 it could never appear.
 *
 * `loadPersonas` reads `reply.agents`. The one route both shells reach `agents` ops through
 * (`realAgent.js`, the `appOrigin === 'agents'` branch) converts the registry's `{agents:[…]}` into the
 * chat renderer's `{items:[{id,label}]}` — a PRESENTATION adapter sitting in the routing path, so every
 * programmatic caller gets the presentation shape too. `reply.agents` was therefore always undefined, the
 * list was always empty, and a picker that renders only when the list is non-empty was invisible on web and
 * mobile alike. Its own tests passed the whole time: they hand it personas directly.
 *
 * Mij survived the same broken read only because `mijLoader` synthesises a `default` row when the list comes
 * back empty — which is why personas look fine there and the join step never asks.
 */
import { describe, it, expect } from 'vitest';
import { loadPersonas } from '../../src/core/wizards/joinGroupState.js';

/** What the route ACTUALLY hands back — the shape the shells receive, not the one the registry returns. */
const routedReply = {
  items: [
    { agentId: 'default', name: 'Frits', role: 'profile', id: 'default', label: 'Frits' },
    { agentId: 'buurt', name: 'Buurt', role: 'profile', id: 'buurt', label: 'Buurt' },
    { agentId: 'bot-1', name: 'Onderling', role: 'assistant', id: 'bot-1', label: 'Onderling' },
  ],
};
/** What the registry core returns, before the adapter — some callers do see this. */
const rawReply = { agents: routedReply.items.map(({ id, label, ...a }) => a) };

describe('loadPersonas — the join picker has something to offer', () => {
  it('reads the shape the SHELLS actually get', async () => {
    const personas = await loadPersonas({ callSkill: async () => routedReply });
    expect(personas, 'the two profiles, not the assistant').toEqual([
      { id: 'default', name: 'Frits' },
      { id: 'buurt', name: 'Buurt' },
    ]);
  });

  it('still reads the registry shape, for any caller that gets it unadapted', async () => {
    const personas = await loadPersonas({ callSkill: async () => rawReply });
    expect(personas.map((p) => p.id)).toEqual(['default', 'buurt']);
  });

  it('offers nothing when the call fails — join minimally is the protective default', async () => {
    expect(await loadPersonas({ callSkill: async () => { throw new Error('no'); } })).toEqual([]);
    expect(await loadPersonas({ callSkill: async () => ({}) })).toEqual([]);
  });

  it('only PROFILES are personas — an assistant is not one of your faces', async () => {
    const personas = await loadPersonas({ callSkill: async () => ({ items: [{ agentId: 'bot', name: 'B', role: 'assistant' }] }) });
    expect(personas).toEqual([]);
  });
});
