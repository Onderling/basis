/**
 * A SHARE'S OWN WRITE INTO ITS SOURCE CIRCLE ASKS THAT CIRCLE FIRST, as its receivers will judge it.
 *
 * A share that leaves as a COPY writes that copy into the SOURCE circle (`sharedCopyOf`): an add of the item's own type
 * there, which every other member's device judges by the circle's switches. An in-place re-seal rewrites the source
 * item: a change. When the source circle refuses that write, the copy would show on the sender and be refused on
 * every other device; so the share asks first (`mayWriteInto`, the agent's), and refused means no copy, no ref, the
 * door's words. The `shared-ref` itself is judged nowhere (no manifest declares it), so it is not asked.
 */
import { describe, it, expect } from 'vitest';
import { generateKeypair, recipientStrategy } from '@onderling/pod-client';
import { makeCircleShareEnforcement, sealItem } from '@onderling/item-store';
import { makeResourceUriResolver, sharedRefResourceUri } from '@onderling/pod-onboarding/resourceUri';
import { makeCircleLists } from '@onderling/kring-host/circleLists';
import { shareItemAcrossCircles, shareItemToPublishedKey, shareFailureKey } from '../../src/v2/circleShare.js';

const resourceUriFor = sharedRefResourceUri(makeResourceUriResolver({ podUri: 'https://pod.example/' }));
function fakeSharing() {
  const grants = [];
  return {
    grants,
    async grant({ resourceUri, agent, modes }) { grants.push({ resourceUri, agent, modes }); },
    async list({ resourceUri, agentsToQuery = [] }) {
      return grants.filter((g) => g.resourceUri === resourceUri && agentsToQuery.includes(g.agent)).map((g) => ({ subject: 'agent', agent: g.agent, modes: g.modes }));
    },
  };
}
const sealCopy = (item, keys) => sealItem(item, (text) => recipientStrategy({ recipients: keys }).seal(text));
const REFUSED = { layer: 'availability', code: 'capability-denied' };

/** The agent's gate, as a recorder: refuses the given act in the given circle. */
const gate = (refuse = null) => {
  const asked = [];
  const fn = async (circleId, { type, act }) => { asked.push({ circleId, type, act }); return refuse && refuse.circleId === circleId && refuse.act === act ? REFUSED : null; };
  fn.asked = asked;
  return fn;
};

const setup = async () => {
  const svc = makeCircleLists();
  const src = await svc.createList('A', 'boodschappen', 'alice');
  const rows = async (cid) => ((await svc.stores.getStore(cid).list?.()) ?? (await svc.stores.getStore(cid).listByType?.('list')) ?? []);
  const copies = async () => (await rows('A')).filter((r) => r?.sharedCopyOf);
  const refs = async () => ((await svc.stores.getStore('B').listByType?.('shared-ref')) ?? []);
  return { svc, src, resolveService: async () => svc, copies, refs };
};

describe('a share\'s copy into its source circle asks that circle first', () => {
  it('the COPY branch (circle to circle): the source refuses the add → no copy, no ref, the refusal comes back', async () => {
    const { src, resolveService, copies, refs } = await setup();
    const enforcement = makeCircleShareEnforcement({ sharing: fakeSharing(), resourceUriFor });
    const mayWriteInto = gate({ circleId: 'A', act: 'add' });
    const r = await shareItemAcrossCircles({
      resolveService, enforcementFor: (c) => (c === 'A' ? enforcement : null), policyOf: () => ({ sharePosture: 'copy' }),
      itemId: src.id, fromCircleId: 'A', toCircleId: 'B', by: 'alice',
      recipients: ['webid:bob'], recipientKeys: [generateKeypair().publicKey], sealCopy, mayWriteInto,
    });
    expect(r.ok, JSON.stringify(r)).toBe(false);
    expect(r.refusal).toEqual(REFUSED);
    expect(mayWriteInto.asked).toContainEqual({ circleId: 'A', type: 'list', act: 'add' });
    expect(await copies(), 'a copy was written into the source').toEqual([]);
    expect(await refs(), 'a ref was written into the target').toEqual([]);
  });

  it('allowed: the same share goes, and the gate was asked the add', async () => {
    const { src, resolveService, copies } = await setup();
    const enforcement = makeCircleShareEnforcement({ sharing: fakeSharing(), resourceUriFor });
    const mayWriteInto = gate(null);
    const r = await shareItemAcrossCircles({
      resolveService, enforcementFor: (c) => (c === 'A' ? enforcement : null), policyOf: () => ({ sharePosture: 'copy' }),
      itemId: src.id, fromCircleId: 'A', toCircleId: 'B', by: 'alice',
      recipients: ['webid:bob'], recipientKeys: [generateKeypair().publicKey], sealCopy, mayWriteInto,
    });
    expect(r.ok, JSON.stringify(r)).toBe(true);
    expect(mayWriteInto.asked).toContainEqual({ circleId: 'A', type: 'list', act: 'add' });
    expect((await copies()).length).toBe(1);
  });

  it('the IN-PLACE re-seal (an enforcement that seals, no copy machinery): the source refuses the change → no ref', async () => {
    const { src, resolveService, refs } = await setup();
    const enforcement = makeCircleShareEnforcement({ sharing: fakeSharing(), resourceUriFor, seal: async (item) => ({ ...item, resealed: true }) });
    const mayWriteInto = gate({ circleId: 'A', act: 'change' });
    const r = await shareItemAcrossCircles({
      resolveService, enforcementFor: (c) => (c === 'A' ? enforcement : null), policyOf: () => ({ sharePosture: 'copy' }),
      itemId: src.id, fromCircleId: 'A', toCircleId: 'B', by: 'alice', recipients: ['webid:bob'], mayWriteInto,
    });
    expect(r.ok, JSON.stringify(r)).toBe(false);
    expect(r.refusal).toEqual(REFUSED);
    expect(await refs(), 'a ref was written into the target').toEqual([]);
  });

  it('the in-place path with NO re-seal (the memory path) writes nothing into the source: not asked, and goes', async () => {
    const { src, resolveService } = await setup();
    const mayWriteInto = gate({ circleId: 'A', act: 'change' });
    const r = await shareItemAcrossCircles({
      resolveService, enforcementFor: () => null, policyOf: () => ({ sharePosture: 'copy' }),
      itemId: src.id, fromCircleId: 'A', toCircleId: 'B', by: 'alice', recipients: ['webid:bob'], mayWriteInto,
    });
    expect(r.ok, JSON.stringify(r)).toBe(true);
    expect(mayWriteInto.asked.filter((a) => a.circleId === 'A')).toEqual([]);
  });

  it('a SILENT share to a person: the sealed copy and the plain (memory) copy both ask the source\'s add first', async () => {
    for (const withPod of [true, false]) {
      const { src, resolveService, copies } = await setup();
      const enforcement = withPod ? makeCircleShareEnforcement({ sharing: fakeSharing(), resourceUriFor }) : null;
      const bob = generateKeypair();
      const mayWriteInto = gate({ circleId: 'A', act: 'add' });
      const r = await shareItemToPublishedKey({
        resolveService, enforcementFor: () => enforcement, policyOf: () => ({ shareOutOfCircle: 'silent' }),
        itemId: src.id, fromCircleId: 'A', by: 'alice', recipient: 'webid:bob', recipientNetworkKey: 'net-bob',
        sealCopy, sealingKeyFromNetworkKey: () => bob.publicKey, mayWriteInto,
      });
      expect(r.ok, `${withPod ? 'sealed' : 'plain'} copy: ${JSON.stringify(r)}`).toBe(false);
      expect(r.refusal).toEqual(REFUSED);
      expect(await copies(), `${withPod ? 'sealed' : 'plain'}: a copy was written into the source`).toEqual([]);
    }
  });

  it('the words: a refusal from the source is told in the gate\'s own words on every shell', () => {
    expect(shareFailureKey({ ok: false, error: 'circle-refuses', code: 'app-disabled' })).toBe('circle.gate.appDisabled');
    expect(shareFailureKey({ ok: false, error: 'circle-refuses', code: 'capability-denied' }, { toPerson: true })).toBe('circle.gate.capabilityDenied');
    expect(shareFailureKey({ ok: false, error: 'sharing-closed' })).toBe('circle.share.error.sharing_closed');
    expect(shareFailureKey({ ok: false, error: 'x' }, { toPerson: true })).toBe('circle.share.to_person_failed');
  });
});
