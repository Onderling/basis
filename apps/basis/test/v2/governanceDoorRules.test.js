/**
 * THE RULES SCREEN CHANGES THE CIRCLE'S RULES, THROUGH THE CIRCLE'S RULE FOR CHANGING THEM.
 *
 * The circle's rules are pinboard's `group-rules` head: the invite carries it, the join consent shows it, the
 * rules-update rider fans it. The Rules screen (web + phone) used to edit a LOCAL copy that nothing else read and
 * fan it to a "pending" slot on the other devices, so an admin's edit never reached a joiner and never went past the
 * vote the circle's `changeRule` class asks for. Now the screen reads the head and saves through `changeRulesDoor`.
 *
 * Also pinned: an enact the op REFUSES (pinboard answers `{error}`, not `{ok:false}`) closes the proposal as
 * rejected; it used to count as approved.
 */
import { describe, it, expect, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { makeCircleGovernance } from '../../src/v2/governanceHost.js';
import { normalizeCirclePolicy } from '../../src/v2/circlePolicy.js';
import { DECISION_STATUS } from '../../src/v2/governanceDecision.js';
import { changeRulesDoor, readCircleRules, rulesForSave } from '../../src/v2/governanceDoors.js';

const members = [{ ref: 'a0', role: 'admin' }, { ref: 'a1', role: 'admin' }, { ref: 'm0', role: 'member' }];

function host(governance, { answer = { rulesId: 'r1', version: 2 } } = {}) {
  const policy = normalizeCirclePolicy({ governance });
  const events = [];
  let n = 0;
  const callSkill = vi.fn(async () => answer);
  const gov = makeCircleGovernance({
    callSkill,
    readGovernanceState: async () => ({ events, disputed: new Set() }),
    appendGovernanceEvent: async (_c, e) => { events.push(e); },
    getPolicy: async () => policy, getMembers: async () => members,
    localActorRef: 'a0', newProposalId: () => `p${(n += 1)}`, now: () => 0,
  });
  return { gov, callSkill, events };
}

const edited = { purpose: 'Samen koken', agreements: 'Om de beurt', admins: '', conflict: '', admission: '', leaving: '', responsibility: '' };

describe('the rules screen saves through the circle\'s rule for changing the rules', () => {
  it('any admin may change the rules: written at once through editGroupRules', async () => {
    const { gov, callSkill } = host({ changeRule: 'any-admin' });
    const r = await changeRulesDoor({ governance: gov, circleId: 'c1', rules: edited, actorRef: 'a0' });
    expect(r.outcome).toBe('done');
    expect(callSkill).toHaveBeenCalledWith('pinboard', 'editGroupRules', { groupId: 'c1', rules: edited });
  });

  it('the admins decide together (the default): a proposal opens, the rules are not written yet', async () => {
    const { gov, callSkill } = host({});
    const r = await changeRulesDoor({ governance: gov, circleId: 'c1', rules: edited, actorRef: 'a0' });
    expect(r.outcome).toBe('proposed');
    expect(callSkill).not.toHaveBeenCalled();
  });

  it('an enact the op refuses closes the proposal as rejected, and the door says refused', async () => {
    const { gov, events } = host({ changeRule: 'any-admin' }, { answer: { error: 'admin-only' } });
    const r = await changeRulesDoor({ governance: gov, circleId: 'c1', rules: edited, actorRef: 'a0' });
    expect(r.outcome).toBe('refused');
    expect(events.find((e) => e.event === 'resolve')?.status).toBe(DECISION_STATUS.REJECTED);
  });

  it('without a governance binding nothing is written', async () => {
    expect((await changeRulesDoor({ governance: null, circleId: 'c1', rules: edited })).outcome).toBe('refused');
  });
});

describe('the rules screen reads the circle\'s rules, not a local copy', () => {
  it('reads the structured doc getGroupRules answers, keeping the fields the screen does not edit', async () => {
    const head = { purpose: 'Oud', agreements: 'Oud', name: 'Kookclub', accessPolicy: 'invite', version: 3 };
    const callSkill = vi.fn(async () => ({ title: 'Rules', rules: 'Purpose: Oud', doc: head, version: 3 }));
    const r = await readCircleRules({ callSkill, circleId: 'c1' });
    expect(callSkill).toHaveBeenCalledWith('pinboard', 'getGroupRules', { groupId: 'c1' });
    expect(r.doc.purpose).toBe('Oud');
    expect(r.doc.leaving).toBe('');
    // what is saved is the head with the edited questions on top: the circle's other rule fields stay
    expect(rulesForSave(r.head, { ...r.doc, purpose: 'Nieuw' })).toMatchObject({ purpose: 'Nieuw', name: 'Kookclub', accessPolicy: 'invite' });
  });

  it('a circle without rules reads as an empty doc', async () => {
    const r = await readCircleRules({ callSkill: async () => ({ status: 'no-rules-set' }), circleId: 'c1' });
    expect(r.doc.purpose).toBe('');
    expect(r.head).toBeNull();
  });
});

describe('both shells use the door (no local rules copy, no pending broadcast)', () => {
  const read = (rel) => readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf8');
  const web = read('../../web/v2/circleApp.js');
  const phone = read('../../../basis-mobile/src/screens/v2/CircleLauncherScreen.js');
  const webRules = web.slice(web.indexOf('async function showRules('), web.indexOf('async function showRules(') + 4000);
  const phoneRules = phone.slice(phone.indexOf("if (selected && view === 'rules') {"), phone.indexOf("if (selected && view === 'rules') {") + 2500);
  const phoneOpen = phone.slice(phone.indexOf('onRules={'), phone.indexOf('onRules={') + 800);

  it('web: showRules reads the head and saves through changeRulesDoor', () => {
    expect(webRules).toMatch(/readCircleRules\(/);
    expect(webRules).toMatch(/changeRulesDoor\(/);
    expect(webRules).not.toMatch(/rulesStore\.set\(|broadcastCircleRules|broadcastRules\(/);
  });

  it('phone: opening the rules reads the head; saving goes through changeRulesDoor', () => {
    expect(phoneOpen).toMatch(/readCircleRules\(/);
    expect(phoneRules).toMatch(/changeRulesDoor\(/);
    expect(phoneRules).not.toMatch(/rulesStore\.set\(|broadcastCircleRules/);
  });
});
