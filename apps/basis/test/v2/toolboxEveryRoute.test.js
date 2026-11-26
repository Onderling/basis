// @reads-source: this test reads source as text, so rung 1 runs it (docs/conventions/verification-ladder.md).
/**
 * EVERY route to a toolbox's tool on the box passes the egress gate (ledger L1035).
 *
 * @guard the Telegram door and a screen's kernel skill both reach tools.useTool through the gated call, so both write the tool-call record
 *
 * A screen's grant carries the member column, so a screen can already call `tools.useTool`: its kernel skill
 * (`exposeDoorToScreens`, `renderA2A` over the door's call) must pass the same wrapped call as the Telegram door.
 * Behaviour (both routes write the record) and the box's composition (the screens are handed the door's call, which is
 * built on the wrapped one; nothing reaches the tools app around it).
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DataPart } from '@onderling/core';
import { withAssistantOps } from '../../src/v2/assistantOps.js';
import { exposeDoorToScreens } from '../../src/v2/screenActing.js';
import { createDoorCatalogue } from '../../src/assistant/assistantCatalogue.js';
import { householdBotApps } from '../../src/v2/householdTemplate.js';
import { wrapCallSkillWithEgressGate, isExternalEgressOp } from '../../src/core/agent/egressGate.js';

const PERSON = 'telegram:1';
const ARGS = { toolbox: 'boodschappen', tool: 'products.choices', input: { query: 'melk' } };

function box() {
  const records = [];
  const inner = async (app, op) => (app === 'tools' && op === 'useTool' ? { ok: true, items: [] } : { ok: true });
  const callSkill = wrapCallSkillWithEgressGate(inner, { isExternalEgress: (a, o) => isExternalEgressOp(a, o), toolCall: { isOn: async () => true, record: (r) => records.push(r) } });
  const users = { list: async () => [{ id: PERSON, role: 'member' }] };
  const threads = { langOf: () => 'nl', modeOf: () => 'short', remindersOn: () => true, viewOf: () => 'buttons', quietOf: () => null };
  const doorCall = withAssistantOps({ callSkill, threads, t: (k) => k, admin: { users: async () => [{ id: PERSON, channel: 'telegram', uid: '1', role: 'member' }] } });
  return { records, doorCall, users };
}

describe('every route to a toolbox\'s tool writes the record', () => {
  it('the Telegram door', async () => {
    const { records, doorCall } = box();
    await doorCall('tools', 'useTool', ARGS, { caller: PERSON, threadId: PERSON, door: 'slash' });
    expect(records).toEqual([{ person: PERSON, toolbox: 'boodschappen', tool: 'products.choices', outcome: 'ok' }]);
  });

  it('a screen\'s kernel skill (the member column carries useTool)', async () => {
    const { records, doorCall, users } = box();
    const doorCatalogue = createDoorCatalogue({ slim: true, getApps: () => householdBotApps() });
    let defs = [];
    const agent = { exposeToPeers: (d) => { defs = d; return d.length; }, surfaceTokenEntry: async () => ({ viewPubKey: 'view-key', actingAs: PERSON }) };
    exposeDoorToScreens({ agent, catalogue: doorCatalogue.catalogue(), manifests: Object.values(doorCatalogue.manifestsByOrigin()), doorCall, users });
    const skill = defs.find((d) => d.id === 'tools.useTool');
    expect(skill, 'a screen can reach tools.useTool').toBeTruthy();
    await skill.handler({ parts: [DataPart(ARGS)], envelope: { payload: { _token: { id: 'tok', subject: 'view-key', constraints: { actingAs: PERSON } } } } });
    expect(records).toEqual([{ person: PERSON, toolbox: 'boodschappen', tool: 'products.choices', outcome: 'ok' }]);
  });

  it('the box composes it so: the screens get the door\'s call, built on the wrapped call; nothing reaches tools around it', () => {
    const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../..');
    const src = readFileSync(path.join(ROOT, 'apps/basis/bin/device-runner.mjs'), 'utf8');
    expect(src).toMatch(/const callSkill = wrapCallSkillWithEgressGate\(/);
    expect(src).toMatch(/const doorCall = withAssistantOps\(\{\s*callSkill,/);
    expect(src).toMatch(/exposeDoorToScreens\(\{[^}]*doorCall[^}]*\}\)/);
    expect(src, 'no call of the tools app past the gate').not.toMatch(/agent\.callSkill\(\s*'tools'/);
  });
});
