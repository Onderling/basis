/**
 * basis — story §5.6: reveal is ONE intuition across the two scopes (contact AND circle).
 *
 * Revealing to a PERSON (the contact reveal ladder — `revealLadder.js`, drivers-matching #5b) and to a ROOM
 * (per-circle disclosure — `disclosure.js`, story 5.1/5.3) must feel like the same thing to the user, even
 * though the machinery differs (a consensual reveal-request/accept handshake vs. a roster sealed to the
 * circle key). This test pins the SHARED semantics and makes the one CURRENT DIVERGENCE explicit so the
 * coherence decision (§5.6d) is anchored, not implicit.
 *
 *   5.6a/e  one amount vocabulary, same order   — the ladder levels map 1:1 onto REVEAL_PRESETS by rank.
 *   5.6b    unilateral (you present only YOUR self, never the other) — the ladder side.
 *   5.6c    default is minimum in BOTH scopes    — ladder starts ephemeral; a circle with no disclosure
 *                                                  releases nothing (real agent).
 *   5.6d    DIVERGENCE: a circle reveal is REVOCABLE (narrows); the talk ladder is MONOTONIC ("never less").
 */
import { describe, it, expect, afterAll } from 'vitest';

import {
  REVEAL_LEVELS, createParticipant, revealSelf, revealNext, presentSelf, presetForRevealLevel,
} from '@onderling/agent-registry';
import { REVEAL_PRESETS } from '@onderling/agent-registry';

import { bootRealAgentNode, teardown } from './support/pairRealAgents.js';

const CIRCLE = 'one-intuition-circle';

describe('§5.6 — reveal is one intuition: contact ladder + circle disclosure share the same semantics', () => {
  let A;
  afterAll(async () => { await teardown(A); });

  it('5.6a/e — one amount vocabulary, same order: the ladder levels are REVEAL_PRESETS by rank', () => {
    // The contact ladder and circle disclosure must never teach two different amount scales.
    expect(REVEAL_LEVELS.map(presetForRevealLevel)).toEqual([...REVEAL_PRESETS]);
    // …and the ordering is the same low→high in both (handle/ephemeral … full/identity).
    expect(presetForRevealLevel(REVEAL_LEVELS[0])).toBe('handle');
    expect(presetForRevealLevel(REVEAL_LEVELS[REVEAL_LEVELS.length - 1])).toBe('full');
  });

  it('5.6b — unilateral: a participant presents only THEIR own self, and only what they raised to', () => {
    const me = createParticipant({ talkId: 't1', side: 'a', persona: { id: 'p', name: 'Anna' } });
    // Default (ephemeral): only my anonymous handle — never a name, never anything about the other side.
    const atFloor = presentSelf(me);
    expect(atFloor.level).toBe(REVEAL_LEVELS[0]);
    expect(atFloor.handle, 'ephemeral presents an anonymous handle').toBeTruthy();
    expect(atFloor.persona, 'ephemeral never presents the persona/name').toBeUndefined();
    // Step up one rung → my persona is presented; still nothing about the other party.
    const up = revealNext(me);
    const atPersona = presentSelf(up);
    expect(atPersona.persona?.name).toBe('Anna');
    // presentSelf only ever describes `self` — there is no field carrying the other participant.
    expect(Object.keys(atPersona)).not.toContain('other');
  });

  it('5.6c + 5.6d — default is minimum in BOTH scopes; a CIRCLE reveal narrows (revocable) but the TALK ladder does NOT (monotonic)', async () => {
    A = await bootRealAgentNode('anna');
    await A.agent.callSkill('agents', 'setProfileProperty', { id: 'default', key: 'realName', value: 'Anna' });
    const release = () =>
      A.agent.callSkill('agents', 'getPersonaRelease', { id: 'default', contextId: CIRCLE, keys: 'realName' })
        .then((r) => r?.released?.realName);

    // 5.6c — CIRCLE default is minimum: name set, nothing disclosed → released is empty.
    expect(await release(), 'circle default: nothing released until a deliberate share').toBeUndefined();
    // 5.6c — LADDER default is minimum: a fresh participant starts at the floor (ephemeral / handle).
    expect(createParticipant({ talkId: 't2' }).level).toBe(REVEAL_LEVELS[0]);

    // 5.6d — CIRCLE reveal is REVOCABLE: enable, then disable → the name is dropped again.
    await A.agent.callSkill('agents', 'setProfileDisclosure', { id: 'default', contextId: CIRCLE, key: 'realName', enabled: true });
    expect(await release(), 'circle: enabling discloses the name').toBe('Anna');
    await A.agent.callSkill('agents', 'setProfileDisclosure', { id: 'default', contextId: CIRCLE, key: 'realName', enabled: false });
    expect(await release(), 'circle: disabling NARROWS again (revocable — principle 5)').toBeUndefined();

    // 5.6d — TALK ladder is MONOTONIC: raise to full, then a request DOWN is a no-op ("never less").
    const raised = revealSelf(createParticipant({ talkId: 't3' }), REVEAL_LEVELS[REVEAL_LEVELS.length - 1]);
    const backDown = revealSelf(raised, REVEAL_LEVELS[0]);
    expect(backDown.level, 'talk ladder refuses to un-reveal — the divergence §5.6d flags').toBe(REVEAL_LEVELS[REVEAL_LEVELS.length - 1]);
  });
});
