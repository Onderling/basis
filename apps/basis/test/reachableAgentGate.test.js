/**
 * THE INBOUND GATE ON THE AGENT PEERS CAN ACTUALLY REACH.
 *
 * The host agent holds the skill registry, but it runs on an InternalTransport and no external peer can
 * address it. The agent peers reach is the chat/mesh agent — and until 2026-08-19 that one had no
 * PolicyEngine at all. It was safe only because it registers no skills: safe by EMPTINESS, not by policy.
 * Anything later exposed there (the manifest waist, a companion's ops) would have been reachable with no
 * verification whatsoever.
 *
 * So the gate is composed before anything is exposed through it, and this walk proves it is LIVE rather
 * than merely constructed — the substrate's own comment warns that building the engine without attaching
 * it to the agent is "a silent no-op that looks like enforcement". The test therefore checks both that the
 * engine is attached where dispatch reads it AND that a real invoke is refused on the way in.
 *
 * It also discriminates: a blanket-deny gate would pass a deny-only test while being useless. The
 * always-allow skill is here so the gate has to be doing policy, not just failing.
 */
import { describe, it, expect } from 'vitest';
import { DataPart } from '@onderling/core';
import { memoryDataSource } from '@onderling/item-store';
import { createRealHouseholdAgent } from '../src/core/agent/realAgent.js';

describe('the reachable agent has a live inbound gate', () => {
  it('is attached where dispatch reads it, refuses a token-less call, and still allows an open one', async () => {
    const A = await createRealHouseholdAgent({ seedHousehold: false, settingsDataSource: memoryDataSource() });
    const peerFacing = A.sa.agent;

    // 1 — built AND attached. `sa.policy` alone proves nothing: taskExchange reads `agent.policyEngine`,
    // so an engine that is exposed but not attached enforces nothing at all.
    expect(A.sa.policy, 'the reachable agent has no PolicyEngine').toBeTruthy();
    expect(peerFacing.policyEngine, 'the engine is built but NOT attached — dispatch never consults it')
      .toBe(A.sa.policy);

    // 2 — a skill that demands a capability token, which is the shape every granted op will use.
    peerFacing.skills.register('probe.guarded', async () => [DataPart({ reached: true })], {
      policy: 'requires-token',
    });
    // …and one that does not, so a gate that simply denies everything cannot pass this test.
    peerFacing.skills.register('probe.open', async () => [DataPart({ reached: true })], {
      policy: 'always-allow',
    });

    // 3 — the crossing. Self-addressed invoke takes the transport's self-loopback, which is still the
    // real receive path (`handleTaskRequest` → `checkInbound` → dispatch) — so the gate is exercised,
    // not bypassed.
    await expect(
      peerFacing.invoke(peerFacing.address, 'probe.guarded', [DataPart({})]),
      'a token-less call reached a requires-token skill — the gate is not enforcing',
    ).rejects.toThrow();

    // 4 — and the gate discriminates rather than blanket-denying.
    const open = await peerFacing.invoke(peerFacing.address, 'probe.open', [DataPart({})]);
    expect(JSON.stringify(open), 'the gate refused an always-allow skill too — it is deny-all, not policy')
      .toContain('reached');
  }, 120_000);
});
