/**
 * AuditLog.compact — the AUDIT retention class "compacts rather than dropping" (architecture.md §2 /
 * entryKinds.js). This is the "re-chain the tail" fold (Frits 2026-08-06): fold the old run into one signed
 * `audit.summary` and re-chain the recent survivors, so the log stays ONE continuous strand that verify()
 * accepts. These prove the mechanism preserves the two things that matter — chain verifiability and a
 * truthful record of WHAT was folded — and that it refuses to touch a chain it did not fully sign.
 */
import { describe, it, expect } from 'vitest';
import { AgentIdentity } from '@onderling/core';
import { VaultMemory } from '@onderling/vault';

import { RETAIN, retentionWindowFor } from '@onderling/item-store';

import { loadAuditLog, AUDIT_SUMMARY_EVENT } from '../src/auditLog.js';

const freshLog = async () => loadAuditLog({ identity: await AgentIdentity.generate(new VaultMemory()) });
const DAY = 24 * 60 * 60 * 1000;

describe('AuditLog.compact — re-chain the tail', () => {
  it('folds the old tail into one summary + re-chains survivors, and verify() still passes', async () => {
    const log = await freshLog();
    for (let i = 0; i < 10; i++) await log.append({ event: 'mute.add', subject: `u${i}`, now: 1000 + i });
    expect(log.size).toBe(10);

    const res = await log.compact({ keepRecent: 3, now: 5000 });
    expect(res).toMatchObject({ compacted: true, foldedCount: 7 });
    expect(log.verify()).toEqual({ ok: true });          // still ONE valid strand after the fold
    expect(log.size).toBe(4);                             // summary + 3 survivors

    const [summary, ...survivors] = log.entries();
    expect(summary.event).toBe(AUDIT_SUMMARY_EVENT);
    expect(summary.prev).toBeNull();                     // the summary is the new head
    expect(summary.data).toMatchObject({ foldedCount: 7, from: 1000, to: 1006 });
    expect(summary.data.counts).toEqual({ 'mute.add': 7 });
    expect(summary.data.actors).toEqual([log.head().actor]);       // single-signer device
    expect(typeof summary.data.foldedThroughHash).toBe('string');  // evidence of the folded run's boundary

    // survivors keep their CONTENT verbatim (the last three originals) — only their prev-link changed.
    expect(survivors.map((e) => e.subject)).toEqual(['u7', 'u8', 'u9']);
  });

  it('is a no-op when there is nothing worth folding (fewer than two would only grow the log)', async () => {
    const log = await freshLog();
    for (let i = 0; i < 3; i++) await log.append({ event: 'e', now: i });
    expect(await log.compact({ keepRecent: 3 })).toMatchObject({ compacted: false, reason: 'nothing-to-fold' });
    expect(await log.compact({ keepRecent: 2 })).toMatchObject({ compacted: false, reason: 'nothing-to-fold' });
    expect(log.size).toBe(3);
  });

  it('carries foldedCount forward under repeated compaction (truthful, no double-count)', async () => {
    const log = await freshLog();
    for (let i = 0; i < 12; i++) await log.append({ event: 'e', now: i });
    await log.compact({ keepRecent: 4, now: 100 });                 // fold R1..R8 → S1(8) + R9..R12
    expect(log.size).toBe(5);
    for (let i = 0; i < 4; i++) await log.append({ event: 'e', now: 200 + i });   // + R13..R16 → 9 entries

    const res = await log.compact({ keepRecent: 3, now: 300 });     // fold [S1, R9..R12, R13] → S2, keep R14..R16
    expect(res.compacted).toBe(true);
    expect(log.verify()).toEqual({ ok: true });
    // S2 stands for R1..R13 = 13 real entries (S1's 8 + the 5 real ones folded now), never the summary slots.
    expect(log.entries()[0].data.foldedCount).toBe(13);
    expect(log.size).toBe(4);                                       // S2 + R14..R16
  });

  it('compactToWindow folds by AGE using the shared AUDIT window, keeping entries inside it', async () => {
    const log = await freshLog();
    for (let i = 0; i < 5; i++) await log.append({ event: 'key.rotate', now: 1000 + i });      // ancient (~epoch)
    for (let i = 0; i < 3; i++) await log.append({ event: 'mute.add',  now: 100 * DAY + i });   // recent

    const res = await log.compactToWindow({ now: 100 * DAY + 10 });   // 100 days >> the 14-day AUDIT window
    expect(res.windowMs).toBe(retentionWindowFor(RETAIN.AUDIT));      // window derived from the shared table
    expect(res.compacted).toBe(true);
    expect(res.keepRecent).toBe(3);                                   // the 3 recent are inside the window
    expect(log.verify()).toEqual({ ok: true });
    expect(log.size).toBe(4);                                         // summary + 3 recent
    expect(log.entries()[0].event).toBe(AUDIT_SUMMARY_EVENT);
    expect(log.entries()[0].data.foldedCount).toBe(5);               // the 5 ancient folded
  });

  it('refuses to re-chain a foreign-signed survivor (mixed-signer) rather than corrupt it', async () => {
    const log = await freshLog();
    const meActor = (await log.append({ event: 'e', now: 1 })).actor;
    // A chain whose SURVIVOR was signed by someone else — compact must refuse before re-signing it.
    await log.loadSerialized(JSON.stringify([
      { v: 1, id: 'a', ts: 1, actor: meActor,       event: 'e', prev: null, sig: 'x' },
      { v: 1, id: 'b', ts: 2, actor: meActor,       event: 'e', prev: 'y',  sig: 'x' },
      { v: 1, id: 'c', ts: 3, actor: 'FOREIGN_KEY', event: 'e', prev: 'z',  sig: 'x' },
    ]));
    expect(await log.compact({ keepRecent: 1 })).toMatchObject({ compacted: false, reason: 'mixed-signer' });
  });
});
