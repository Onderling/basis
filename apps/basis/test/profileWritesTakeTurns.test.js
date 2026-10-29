/**
 * ONE WRITE AT A TIME PER PROFILE. A profile is written whole (read it, change it, write it back), so two writers of one
 * profile at once used to lose one: a join's circle record went missing when a rename landed in between (the two-devices
 * walk, 2026-10-26). Through the real composition: many circle records and a rename written at once all survive.
 */
import { describe, it, expect, afterAll } from 'vitest';
import { bootRealAgentNode, teardown } from './support/pairRealAgents.js';

describe('writers of one profile take turns', () => {
  const nodes = [];
  afterAll(async () => { await teardown(...nodes); });

  it('ten circle records and a rename written at once: every one is on the profile afterwards', async () => {
    const node = await bootRealAgentNode('turns'); nodes.push(node);
    const call = (app, op, args = {}) => node.agent.callSkill(app, op, args);
    const ids = Array.from({ length: 10 }, (_, i) => `turns-circle-${i}`);
    await Promise.all([
      ...ids.map((circleId, i) => call('agents', 'setProfileCircleMembership', { id: 'default', circleId, handle: `h${i}x`, address: `addr-${i}` })),
      call('pinboard', 'setMyDisplayName', { displayName: 'Bea B.' }),
      call('agents', 'setProfileProperty', { id: 'default', key: 'place', value: 'Groningen' }),
    ]);
    const props = (await call('agents', 'getProfileProperties', { id: 'default' }))?.properties ?? {};
    const memberships = props.circleMemberships?.value ?? props.circleMemberships ?? {};
    expect(ids.filter((id) => !memberships[id]), 'circle records lost').toEqual([]);
    expect(props.name?.value ?? props.name).toBe('Bea B.');
    expect(props.place?.value ?? props.place).toBe('Groningen');
  }, 60_000);
});
