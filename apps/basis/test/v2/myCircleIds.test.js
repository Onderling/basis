/**
 * `listMyCircles` answers plain ids. The pod read-back on coming back to the front, its boot kick and the phone's
 * background slot read their circles from it; mapped as objects, every id became nothing and they read no circle.
 * (No shell maps the answer as objects only: scripts/lint-my-circle-ids.mjs, in `npm run guards`.)
 */
import { describe, it, expect } from 'vitest';
import { circleIdsFrom, myCircleIds } from '../../src/v2/myCircleIds.js';
import { createPodReadBack } from '../../src/v2/podReadBack.js';

describe("the circles this device is in, from listMyCircles's answer", () => {
  it('plain ids (what the op answers) come back as ids; object rows too; anything else is dropped', () => {
    expect(circleIdsFrom({ circles: ['a', 'b'] })).toEqual(['a', 'b']);
    expect(circleIdsFrom({ circles: [{ groupId: 'c' }, { id: 'd' }, null, '', 7] })).toEqual(['c', 'd']);
    expect(circleIdsFrom(null)).toEqual([]);
  });

  it('coming back to the front reads every circle the op lists', async () => {
    const read = [];
    const callSkill = async (app, op) => (app === 'pinboard' && op === 'listMyCircles' ? { circles: ['a', 'b'] } : null);
    const rb = createPodReadBack({
      catchUp: { catchUpCircle: async (cid) => { read.push(cid); return { ingested: 1 }; } },
      listCircleIds: () => myCircleIds(callSkill), subscribeOpened: null,
    });
    expect(await rb.onForeground()).toEqual({ ingested: 2 });
    expect(read).toEqual(['a', 'b']);
  });

});
