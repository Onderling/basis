/**
 * S4 §2 — the pod-backed circle journeys (J-NP1 … J-NP6), walked headlessly against REAL components.
 * SCRATCH VERSION — iterating.
 */
import { describe, it, expect, beforeAll } from 'vitest';
import 'fake-indexeddb/auto';

import {
  bootRealAgentNode, connectAgentsOverBus, createCircle, teardown, until, bindCircleAddresses,
} from '../support/pairRealAgents.js';
import { buildCircleInviteUri, joinCircleFromInvite } from '../../src/v2/circleInvite.js';
import { loadCircleStoragePod, pushCircleStoragePolicy } from '../../src/v2/circleStoragePolicy.js';
import { createConnectionPoints, recordJoinedCirclePoints } from '../../src/v2/connectionPoints.js';
import { decodeInvite, initialState } from '../../src/core/wizards/joinGroupState.js';

const CSS_URL = process.env.CSS_URL || 'http://localhost:3000/';

let cssUp = false;
beforeAll(async () => {
  try { cssUp = (await fetch(CSS_URL, { method: 'HEAD' })).ok; } catch { cssUp = false; }
  // eslint-disable-next-line no-console
  console.log('[walk] CSS at', CSS_URL, 'reachable:', cssUp);
});

import {
  initialState as createGroupInitialState,
  finalSubmit as createGroupFinalSubmit,
} from '../../src/core/wizards/createGroupState.js';

async function createPodCircle(admin, { groupId, groupPodUri }) {
  const cs = (app, op, args) => admin.agent.callSkill(app, op, args);
  const state = createGroupInitialState();
  state.groupId = groupId; state.name = groupId; state.purpose = 'pod walk';
  state.storagePolicy = 'centralised';
  state.groupPodUri = groupPodUri;
  const { result, state: out } = await createGroupFinalSubmit({ state, callSkill: cs });
  if (!result) throw new Error(`create failed: ${out?.submitError}`);
  return result;
}

describe('probe', () => {
  it('storage policy via CREATE, then invite', async () => {
    const anna = await bootRealAgentNode('anna');
    const cs = (app, op, args) => anna.agent.callSkill(app, op, args);
    const podUri = `${CSS_URL}anna/circles/podkring`;
    const created = await createPodCircle(anna, { groupId: 'podkring', groupPodUri: podUri });
    console.log('[walk] created keys =', Object.keys(created ?? {}).join(','));
    const read = await loadCircleStoragePod({ callSkill: cs, circleId: 'podkring' });
    console.log('[walk] read =', JSON.stringify(read));
    const podBacked = read?.pod === 'shared' || read?.pod === 'hybrid';
    const inv = await buildCircleInviteUri({
      callSkill: cs, circleId: 'podkring', adminPeerAddr: anna.pubKey,
      podBacked, podUrl: podBacked ? (read?.groupPodUri ?? null) : null,
    });
    const st = initialState();
    decodeInvite(inv.uri, st);
    console.log('[walk] decoded =', JSON.stringify(st.invite));

    // and the same again with an https pod url
    const podUriHttps = 'https://pod.example.org/anna/circles/podkring2';
    await createPodCircle(anna, { groupId: 'podkring2', groupPodUri: podUriHttps });
    const read2 = await loadCircleStoragePod({ callSkill: cs, circleId: 'podkring2' });
    const inv2 = await buildCircleInviteUri({
      callSkill: cs, circleId: 'podkring2', adminPeerAddr: anna.pubKey,
      podBacked: true, podUrl: read2?.groupPodUri ?? null,
    });
    const st2 = initialState();
    decodeInvite(inv2.uri, st2);
    console.log('[walk] decoded2 =', JSON.stringify(st2.invite));

    const cp = createConnectionPoints({});
    console.log('[walk] record http =', JSON.stringify(recordJoinedCirclePoints({ store: cp, invite: st.invite, circleId: 'podkring' })));
    console.log('[walk] record https =', JSON.stringify(recordJoinedCirclePoints({ store: cp, invite: st2.invite, circleId: 'podkring2' })));
    console.log('[walk] points =', JSON.stringify(cp.list()));
    await teardown(anna);
    expect(true).toBe(true);
  }, 60000);
});
