/**
 * profileFactsSync — the pure half: newest-wins by `factsAt`, the sibling gate, and the router that binds a landing to
 * a self by WHO SENT IT. The relay walk (`profileFactsFollow.relay.test.js`) proves it crossing a real socket.
 */
import { describe, it, expect } from 'vitest';
import { createProfileFactsSync, routeProfileFactsBySender, PROFILE_FACTS_CARRY, PROFILE_FACTS_CATCHUP_SUBTYPES } from '../../src/v2/profileFactsSync.js';

const facts = (at, place = 'Utrecht') => ({ properties: { location: { mode: 'own', value: place } }, disclosure: { perContext: {} }, factsAt: at });
function rig({ sibs = ['sib'], here = facts(100) } = {}) {
  const sent = []; const stored = []; const refused = [];
  let cur = here;
  const sync = createProfileFactsSync({
    siblings: async () => sibs,
    sendToPeer: async (to, payload) => { sent.push({ to, payload }); },
    current: async () => cur,
    store: async (f) => { stored.push(f); cur = f; return true; },
    onRefused: (r, from) => refused.push({ r, from }),
  });
  return { sync, sent, stored, refused };
}
const carry = (f) => ({ subtype: PROFILE_FACTS_CARRY, ...f });

describe('profileFactsSync', () => {
  it('newer facts land; older or equal ones are left; a stranger is refused', async () => {
    const { sync, stored, refused } = rig();
    await sync.handlers[PROFILE_FACTS_CARRY]('sib', carry(facts(50, 'Oud')));
    await sync.handlers[PROFILE_FACTS_CARRY]('sib', carry(facts(100, 'Zelfde')));
    expect(stored).toEqual([]);
    await sync.handlers[PROFILE_FACTS_CARRY]('sib', carry(facts(200, 'Amersfoort')));
    expect(stored.map((f) => f.properties.location.value)).toEqual(['Amersfoort']);
    await sync.handlers[PROFILE_FACTS_CARRY]('stranger', carry(facts(300, 'Elders')));
    expect(refused.map((r) => r.r)).toEqual(['not-a-sibling']);
  });
  it('a catch-up request from a sibling is answered with this device\'s facts; the live fan goes to every sibling', async () => {
    const { sync, sent } = rig({ sibs: ['a', 'b'] });
    await sync.handlers[PROFILE_FACTS_CATCHUP_SUBTYPES.request]('a', { subtype: PROFILE_FACTS_CATCHUP_SUBTYPES.request });
    expect(sent.map((s) => [s.to, s.payload.factsAt])).toEqual([['a', 100]]);
    sent.length = 0;
    expect((await sync.fan()).attempted).toBe(2);
  });
  it('the router binds a landing to the self whose siblings sent it — a persona\'s device never lands the general facts', async () => {
    const general = rig({ sibs: ['g-dev'] }); const persona = rig({ sibs: ['w-dev'] });
    const r = routeProfileFactsBySender({ all: () => [general.sync, persona.sync], forSelf: (pid) => (pid === 'w' ? persona.sync : general.sync) });
    await r.handlers[PROFILE_FACTS_CARRY]('w-dev', carry(facts(500, 'Werkplek')));
    expect(persona.stored.length).toBe(1);
    expect(general.stored.length).toBe(0);
  });
});
