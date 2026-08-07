/**
 * basis — three-device story 5.3 (the enforcement CORE): a profile UPDATE propagates reveal-gated.
 *
 * "Bram changes his name. → Anna (revealed-to) sees the update; Cato (not revealed-to) sees no change and
 * receives no silent payload carrying it. *Catches: update bypasses the gate — the propagation path differs
 * from the read path.*"
 *
 * The gate the update must respect is the per-context release: `shareDisclosureToCircle`
 * (`apps/basis/src/core/handlers/personaPropsUpdate.js:302`) reads `getPersonaRelease({contextId: circleId})`
 * and comments "Reveal-gating happens HERE and nowhere else: everything downstream only ever sees this
 * release." So an UPDATE to a persona property can only ever carry into a context where the property is
 * disclosed. This test drives the REAL disclosure engine on a real household agent and asserts:
 *   - the update reaches the REVEALED-TO context (its release reflects the new value), and
 *   - the update does NOT appear in the NOT-revealed context (its release stays empty — the update never
 *     becomes a "silent payload" that bypasses the gate).
 *
 * Discloser-side, like story 5.1 (`revealPerCircleDisclosure.test.js`) — never the viewer-side
 * `Reveals`/`viewerNameOptIn`. Scope: this is the READ-path half (the release the sender computes). The
 * three-device DELIVERY half (`fanRosterUpdated` → a third device re-reads) is the roster-fan seam still owed
 * (`plans/NOTE-multi-device-user-stories.md` §5.1/§5.3) — no existing test drives roster-persona sync over the
 * bus.
 */
import { describe, it, expect, afterAll } from 'vitest';

import { bootRealAgentNode, teardown } from './support/pairRealAgents.js';

const REVEALED   = 'update-circle-anna';   // Bram discloses his name here (Anna's circle)
const WITHHELD   = 'update-circle-cato';   // Bram does NOT disclose here (Cato's circle)

describe('story 5.3 — a profile update propagates reveal-gated (discloser-side)', () => {
  let B;
  afterAll(async () => { await teardown(B); });

  const release = (contextId) =>
    B.agent.callSkill('agents', 'getPersonaRelease', { id: 'default', contextId, keys: 'realName' })
      .then((r) => r?.released?.realName);

  it('an update to realName reaches the revealed-to circle and NEVER the withheld one', async () => {
    B = await bootRealAgentNode('bram');

    await B.agent.callSkill('agents', 'setProfileProperty', { id: 'default', key: 'realName', value: 'Bram' });
    await B.agent.callSkill('agents', 'setProfileDisclosure', { id: 'default', contextId: REVEALED, key: 'realName', enabled: true });
    await B.agent.callSkill('agents', 'setProfileDisclosure', { id: 'default', contextId: WITHHELD, key: 'realName', enabled: false });

    // Baseline: revealed circle carries the name, withheld carries nothing.
    expect(await release(REVEALED), 'baseline: revealed circle has the name').toBe('Bram');
    expect(await release(WITHHELD), 'baseline: withheld circle has nothing').toBeUndefined();

    // THE UPDATE — Bram changes his name.
    const upd = await B.agent.callSkill('agents', 'setProfileProperty', { id: 'default', key: 'realName', value: 'Bram Bakker' });
    expect(upd?.ok, 'the update succeeded').toBe(true);

    // The update reached the revealed-to context…
    expect(await release(REVEALED), 'the update reaches the revealed-to circle').toBe('Bram Bakker');
    // …and did NOT leak into the withheld context. The withheld circle sees no value before OR after —
    // the update never becomes a silent payload that bypasses the per-context gate.
    expect(await release(WITHHELD), 'the update does NOT create a release in the withheld circle').toBeUndefined();
  });

  it('a NEW property added after disclosure stays gated too — disclosing name never drags an undisclosed property along', async () => {
    B = B ?? await bootRealAgentNode('bram');
    // realName disclosed to REVEALED (from above); add a SECOND property that is NOT disclosed anywhere.
    await B.agent.callSkill('agents', 'setProfileProperty', { id: 'default', key: 'place', value: 'Groningen' });

    const rel = await B.agent.callSkill('agents', 'getPersonaRelease', { id: 'default', contextId: REVEALED, keys: 'realName,place' });
    expect(rel?.released?.realName, 'the disclosed property is released').toBe('Bram Bakker');
    expect(rel?.released?.place, 'the undisclosed property is NOT released, even in a circle that gets the name').toBeUndefined();
  });
});
