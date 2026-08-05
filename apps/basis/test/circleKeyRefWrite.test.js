/**
 * basis — node-level regression for the wrapped-key POINTER write, the robustness half of registry
 * restore-and-open. A pod-backed circle's provisioned cache medium tags itself with WHERE its group-key
 * resource lives (`keyRef` = the deterministic pod URI + posture; in production the shells derive it from
 * `prod.circleRootUri` + `policy.storagePosture`). realAgent records that pointer onto the circle's
 * membership record at circle-open, so a wiped/restored device re-attaches by an EXPLICIT reference (which
 * survives a routing/scheme change or a relocated pod), not only by re-deriving the URI.
 *
 * The seam: a medium carrying `.keyRef` → `ensureCircleSync` → a FACET MERGE onto the existing
 * {handle,address} membership record (never a secret — only a pod-URI pointer + posture). We inject the
 * medium directly (no CSS/pod needed) and assert the record gains the key facet without losing the rest.
 */
import { describe, it, expect, afterAll } from 'vitest';
import { memoryDataSource } from '@onderling/item-store';
import { circleMembershipsOf } from '@onderling/agent-registry';

import { bootRealAgentNode, teardown } from './support/pairRealAgents.js';

const CIRCLE = 'pod-backed-circle';
const KEYREF = { ref: 'https://pod.example/circles/pod-backed-circle/.keys/group.json', posture: 'p2' };

/** A minimal pod-backed medium: a real empty DataSource, tagged with a keyRef + a no-op catchUp. */
const mediumWithKeyRef = () => Object.assign(memoryDataSource(), { keyRef: KEYREF, catchUp: async () => ({ pulled: 0 }) });

describe('circle key-ref write — a pod-backed circle records its group-key pointer on the membership record', () => {
  let A;
  afterAll(async () => { await teardown(A); });

  it('ensureCircleSync merges the medium keyRef into the existing membership record, keeping handle/address', async () => {
    A = await bootRealAgentNode('keyref', {
      agentOpts: {
        // Only the target circle is pod-backed; every other circle → null → local backing (unchanged).
        provisionCircleMedium: async (id) => (id === CIRCLE ? mediumWithKeyRef() : null),
      },
    });

    // write-on-join records {handle,address}; the key facet does NOT exist yet.
    const wrote = await A.agent.callSkill('agents', 'setProfileCircleMembership', {
      id: 'default', circleId: CIRCLE, handle: 'anne', address: 'relay:anne-addr',
    });
    expect(wrote?.ok, 'the membership record was written at join').toBe(true);

    const before = circleMembershipsOf({ properties: (await A.agent.callSkill('agents', 'getProfileProperties', { id: 'default' }))?.properties ?? {} })[CIRCLE];
    expect(before?.handle, 'record exists with handle').toBe('anne');
    expect(before?.key, 'no key pointer yet — it is learned at circle-open').toBeUndefined();

    // Circle-open: provisions the pod-backed medium (carrying keyRef) → records the pointer.
    await A.agent.ensureCircleSync(CIRCLE);

    const after = circleMembershipsOf({ properties: (await A.agent.callSkill('agents', 'getProfileProperties', { id: 'default' }))?.properties ?? {} })[CIRCLE];
    expect(after?.key, 'the group-key pointer was recorded').toEqual(KEYREF);
    expect(after?.handle, 'handle preserved through the key-only merge').toBe('anne');
    expect(after?.address, 'address preserved through the key-only merge').toBe('relay:anne-addr');
  });
});
