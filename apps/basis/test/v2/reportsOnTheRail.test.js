/**
 * Reports on the governance rail: signed, admitted by their rule, and read only by the circle's admins and the person
 * who filed. Three devices — Ada (admin), Bo (a member, who reports) and Cor (the member reported) — each with its own
 * per-circle key and device log; the roster is what `listGroupMembers` answers (webid · role · proven address).
 */
import { describe, it, expect } from 'vitest';
import { AgentIdentity } from '@onderling/core';
import { VaultMemory } from '@onderling/vault';
import { EventLog } from '../../src/eventLog.js';
import { makeGovernanceRail, bindCircleGovernance } from '../../src/v2/governanceAppWiring.js';
import { makeGovernanceCatchUp } from '../../src/v2/governanceCatchUp.js';
import { makeCircleReportPeerHandler } from '../../src/v2/circleLogReceiver.js';
import { narrowReportStatements, REPORT_FILE_KIND, REPORT_RESOLVE_KIND } from '../../src/v2/reportLane.js';

const CIRCLE = 'kring-meldingen';

async function circleOf() {
  const people = {};
  for (const [name, role] of [['ada', 'admin'], ['bo', 'member'], ['cor', 'member']]) {
    people[name] = { webid: `webid:${name}`, role, id: await AgentIdentity.generate(new VaultMemory()) };
  }
  const roster = Object.values(people).map((p) => ({ webid: p.webid, role: p.role, circleAddress: p.id.pubKey }));
  const callSkill = async (app, op) => (app === 'pinboard' && op === 'listGroupMembers' ? { members: roster.map((r) => ({ ...r })) } : {});
  for (const p of Object.values(people)) {
    p.log = new EventLog({ initial: [], muted: [] });
    p.rail = makeGovernanceRail({ eventLog: p.log, circleIdentityFor: async () => p.id, myRef: p.webid, callSkill });
  }
  return { people, callSkill };
}

const fileAs = (who, by, reportId = 'rep-1') => who.rail.append(CIRCLE, {
  kind: REPORT_FILE_KIND, subject: reportId, payload: { targetType: 'member', targetRef: 'webid:cor', reason: 'scheldt', by, at: 1 },
});
const resolveAs = (who, reportId = 'rep-1') => who.rail.append(CIRCLE, { kind: REPORT_RESOLVE_KIND, subject: reportId, payload: { outcome: 'dismissed', at: 2 } });

describe('reports on the governance rail', () => {
  it('a report filed AS someone else is refused; filed as oneself it lands', async () => {
    const { people: { ada, bo } } = await circleOf();
    const forged = await fileAs(bo, 'webid:ada', 'rep-forged');
    expect((await ada.rail.ingest(CIRCLE, forged.statement))?.ok, 'a filing whose by is not its author').toBe(false);
    const real = await fileAs(bo, 'webid:bo');
    expect((await ada.rail.ingest(CIRCLE, real.statement))?.ok).toBe(true);
  });

  it("a resolution from a member is refused; an admin's lands", async () => {
    const { people: { ada, bo, cor } } = await circleOf();
    const filed = await fileAs(bo, 'webid:bo');
    await ada.rail.ingest(CIRCLE, filed.statement);
    const byCor = await resolveAs(cor);
    expect((await ada.rail.ingest(CIRCLE, byCor.statement))?.ok, 'the reported member cannot close the report').toBe(false);
    const byAda = await resolveAs(ada);
    expect((await bo.rail.ingest(CIRCLE, byAda.statement))?.ok).toBe(true);
  });

  it('the catch-up serve hands report statements to the admins and the reporter only — never to the reported member', async () => {
    const { people: { ada, bo, cor }, callSkill } = await circleOf();
    const filed = await fileAs(bo, 'webid:bo');
    await ada.rail.ingest(CIRCLE, filed.statement);
    await ada.rail.ingest(CIRCLE, (await resolveAs(ada)).statement);
    const sent = [];
    const cu = makeGovernanceCatchUp({
      rail: ada.rail,
      sendToPeer: async (to, payload) => { sent.push({ to, payload }); },
      narrowServe: (statements, who) => narrowReportStatements(statements, who, { callSkill }),
    });
    const kindsServedTo = async (p) => {
      sent.length = 0;
      await cu.onRequest(p.id.pubKey, { subtype: cu.subtypes.request, circleId: CIRCLE });
      return (sent[0]?.payload?.statements ?? []).map((s) => s.body.kind);
    };
    expect(await kindsServedTo(cor), 'the reported member').toEqual([]);
    expect((await kindsServedTo(bo)).sort(), 'the reporter: the filing and its outcome').toEqual([REPORT_FILE_KIND, REPORT_RESOLVE_KIND].sort());
    expect((await kindsServedTo(ada)).length).toBe(2);
  });

  it("a filed report fans to the admins and the reporter only, and the reported member's device never holds it", async () => {
    const { people: { ada, bo, cor }, callSkill } = await circleOf();
    const fanned = [];
    const gov = bindCircleGovernance({
      eventLog: bo.log, callSkill, getPolicy: async () => ({}), myRef: bo.webid, genId: () => 'rep-x',
      circleIdentityFor: async () => bo.id, broadcast: (channel, circleId, statement, opts) => fanned.push({ channel, statement, to: opts?.to }),
    });
    await gov.reports.file({ circleId: CIRCLE, targetType: 'member', targetRef: cor.webid, reason: 'scheldt' });
    expect(fanned).toHaveLength(1);
    expect(fanned[0].channel).toBe('report');
    expect(fanned[0].to.sort()).toEqual([ada.webid, bo.webid].sort());
    // delivered as the fan delivers it: to each named reader; Cor is not one, so Cor's log never holds it
    for (const p of [ada, cor]) {
      if (!fanned[0].to.includes(p.webid)) continue;
      await makeCircleReportPeerHandler({ rail: p.rail })(bo.id.pubKey, { subtype: 'circle-report-broadcast', circleId: CIRCLE, event: fanned[0].statement });
    }
    const holds = (p) => p.rail.storedStatements(CIRCLE).some((s) => s.body.kind === REPORT_FILE_KIND);
    expect(holds(ada)).toBe(true);
    expect(holds(cor)).toBe(false);
  });

  it('the report receiver refuses an unsigned event', async () => {
    const { people: { ada } } = await circleOf();
    await makeCircleReportPeerHandler({ rail: ada.rail })('x', { subtype: 'circle-report-broadcast', circleId: CIRCLE, event: { kind: 'report', event: 'report', reportId: 'r', by: 'webid:bo' } });
    expect(ada.rail.storedStatements(CIRCLE)).toEqual([]);
  });
});
