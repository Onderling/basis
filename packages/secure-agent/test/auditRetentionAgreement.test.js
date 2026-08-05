/**
 * G-A4 — the audit-retention AGREEMENT guard.
 *
 * The two audit records — `sa.audit` (the security layer's signed log) and the agent trail (agent actions) —
 * stay separate but must declare their retention window from the ONE shared kind/retention table
 * (`entryKinds`), so they cannot drift to different windows (architecture.md §2 / PLAN-homes:188-196). This
 * pins that agreement: sa.audit's compaction window IS the table's AUDIT window (proved derived, not a
 * hardcoded number), and the trail's kinds resolve to the same AUDIT class — so when the trail's compaction
 * lands it reads the same bucket. A change to either side that reintroduces a private window fails here.
 */
import { describe, it, expect } from 'vitest';
import { AgentIdentity } from '@onderling/core';
import { VaultMemory } from '@onderling/vault';
import { RETAIN, RETENTION_WINDOW, retentionWindowFor, isAuditKind } from '@onderling/item-store';

import { loadAuditLog } from '../src/auditLog.js';

describe('G-A4 — the two audit records derive their retention window from the one kind table', () => {
  it('the shared table declares an AUDIT window', () => {
    expect(RETENTION_WINDOW[RETAIN.AUDIT]).toBeGreaterThan(0);
    expect(retentionWindowFor(RETAIN.AUDIT)).toBe(RETENTION_WINDOW[RETAIN.AUDIT]);
  });

  it('sa.audit resolves its compaction window FROM the table, not a hardcoded number', async () => {
    const log = await loadAuditLog({ identity: await AgentIdentity.generate(new VaultMemory()) });
    const res = await log.compactToWindow();
    // The window it used is exactly the shared table's AUDIT window — if sa.audit hardcoded its own, this
    // equality breaks the moment the table changes.
    expect(res.window).toBe(retentionWindowFor(RETAIN.AUDIT));
  });

  it('the agent-trail kinds are AUDIT-class, so they read the SAME window bucket', () => {
    // Trail records land as 'agent-action' / 'settings-change' in the event log; both are audit-class, so
    // their retention resolves through the same RETAIN.AUDIT bucket sa.audit uses — the agreement holds by
    // construction once the trail's compaction is wired. Extend this with the trail's LIVE window assertion
    // when that lands (the second half of G-A4).
    expect(isAuditKind('agent-action')).toBe(true);
    expect(isAuditKind('settings-change')).toBe(true);
  });
});
