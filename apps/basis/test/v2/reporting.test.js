/**
 * Reporting (Phase 4 §8, Wave C) — the report model + host.
 *
 * A member files a report; an admin dismisses or acts. Acting on a MEMBER routes through
 * the governance removeMember class (any-admin bans now; member-vote opens a vote); acting
 * on a post/message just closes the report actioned. Reports round-trip the fold.
 */
import { describe, it, expect, vi } from 'vitest';
import { reportEvent, resolveReportEvent, foldReports, REPORT_STATUS } from '../../src/v2/reportModel.js';
import { makeCircleReports } from '../../src/v2/reportHost.js';

describe('foldReports', () => {
  it('builds an open report, then a resolve closes it with its outcome', () => {
    const events = [
      reportEvent({ reportId: 'r1', targetType: 'member', targetRef: 'm2', reason: 'spam', by: 'm0', at: 1 }),
      reportEvent({ reportId: 'r2', targetType: 'post', targetRef: 'post-9', reason: 'abuse', by: 'm1', at: 2 }),
      resolveReportEvent({ reportId: 'r2', outcome: REPORT_STATUS.DISMISSED, by: 'admin0', at: 5 }),
    ];
    const { open, resolved, openCount } = foldReports(events);
    expect(openCount).toBe(1);
    expect(open[0]).toMatchObject({ reportId: 'r1', targetType: 'member', targetRef: 'm2', reason: 'spam', status: 'open' });
    expect(resolved[0]).toMatchObject({ reportId: 'r2', status: 'dismissed' });
  });
  it('drops a resolve with no matching report and ignores an unknown target type', () => {
    expect(foldReports([resolveReportEvent({ reportId: 'ghost', outcome: 'dismissed' })]).open).toHaveLength(0);
    expect(foldReports([reportEvent({ reportId: 'r', targetType: 'nonsense', targetRef: 'x', by: 'm0' })]).open).toHaveLength(0);
  });
});

/** A report host over an in-memory log + a spy governance handle. */
function harness() {
  const events = [];
  const governance = { propose: vi.fn(async () => ({ ok: true, status: 'approved', enacted: true })) };
  let n = 0;
  const reports = makeCircleReports({
    readReportEvents: async () => events,
    appendReportEvent: async (_c, e) => { events.push(e); },
    governance,
    newReportId: () => `r${(n += 1)}`,
    localActorRef: 'admin0',
    now: () => 1,
  });
  return { reports, events, governance };
}

describe('makeCircleReports', () => {
  it('file → the report shows as open in the list', async () => {
    const { reports } = harness();
    const r = await reports.file({ circleId: 'c1', targetType: 'member', targetRef: 'm2', reason: 'harassment' });
    expect(r).toMatchObject({ ok: true, reportId: 'r1' });
    const list = await reports.list('c1');
    expect(list.open[0]).toMatchObject({ targetType: 'member', targetRef: 'm2', reason: 'harassment' });
  });

  it('dismiss closes it without touching governance', async () => {
    const { reports, governance } = harness();
    const { reportId } = await reports.file({ circleId: 'c1', targetType: 'post', targetRef: 'post-9' });
    const r = await reports.dismiss({ circleId: 'c1', reportId });
    expect(r.status).toBe('dismissed');
    expect(governance.propose).not.toHaveBeenCalled();
    expect((await reports.list('c1')).openCount).toBe(0);
  });

  it('act on a MEMBER routes the ban through governance removeMember, then closes actioned', async () => {
    const { reports, governance } = harness();
    const { reportId } = await reports.file({ circleId: 'c1', targetType: 'member', targetRef: 'm2@id' });
    const r = await reports.act({ circleId: 'c1', reportId });
    expect(r.status).toBe('actioned');
    expect(governance.propose).toHaveBeenCalledWith({ circleId: 'c1', action: 'removeMember', subject: 'm2@id', actor: { ref: 'admin0' } });
    expect((await reports.list('c1')).openCount).toBe(0);
  });

  it('act on a POST removes the item via the injected remover (not governance), closes actioned', async () => {
    const events = [];
    const governance = { propose: vi.fn() };
    const removeReported = vi.fn(async () => ({ ok: true }));
    let n = 0;
    const reports = makeCircleReports({
      readReportEvents: async () => events, appendReportEvent: async (_c, e) => { events.push(e); },
      governance, removeReported, newReportId: () => `r${(n += 1)}`, localActorRef: 'admin0', now: () => 1,
    });
    const { reportId } = await reports.file({ circleId: 'c1', targetType: 'post', targetRef: 'post-9' });
    const r = await reports.act({ circleId: 'c1', reportId });
    expect(r.status).toBe('actioned');
    expect(governance.propose).not.toHaveBeenCalled();
    expect(removeReported).toHaveBeenCalledWith('c1', 'post', 'post-9');
  });

  it('act on a missing report is refused', async () => {
    const { reports } = harness();
    expect((await reports.act({ circleId: 'c1', reportId: 'nope' })).ok).toBe(false);
  });
});
