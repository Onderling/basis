/**
 * The audit-retention agreement guard (full) — the two audit records agree on retention, from ONE table.
 *
 * @guard sa.audit and the agent trail read their AUDIT retention window from ONE shared table
 *
 * sa.audit (secure-agent's signed security log) and the agent trail (basis's eventLog) must read their AUDIT
 * retention window from the SAME shared table — `@onderling/item-store` `RETENTION_DEFAULTS` — so they cannot
 * drift to different windows (architecture.md §2 / PLAN-homes:188-196). basis is the ONLY place both records
 * are importable (it depends on both), so the full agreement is pinned here; the sa.audit-side half also lives
 * in packages/secure-agent/test/auditRetentionAgreement.test.js.
 *
 * History: for one commit these read two different tables (a count-based one in item-store I added, and the
 * duration-based one still in eventLog) — the exact drift this guard now forbids. Consolidated 2026-08-06.
 */
import { describe, it, expect } from 'vitest';
import { AgentIdentity } from '@onderling/core';
import { VaultMemory } from '@onderling/vault';
import { RETAIN, RETENTION_DEFAULTS, retentionWindowFor } from '@onderling/item-store';
import { loadAuditLog } from '@onderling/secure-agent';

import { RETENTION_DEFAULTS as EVENTLOG_RETENTION } from '../src/eventLog.js';

describe('audit-retention agreement — sa.audit and the agent trail read ONE shared retention table', () => {
  it('the agent trail (eventLog) reads the shared item-store table, not a private copy', () => {
    // eventLog re-exports the SAME object it imports from item-store — a local copy would fail reference eq.
    expect(EVENTLOG_RETENTION).toBe(RETENTION_DEFAULTS);
    expect(EVENTLOG_RETENTION[RETAIN.AUDIT]).toBe(RETENTION_DEFAULTS[RETAIN.AUDIT]);
  });

  it('sa.audit compacts to the SAME AUDIT window the trail uses', async () => {
    const log = await loadAuditLog({ identity: await AgentIdentity.generate(new VaultMemory()) });
    const res = await log.compactToWindow();
    // sa.audit's window is the shared table's AUDIT window …
    expect(res.windowMs).toBe(retentionWindowFor(RETAIN.AUDIT));
    // … which IS the trail's audit window. One table, one number, no drift.
    expect(res.windowMs).toBe(EVENTLOG_RETENTION[RETAIN.AUDIT]);
  });
});
