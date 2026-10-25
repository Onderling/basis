/**
 * The box receives a report the moment it is fanned, through the lane table every shell spreads (the box included):
 * an admin's box admits a filed report on its governance rail. The box also routes live governance statements itself,
 * as web and mobile do — held by shellsRouteTheSameSubtypes reading device-runner's composition.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { AgentIdentity } from '@onderling/core';
import { VaultMemory } from '@onderling/vault';
import { EventLog } from '../../src/eventLog.js';
import { makeGovernanceRail } from '../../src/v2/governanceAppWiring.js';
import { buildCircleLanes } from '../../src/v2/circleLanes.js';
import { REPORT_FILE_KIND } from '../../src/v2/reportLane.js';

const CIRCLE = 'kring-doos';

describe("a report reaches an admin's box", () => {
  it('the lane table the box spreads admits a member\'s filed report on the box\'s governance rail; a forged one it refuses', async () => {
    const admin = await AgentIdentity.generate(new VaultMemory());
    const bo = await AgentIdentity.generate(new VaultMemory());
    const roster = [{ webid: 'webid:ada', role: 'admin', circleAddress: admin.pubKey }, { webid: 'webid:bo', role: 'member', circleAddress: bo.pubKey }];
    const callSkill = async (app, op) => (app === 'pinboard' && op === 'listGroupMembers' ? { members: roster.map((r) => ({ ...r })) } : {});
    const boxLog = new EventLog({ initial: [], muted: [] });
    const boxRail = makeGovernanceRail({ eventLog: boxLog, circleIdentityFor: async () => admin, myRef: 'webid:ada', callSkill });
    const boRail = makeGovernanceRail({ eventLog: new EventLog({ initial: [], muted: [] }), circleIdentityFor: async () => bo, myRef: 'webid:bo', callSkill });

    const lanes = buildCircleLanes({ agent: { callSkill, identity: { chat: { pubKey: 'box' } } }, govRail: boxRail, eventLog: boxLog, sendToPeer: async () => {} });
    const door = lanes.handlers['circle-report-broadcast'];
    expect(typeof door, 'the lane table carries the report door').toBe('function');

    const filed = await boRail.append(CIRCLE, { kind: REPORT_FILE_KIND, subject: 'rep-1', payload: { targetType: 'post', targetRef: 'p1', reason: 'spam', by: 'webid:bo', at: 1 } });
    await door(bo.pubKey, { subtype: 'circle-report-broadcast', circleId: CIRCLE, event: filed.statement });
    const forged = await boRail.append(CIRCLE, { kind: REPORT_FILE_KIND, subject: 'rep-2', payload: { targetType: 'post', targetRef: 'p1', reason: 'x', by: 'webid:ada', at: 1 } });
    await door(bo.pubKey, { subtype: 'circle-report-broadcast', circleId: CIRCLE, event: forged.statement });

    const held = boxRail.storedStatements(CIRCLE).filter((s) => s.body.kind === REPORT_FILE_KIND).map((s) => s.body.subject);
    expect(held).toEqual(['rep-1']);
  });

  it('the box routes live governance statements itself, as web and mobile do', () => {
    const box = readFileSync(fileURLToPath(new URL('../../bin/device-runner.mjs', import.meta.url)), 'utf8');
    const router = box.slice(box.indexOf('const router = makePeerRouter({'));
    expect(router.slice(0, 2000)).toMatch(/'circle-governance-broadcast':\s*makeCircleGovernancePeerHandler\(/);
  });
});
