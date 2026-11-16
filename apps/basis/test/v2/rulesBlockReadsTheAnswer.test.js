/**
 * THE RULES BLOCK SHOWS THE CIRCLE'S RULES, from the answer `getGroupRules` actually gives.
 *
 * The shells hand the blocks the agent's `callSkill`, whose `getGroupRules` answer carries the structured rules as
 * `doc` beside the rendered text (`rules` is a STRING there); the raw pinboard skill answers the stored item, with
 * the doc under `source.rules`. The blocks read `rules.source.doc`, which neither answer has, so a circle's rules
 * block showed empty. One reader (`rulesDocFromAnswer`) now reads both answers, for the blocks, the invite and the
 * rules screen.
 */
import { describe, it, expect } from 'vitest';
import { materializeBlock } from '../../src/v2/circleRecipeBlocks.js';
import { rulesDocFromAnswer } from '../../src/v2/circleRules.js';

const agreed = { purpose: 'Samen koken', agreements: 'Om de beurt' };
const agentAnswer = { title: 'Rules', groupId: 'g1', rules: 'Purpose: Samen koken', doc: agreed, version: 2 };
const rawAnswer = { rules: { id: 'i1', type: 'group-rules', source: { groupId: 'g1', rules: agreed, version: 2 } } };

describe('the rules block reads the answer getGroupRules gives', () => {
  for (const [name, answer] of [['the agent\'s answer (what the shells hand the blocks)', agentAnswer], ['the raw skill\'s answer', rawAnswer]]) {
    it(name, async () => {
      const r = await materializeBlock({ block: { id: 'b', type: 'rules', config: {} }, circleId: 'g1', hostOps: { callSkill: async () => answer } });
      expect(r.status).toBe('ok');
      expect(r.content.doc.purpose).toBe('Samen koken');
    });
  }

  it('one reader for both answers; nothing for a circle without rules', () => {
    expect(rulesDocFromAnswer(agentAnswer)).toEqual(agreed);
    expect(rulesDocFromAnswer(rawAnswer)).toEqual(agreed);
    expect(rulesDocFromAnswer({ status: 'no-rules-set' })).toBeNull();
    expect(rulesDocFromAnswer(null)).toBeNull();
  });
});
