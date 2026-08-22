/**
 * Self-tests for lint-kind-appenders — a guard whose own logic is untested is not a guard.
 * The pure `auditKinds` is exercised with synthetic inputs; `parseKinds` against the REAL table
 * source, so a table-shape change that would blind the parser fails here first.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { execSync } from 'node:child_process';
import path from 'node:path';
import { parseKinds, auditKinds, APPENDERS } from './lint-kind-appenders.mjs';

const ROOT = execSync('git rev-parse --show-toplevel', { encoding: 'utf8' }).trim();

describe('lint-kind-appenders', () => {
  it('parses the REAL table and finds the known kinds (parser cannot go blind silently)', () => {
    const kinds = parseKinds(readFileSync(path.join(ROOT, 'packages/item-store/src/entryKinds.js'), 'utf8'));
    for (const k of ['chat-message', 'membership', 'grants', 'governance', 'key-event', 'audit-summary']) {
      expect(kinds, `expected declared kind '${k}'`).toContain(k);
    }
    // Every parsed kind has a row and every row a parsed kind — the live map is complete right now.
    const { missing, stale } = auditKinds({ kinds, appenders: APPENDERS, exists: () => true, read: () => '' });
    expect(missing, 'declared kinds without an APPENDERS row').toEqual([]);
    expect(stale, 'APPENDERS rows for undeclared kinds').toEqual([]);
  });

  it('a new kind without an appender row is MISSING (the drift this guard exists for)', () => {
    const r = auditKinds({
      kinds: ['a', 'brand-new'],
      appenders: { a: { file: 'x.js', needle: 'A' } },
      exists: () => true,
      read: () => 'A',
    });
    expect(r.missing).toEqual(['brand-new']);
  });

  it('evidence that stops holding is BROKEN, a removed kind leaves a STALE row, pending is carried', () => {
    const r = auditKinds({
      kinds: ['moved', 'reserved'],
      appenders: {
        moved: { file: 'x.js', needle: 'GONE' },
        reserved: { pending: 'ledger L33' },
        removed: { file: 'y.js', needle: 'B' },
      },
      exists: () => true,
      read: () => 'nothing here',
    });
    expect(r.broken.map(([k]) => k)).toEqual(['moved']);
    expect(r.stale).toEqual(['removed']);
    expect(r.pending.map(([k]) => k)).toEqual(['reserved']);
  });
});
