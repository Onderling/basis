/**
 * A post in a circle resonates with the drivers of the self this device is IN that circle (a persona's circle is the
 * persona's): the device acts as that circle's self. A persona's own driver never resonates in a default circle.
 */
import { describe, it, expect } from 'vitest';
import { makeHandleCirclePost } from '../src/core/handlers/circlePost.js';

const DRIVERS = {
  default: { tuin: { kind: 'offering', text: 'Tuinieren', tags: ['tuin'] } },
  'p-buurt': { fiets: { kind: 'offering', text: 'Fietsen maken', tags: ['fiets'] } },
};

function world() {
  const notices = [];
  const callSkill = async (app, op, args) => {
    if (app === 'agents' && op === 'getProfileDrivers') return { drivers: DRIVERS[args?.id] ?? {} };
    return { ok: true, itemId: 'i1' };
  };
  const handle = makeHandleCirclePost({
    callSkill, logger: {},
    publishEvent: (e) => { if (e?.payload?.driverMatch) notices.push(e.payload.groupId); },
    profileIdOf: (circleId) => (circleId === 'straat' ? 'p-buurt' : 'default'),
  });
  return { handle, notices };
}
const post = (groupId, tags) => ({ groupId, fromPubKey: 'x', payload: { requestId: `r-${groupId}-${tags[0]}`, text: 'iemand?', skillTags: tags } });

describe('a circle post resonates with that circle\'s self', () => {
  it('Buurt\'s own driver resonates in Buurt\'s circle, and not in a default circle', async () => {
    const { handle, notices } = world();
    await handle('peer', post('straat', ['fiets']));
    await handle('peer', post('thuis', ['fiets']));
    expect(notices).toEqual(['straat']);
  });
  it('the default\'s driver resonates in a default circle', async () => {
    const { handle, notices } = world();
    await handle('peer', post('thuis', ['tuin']));
    expect(notices).toEqual(['thuis']);
  });
});
