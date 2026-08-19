/**
 * A4 (substrate-adoption) — cross-pod refs on `postRequest({embeds:[...]})`.
 *
 * V2 web functional design §4b. A post can carry `embeds: [{type, ref}, ...]`
 * referencing a Tasks task, a Folio note, or another Stoop item. The
 * embeds:
 *   - persist on `item.source.embeds`
 *   - travel through the substrate-mirror broadcast (payload.embeds)
 *   - copy into the mirrored item's `source.embeds` on the receiver side
 *   - are validated (each entry needs string type + string ref)
 *   - are capped at 8 per post
 */
import { describe, it, expect } from 'vitest';
import { AgentIdentity, InternalBus, InternalTransport, DataPart } from '@onderling/core';
import { VaultMemory } from '@onderling/vault';
import { createNeighbourhoodAgent }    from '../src/index.js';
import { attachSubstrateMirror }      from '../src/substrateMirror.js';

const ANNE  = 'https://id.example/anne';
const GROUP = 'oosterpoort';

async function makeBundle() {
  const id = await AgentIdentity.generate(new VaultMemory());
  const tx = new InternalTransport(new InternalBus(), id.pubKey);
  const bundle = await createNeighbourhoodAgent({
    identity:   id,
    transport:  tx,
    offeringMatch: { group: GROUP, localActor: ANNE, peers: [] },
    members:    [{ webid: ANNE }],
  });
  await bundle.offeringMatch.start();
  return bundle;
}

async function callSkill(agent, skillId, args) {
  const def = agent.skills.get(skillId);
  if (!def) throw new Error(`callSkill: no such skill: ${skillId}`);
  return def.handler({
    parts:    args === undefined ? [] : [DataPart(args)],
    from:     ANNE,
    agent,
    envelope: null,
  });
}

describe('A4 — postRequest with embeds', () => {
  it('persists embeds on item.source.embeds', async () => {
    const bundle = await makeBundle();
    await attachSubstrateMirror(bundle, { group: GROUP });
    await callSkill(bundle.agent, 'postRequest', {
      intent: 'lend',
      text:   'Hooi, ik leen een ladder',
      embeds: [
        { type: 'task',           ref: 'pseudo-pod://abc/tasks/move-the-ladder' },
        { type: 'neighbourhood-job', ref: 'https://anne.pod/sharing/stoop/job-fix-bench' },
      ],
    });
    const items = await bundle.itemStore.listOpen();
    expect(items).toHaveLength(1);
    expect(items[0].source.embeds).toEqual([
      { type: 'task',                ref: 'pseudo-pod://abc/tasks/move-the-ladder' },
      { type: 'neighbourhood-job',   ref: 'https://anne.pod/sharing/stoop/job-fix-bench' },
    ]);
  });

  it('omits source.embeds when none supplied (back-compat with V1 posts)', async () => {
    const bundle = await makeBundle();
    await attachSubstrateMirror(bundle, { group: GROUP });
    await callSkill(bundle.agent, 'postRequest', { intent: 'ask', text: 'wie helpt?' });
    const items = await bundle.itemStore.listOpen();
    expect(items).toHaveLength(1);
    expect(items[0].source.embeds).toBeUndefined();
  });

  it('rejects embeds entries missing type', async () => {
    const bundle = await makeBundle();
    await attachSubstrateMirror(bundle, { group: GROUP });
    const r = await callSkill(bundle.agent, 'postRequest', {
      intent: 'ask',
      text:   'x',
      embeds: [{ ref: 'pseudo-pod://abc/x' }],
    });
    expect(r).toEqual({ error: 'embed-type-missing' });
  });

  it('rejects embeds entries missing ref', async () => {
    const bundle = await makeBundle();
    await attachSubstrateMirror(bundle, { group: GROUP });
    const r = await callSkill(bundle.agent, 'postRequest', {
      intent: 'ask',
      text:   'x',
      embeds: [{ type: 'task' }],
    });
    expect(r).toEqual({ error: 'embed-ref-missing' });
  });

  it('rejects non-object embed entries', async () => {
    const bundle = await makeBundle();
    await attachSubstrateMirror(bundle, { group: GROUP });
    const r = await callSkill(bundle.agent, 'postRequest', {
      intent: 'ask',
      text:   'x',
      embeds: ['not-an-object'],
    });
    expect(r).toEqual({ error: 'embed-not-object' });
  });

  it('caps embeds at 8 per post', async () => {
    const bundle = await makeBundle();
    await attachSubstrateMirror(bundle, { group: GROUP });
    const tooMany = Array.from({ length: 9 }, (_, i) => ({
      type: 'task',
      ref:  `pseudo-pod://abc/tasks/t-${i}`,
    }));
    const r = await callSkill(bundle.agent, 'postRequest', {
      intent: 'ask',
      text:   'x',
      embeds: tooMany,
    });
    expect(r?.error).toMatch(/embeds-too-many:9/);
  });
});

describe('A4 — substrateMirror copies embeds through the mirror', () => {
  it('payload.embeds → mirrored item.source.embeds', async () => {
    // Receiver-only bundle (Bob); manually invoke mirror() through
    // the public substrate path by calling backfillFrom with a synthetic
    // item shape that carries embeds.
    const bob = await makeBundle();
    const mirror = await attachSubstrateMirror(bob, { group: GROUP });
    const annePubKey = 'pubkey:fake-anne';
    await mirror.backfillFrom(annePubKey, [{
      id:    'req-001',
      text:  'Lent ladder back today',
      addedBy: ANNE,
      type:  'offer',
      kind:  'lend',
      source: {
        embeds: [
          { type: 'task', ref: 'pseudo-pod://anne/tasks/move-ladder' },
        ],
      },
      requiredSkills: [],
    }]);
    const items = await bob.itemStore.listOpen();
    expect(items).toHaveLength(1);
    expect(items[0].source.embeds).toEqual([
      { type: 'task', ref: 'pseudo-pod://anne/tasks/move-ladder' },
    ]);
  });
});
