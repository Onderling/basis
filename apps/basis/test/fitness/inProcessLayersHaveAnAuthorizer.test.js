/**
 * Every in-process layer has a sender authorizer, and none accepts an envelope by ABSENCE of one.
 *
 * A real boot used to print "NO ROSTER AUTHORIZER INSTALLED" five times — once per in-process app agent, each
 * accepting any key that signed correctly. Each is now closed to the keys its bus adopted (the chat agent's), so this
 * counts, per layer, what the warning only said once: the authorizer is installed, and after real traffic through
 * every agent nothing passed without one. A count, not a grep of the warning text — the text can change, the
 * number cannot lie. (The wire-facing peer agent's roster authorizer is pinned by senderAuthorizationIsWiredOnce.)
 */
import { describe, it, expect } from 'vitest';
import { createRealHouseholdAgent } from '../../src/web/realAgent.js';

describe('in-process layers', () => {
  it('each has an authorizer, and after traffic none accepted by absence', { timeout: 120_000 }, async () => {
    const agent = await createRealHouseholdAgent({ seedHousehold: true });
    // traffic through every in-process agent the boot adopted
    await agent.callSkill('household', 'listOpen', {}).catch(() => {});
    await agent.callSkill('pinboard', 'listMyCircles', {}).catch(() => {});
    await agent.callSkill('tasks', 'listOpen', {}).catch(() => {});
    await agent.callSkill('folio', 'listFiles', {}).catch(() => {});
    const layers = agent.inProcessAuthorization();
    expect(Object.keys(layers).sort()).toEqual(['folio', 'host', 'household', 'pinboard', 'tasks']);
    for (const [name, stat] of Object.entries(layers)) {
      if (stat === null) continue;   // an agent this composition does not build (none today, but say which)
      expect(stat.installed, `${name}: no sender authorizer`).toBe(true);
      expect(stat.byAbsence, `${name}: envelopes accepted with no authorizer`).toBe(0);
      expect(stat.refused, `${name}: an adopted peer was refused`).toBe(0);
    }
    expect(Object.values(layers).filter(Boolean).length, 'the accessor reaches every layer').toBe(5);
  });
});
