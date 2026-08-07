/**
 * basis — three-device story 5.1 (the enforcement CORE): per-circle reveal does not bleed.
 *
 * "Cato joins circle X at `handle` and circle Y at `full`. → X members see only the handle; Y members see the
 * name; neither leaks into the other." This test drives the REAL per-circle disclosure engine on a real
 * household agent (`callSkill('agents', …)` → the profiles store), asserting on the DISCLOSER-SIDE release —
 * what Cato would actually SHARE in each circle — which is the real enforcement (per `contextId`), stored per
 * circle and gate-projected over the wire.
 *
 * DELIBERATELY NOT the viewer-side `Reveals`/`setGroupReveal`/`viewerNameOptIn` toggle: that is the VIEWER's
 * local "show me names" preference, not what the member disclosed (`packages/identity-resolver/src/Reveals.js`
 * says so outright), and an earlier three-device attempt "passed for the wrong reason" by asserting on it
 * (`remainingStoriesThreeDevice.test.js`). The carried name is the persona property `realName`, never
 * `displayName` (a local cache that never crosses the peer allowlist).
 *
 * Scope note: this asserts the enforcement PRIMITIVE (the per-circle release gate). The full roster-fan
 * delivery to a third device (`recordMemberPersonaProperties` → `fanRosterUpdated` → re-read) is a separate
 * seam; and story 5.1 as literally worded (a JOIN-TIME reveal picker) is not reachable through the programmatic
 * `joinCircleFromInvite` today (the picker lives in the shell wizard state; and `getPersonaRelease` needs
 * explicit `keys`) — two adoption gaps this story legitimately points at, tracked in
 * `plans/NOTE-multi-device-user-stories.md` §5.1.
 */
import { describe, it, expect, afterAll } from 'vitest';

import { bootRealAgentNode, teardown } from './support/pairRealAgents.js';

const CIRCLE_X = 'reveal-circle-x';   // Cato reveals only a handle here
const CIRCLE_Y = 'reveal-circle-y';   // Cato reveals the full name here

describe('story 5.1 — per-circle reveal is discloser-side and does not bleed', () => {
  let C;
  afterAll(async () => { await teardown(C); });

  it('Cato discloses realName in Y but not X — the release diverges per circle, no bleed at the source', async () => {
    C = await bootRealAgentNode('cato');

    // Cato's real name is a persona property; the handle is separate and always crosses the wire.
    const setName = await C.agent.callSkill('agents', 'setProfileProperty', { id: 'default', key: 'realName', value: 'Catharina' });
    expect(setName?.ok, 'setProfileProperty realName').toBe(true);

    // The per-circle "reveal level": disclose realName in Y (full), NOT in X (handle-only).
    const discX = await C.agent.callSkill('agents', 'setProfileDisclosure', { id: 'default', contextId: CIRCLE_X, key: 'realName', enabled: false });
    const discY = await C.agent.callSkill('agents', 'setProfileDisclosure', { id: 'default', contextId: CIRCLE_Y, key: 'realName', enabled: true });
    expect(discX?.ok, 'setProfileDisclosure X').toBe(true);
    expect(discY?.ok, 'setProfileDisclosure Y').toBe(true);

    // The REAL gate: what Cato would release into each circle. Y carries the name; X carries nothing for it.
    const relX = await C.agent.callSkill('agents', 'getPersonaRelease', { id: 'default', contextId: CIRCLE_X, keys: 'realName' });
    const relY = await C.agent.callSkill('agents', 'getPersonaRelease', { id: 'default', contextId: CIRCLE_Y, keys: 'realName' });

    expect(relY?.released?.realName, 'Y (full) releases the name').toBe('Catharina');
    expect(relX?.released?.realName, 'X (handle-only) does NOT release the name — no cross-context bleed').toBeUndefined();
  });

  it('the divergence is REALLY the per-circle toggle: a never-disclosed context defaults to deny, and flipping X on makes the name appear there and ONLY there', async () => {
    // Guards against "passed for the wrong reason": prove the assertion is measuring the disclosure gate,
    // not an accident of an empty roster or a global default.
    C = C ?? await bootRealAgentNode('cato');
    await C.agent.callSkill('agents', 'setProfileProperty', { id: 'default', key: 'realName', value: 'Catharina' });

    // A THIRD circle Cato never touched → default-deny (nothing released), even though the property is set.
    const relZ = await C.agent.callSkill('agents', 'getPersonaRelease', { id: 'default', contextId: 'reveal-circle-z', keys: 'realName' });
    expect(relZ?.released?.realName, 'a never-disclosed circle defaults to deny').toBeUndefined();

    // Flip X ON — now X releases the name; Z (untouched) still does not. Only the toggled context changes.
    await C.agent.callSkill('agents', 'setProfileDisclosure', { id: 'default', contextId: CIRCLE_X, key: 'realName', enabled: true });
    const relXafter = await C.agent.callSkill('agents', 'getPersonaRelease', { id: 'default', contextId: CIRCLE_X, keys: 'realName' });
    const relZafter = await C.agent.callSkill('agents', 'getPersonaRelease', { id: 'default', contextId: 'reveal-circle-z', keys: 'realName' });
    expect(relXafter?.released?.realName, 'flipping X on releases the name there').toBe('Catharina');
    expect(relZafter?.released?.realName, 'the untouched circle is unaffected — the toggle is per-circle').toBeUndefined();
  });
});
