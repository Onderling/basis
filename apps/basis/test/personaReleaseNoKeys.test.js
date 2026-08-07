/**
 * #24 — `getPersonaRelease` with NO `keys` must release everything the persona DISCLOSED in the context.
 *
 * The reveal-at-join path (`joinGroupState.js:869`) and the "About me" roster push
 * (`personaPropsUpdate.js:302`) both call `getPersonaRelease({id, contextId})` with NO `keys`. `releaseFor`
 * (`realAgent.js`) built its request from `keys` only, so an absent `keys` produced an EMPTY release ({}) —
 * the picked reveal set the per-circle disclosure policy but NOTHING was ever released to the roster. A user
 * who chose "reveal my full name" disclosed nothing. This pins the documented semantics (`cores.js:688`: a
 * persona releases "its disclosure over its effective properties"): absent keys ⇒ everything disclosed HERE.
 */
import { describe, it, expect, afterAll } from 'vitest';

import { bootRealAgentNode, teardown } from './support/pairRealAgents.js';

describe('#24 — getPersonaRelease defaults to all context-disclosed keys when none are named', () => {
  let A;
  afterAll(async () => { await teardown(A); });

  it('a no-keys release carries what was disclosed in the context — and nothing where nothing was disclosed', async () => {
    A = await bootRealAgentNode('anne');
    await A.agent.callSkill('agents', 'setProfileProperty', { id: 'default', key: 'realName', value: 'Anne' });
    await A.agent.callSkill('agents', 'setProfileDisclosure', { id: 'default', contextId: 'ctx-disclosed', key: 'realName', enabled: true });

    // NO keys — exactly how the join carry + the About-me push call it.
    const relDisclosed = await A.agent.callSkill('agents', 'getPersonaRelease', { id: 'default', contextId: 'ctx-disclosed' });
    expect(relDisclosed?.released?.realName, 'a disclosed context releases the value with no keys named').toBe('Anne');

    // A context where nothing was disclosed still releases nothing (default-withhold preserved).
    const relBlank = await A.agent.callSkill('agents', 'getPersonaRelease', { id: 'default', contextId: 'ctx-none' });
    expect(relBlank?.released?.realName, 'an undisclosed context releases nothing').toBeUndefined();

    // Disabling the disclosure narrows the no-keys release back to empty (releasedValues re-checks enabled).
    await A.agent.callSkill('agents', 'setProfileDisclosure', { id: 'default', contextId: 'ctx-disclosed', key: 'realName', enabled: false });
    const relAfterOff = await A.agent.callSkill('agents', 'getPersonaRelease', { id: 'default', contextId: 'ctx-disclosed' });
    expect(relAfterOff?.released?.realName, 'disabling narrows the no-keys release too').toBeUndefined();
  });
});
