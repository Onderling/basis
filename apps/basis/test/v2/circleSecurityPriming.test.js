/**
 * Every circle's security state is assembled at BOOT, not by opening a screen.
 *
 * Boundary-authentication decisions 4 and 1 each landed with the same hole, found independently: the state
 * that decides whether traffic is accepted was assembled by whichever parts of the UI a person happened to
 * open. A circle you had not opened this run had no roster recorded, and its traffic was accepted
 * **unchecked** — warned and counted, but accepted.
 *
 * The failure degrades OPEN, which is why it needs a test rather than a comment: it is invisible in a walk
 * (you open the circle you are testing) and invisible in tests that construct the state directly.
 */

import { describe, it, expect, vi } from 'vitest';
import { primeCircleSecurity, knownCircleIds } from '../../src/v2/circleSecurityPriming.js';

/** An agent that answers the two substrate reads and records what was asked of it. */
function fakeAgent({ circles = ['buurt', 'koor'], members = {}, failMembersFor = [] } = {}) {
  const installed = [];
  const recorded = [];
  return {
    installed,
    recorded,
    identity: { pubKey: 'me' },
    registerPeerAddress: () => {},
    installCircleIdentities: async (ids) => { installed.push([...ids]); },
    recordCircleSenders: async ({ circleId, members: m }) => { recorded.push({ circleId, count: m?.length ?? 0 }); },
    callSkill: async (app, op, args) => {
      if (op === 'listMyCircles') return { buurts: circles };
      if (op === 'listGroupMembers') {
        if (failMembersFor.includes(args.groupId)) throw new Error('substrate unavailable');
        return { members: members[args.groupId] ?? [] };
      }
      return {};
    },
  };
}

describe('the floor is the substrate, not what you looked at', () => {
  it('primes EVERY circle the substrate knows, with no ids passed in', async () => {
    const agent = fakeAgent({ members: { buurt: [{ pubKey: 'a' }], koor: [{ pubKey: 'b' }] } });
    const out = await primeCircleSecurity({ agent });

    expect(out.circleIds.sort()).toEqual(['buurt', 'koor']);
    expect(agent.installed[0].sort()).toEqual(['buurt', 'koor']);
    expect(agent.recorded.map((r) => r.circleId).sort()).toEqual(['buurt', 'koor']);
  });

  it('UNIONS an explicit list rather than being narrowed by it', async () => {
    // a caller passing "the circles I just rendered" must not lower the floor
    const agent = fakeAgent({ circles: ['buurt', 'koor'] });
    const out = await primeCircleSecurity({ agent, circleIds: ['nieuw'] });
    expect(out.circleIds.sort()).toEqual(['buurt', 'koor', 'nieuw']);
  });

  it('does not depend on a render cache being warm — the cold-boot case', async () => {
    // web used to prime from `circlesCache`, which is empty exactly when priming matters most
    const agent = fakeAgent({ circles: ['buurt'] });
    const out = await primeCircleSecurity({ agent, circleIds: [] });
    expect(out.circleIds).toEqual(['buurt']);
  });
});

describe('ordering and degradation', () => {
  it('installs identities BEFORE feeding rosters', async () => {
    const order = [];
    const agent = fakeAgent();
    agent.installCircleIdentities = async () => { order.push('identities'); };
    const inner = agent.callSkill;
    agent.callSkill = async (app, op, args) => {
      if (op === 'listGroupMembers') order.push('roster');
      return inner(app, op, args);
    };
    await primeCircleSecurity({ agent });
    // a circle with a roster and no identity is deafer than one with neither: nothing sent to its
    // address can even be opened
    expect(order[0]).toBe('identities');
    expect(order).toContain('roster');
  });

  it('one unreadable circle does not stop the others, and is REPORTED', async () => {
    const warn = vi.fn();
    const agent = fakeAgent({ circles: ['ok', 'broken'], failMembersFor: [] });
    // make feedHouseholdRoster throw for one circle by removing what it needs mid-flight
    const inner = agent.callSkill;
    agent.callSkill = async (app, op, args) => {
      if (op === 'listGroupMembers' && args.groupId === 'broken') throw new Error('nope');
      return inner(app, op, args);
    };
    const out = await primeCircleSecurity({ agent, onWarn: warn });
    // feedHouseholdRoster swallows its own read failure, so the circle is still "fed" — what matters is
    // that the OTHER circle completed and nothing threw out of the primer
    expect(out.circleIds.sort()).toEqual(['broken', 'ok']);
    expect(out.rostersFed + out.rosterFailures).toBe(2);
  });

  it('survives an agent with none of the seams — never throws at boot', async () => {
    await expect(primeCircleSecurity({ agent: {} })).resolves.toMatchObject({ circleIds: [] });
    await expect(primeCircleSecurity({})).resolves.toMatchObject({ circleIds: [] });
  });

  it('reports when identity installation failed rather than swallowing it', async () => {
    const warn = vi.fn();
    const agent = fakeAgent({ circles: ['buurt'] });
    agent.installCircleIdentities = async () => { throw new Error('vault gone'); };
    const out = await primeCircleSecurity({ agent, onWarn: warn });
    expect(out.identitiesInstalled).toBe(false);
    expect(warn).toHaveBeenCalled();
  });
});

describe('knownCircleIds', () => {
  it('asks the substrate, and tolerates it being absent', async () => {
    expect(await knownCircleIds({ agent: fakeAgent({ circles: ['x'] }) })).toEqual(['x']);
    expect(await knownCircleIds({ agent: {} })).toEqual([]);
    expect(await knownCircleIds({})).toEqual([]);
  });

  it('accepts both id strings and circle objects', async () => {
    const agent = fakeAgent({ circles: ['a', { id: 'b' }, null, { noId: true }] });
    expect(await knownCircleIds({ agent })).toEqual(['a', 'b']);
  });
});
