/**
 * Relay wake-gate — the SENDER (fan) side.
 *
 * The residual server-side wake work: only a governance decision OPENING
 * (`propose`) should wake an offline device; routine votes/resolves and reports
 * must be hold-forwarded WITHOUT an OS push wake. The relay honours a per-message
 * `noWake` flag on the wire envelope; these tests pin that the stoop fan SETS that
 * flag correctly, consulting the existing wake signal (basis `governanceWakeHint`
 * — propose wakes, everything else is no-wake), never inventing new policy.
 *
 * The fan is captured over the host-injected RELIABLE sender (`bundle.reliableSend`
 * = basis's hold-forward choke), so we assert on the exact wire envelope the relay
 * reads (`envelope.noWake`). Delivery must still succeed in every case — the flag
 * suppresses the wake only, never the send.
 */
import { describe, it, expect } from 'vitest';
import { AgentIdentity, InternalBus, InternalTransport, DataPart } from '@onderling/core';
import { VaultMemory } from '@onderling/vault';
import { createNeighborhoodAgent } from '../src/index.js';

const ANNE = 'https://id.example/anne';
const BOB  = 'https://id.example/bob';

/** A neighborhood bundle wired with a capturing reliable sender (the fan choke). */
async function buildBundle(capture) {
  const id = await AgentIdentity.generate(new VaultMemory());
  const tx = new InternalTransport(new InternalBus(), id.pubKey);
  return createNeighborhoodAgent({
    identity: id, transport: tx,
    offeringMatch: { group: 'oosterpoort', localActor: ANNE, peers: [] },
    members: [
      { webid: ANNE, role: 'member' },
      { webid: BOB,  role: 'member' },
    ],
    // Host-injected hold-forward sender: capture the (addr, envelope) the fan emits.
    reliableSend: async (addr, envelope) => { capture.push({ addr, envelope }); return { delivered: true }; },
  });
}

async function callSkill(agent, skillId, args, from = ANNE) {
  const def = agent.skills.get(skillId);
  if (!def) throw new Error(`callSkill: no such skill: ${skillId}`);
  return def.handler({ parts: [DataPart(args)], from, agent, envelope: null });
}

describe('Relay wake-gate — the governance/report fan sets the no-wake flag', () => {
  it('a governance PROPOSE wakes: the wire envelope carries NO noWake flag', async () => {
    const sent = [];
    const bundle = await buildBundle(sent);
    await bundle.offeringMatch.start();

    const r = await callSkill(bundle.agent, 'broadcastKringGovernance', {
      groupId: 'oosterpoort', msgId: 'g-propose',
      event: { kind: 'governance', event: 'propose', proposalId: 'p1', action: 'removeMember', by: ANNE },
    });

    expect(r.sent).toBe(1);                       // still fans to the other member
    expect(sent).toHaveLength(1);
    expect(sent[0].envelope.noWake).toBeUndefined();   // propose → wake as before
  });

  it('a governance VOTE does NOT wake: the wire envelope carries noWake:true', async () => {
    const sent = [];
    const bundle = await buildBundle(sent);
    await bundle.offeringMatch.start();

    const r = await callSkill(bundle.agent, 'broadcastKringGovernance', {
      groupId: 'oosterpoort', msgId: 'g-vote',
      event: { kind: 'governance', event: 'vote', proposalId: 'p1', voter: BOB, choice: 'yes' },
    });

    expect(r.sent).toBe(1);                       // vote STILL replicates (hold-forward)
    expect(sent).toHaveLength(1);
    expect(sent[0].envelope.noWake).toBe(true);        // …but must not wake a device
  });

  it('a governance RESOLVE does NOT wake either (only propose wakes)', async () => {
    const sent = [];
    const bundle = await buildBundle(sent);
    await bundle.offeringMatch.start();

    await callSkill(bundle.agent, 'broadcastKringGovernance', {
      groupId: 'oosterpoort', msgId: 'g-resolve',
      event: { kind: 'governance', event: 'resolve', proposalId: 'p1', status: 'approved' },
    });

    expect(sent[0].envelope.noWake).toBe(true);
  });

  it('a report never wakes: the wire envelope carries noWake:true', async () => {
    const sent = [];
    const bundle = await buildBundle(sent);
    await bundle.offeringMatch.start();

    const r = await callSkill(bundle.agent, 'broadcastKringReport', {
      groupId: 'oosterpoort', msgId: 'r-1',
      event: { kind: 'report', targetType: 'message', targetRef: 'm-9', reason: 'spam', by: ANNE },
    });

    expect(r.sent).toBe(1);                       // report still reaches every member
    expect(sent[0].envelope.noWake).toBe(true);        // silent lane — never wakes
  });
});
