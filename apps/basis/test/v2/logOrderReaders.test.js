/**
 * THREE READERS TOOK THE LOG'S READING ORDER AS TIME (found on the items lane's review, 2026-11-21). The device log
 * reads NEWEST-first; the test fakes read oldest-first, so these passed in tests and were wrong on a real device:
 *   • the catch-up serve sent the missing statements newest-first, and its round cap kept the NEWEST: a remove that
 *     lands before its add lets the add put the row back;
 *   • the report fold lets the last resolution win, so on the real log the OLDEST resolution decided;
 *   • the key fold broke ties between two statements at one chain depth by reading order, so which re-issue is current
 *     could differ per device.
 * Each now orders by the statements' own causal links (`causalOrder`, core), or by hash for a tie: the same answer
 * whatever order the log reads in. Every case runs in BOTH reading orders.
 */
import { describe, it, expect } from 'vitest';
import { causalOrder } from '@onderling/core';
import { makeFrontierReplay } from '../../src/v2/frontierReplay.js';
import { foldReports } from '../../src/v2/reportModel.js';
import { keyEventsFromRail } from '../../src/v2/keyRail.js';

const both = (list) => [['oldest-first (a fake)', list], ['newest-first (the device log)', [...list].reverse()]];

describe('causalOrder', () => {
  it('parents before children, concurrent ones by hash, the same for either reading order', () => {
    const a = { hash: 'a' }; const b = { hash: 'b', parentHash: 'a' }; const c = { hash: 'c', parentHash: 'b' };
    const x = { hash: 'x', parentHash: 'a' };   // concurrent with b
    for (const [, list] of both([a, b, x, c])) expect(causalOrder(list).map((e) => e.hash)).toEqual(['a', 'b', 'c', 'x']);
  });
});

describe('the catch-up serve: oldest first, the cap keeps the earliest', () => {
  for (const [label, order] of both(['s1', 's2', 's3'])) {
    it(`served in causal order, capped at the earliest two (${label})`, async () => {
      const chain = { s1: { hash: 's1' }, s2: { hash: 's2', parentHash: 's1' }, s3: { hash: 's3', parentHash: 's2' } };
      const stored = order.map((h) => ({ body: chain[h] }));
      const sent = [];
      const replay = makeFrontierReplay({
        rail: { storedStatements: () => stored, ingest: async () => ({ ok: true }), checkSigned: () => true },
        sendToPeer: async (_to, payload) => { sent.push(payload); },
        subtypes: { request: 'test-req', batch: 'test-batch' },
        limit: 2, offerThreshold: 100,
      });
      await replay.onRequest('peer', { subtype: 'test-req', circleId: 'c', frontier: [], limit: 2 });
      const served = sent.flatMap((p) => p.statements ?? []).map((s) => s.body.hash);
      expect(served).toEqual(['s1', 's2']);
    });
  }
});

describe('the report fold: the LATEST resolution decides', () => {
  const file = { hash: 'r0', kind: 'report', reportId: 'rep', event: 'report', targetType: 'post', targetRef: 'p1', reason: 'spam', by: 'm', at: 1 };
  const dismiss = { hash: 'r1', parentHash: 'r0', kind: 'report', reportId: 'rep', event: 'resolve', outcome: 'dismissed', by: 'a1' };
  const remove = { hash: 'r2', parentHash: 'r1', kind: 'report', reportId: 'rep', event: 'resolve', outcome: 'actioned', by: 'a1' };
  for (const [label, list] of both([file, dismiss, remove])) {
    it(`the later resolution (actioned) is the report's outcome (${label})`, () => {
      const folded = foldReports(causalOrder(list));
      expect(folded.resolved[0]?.status).toBe('actioned');
    });
  }
});

describe('the key fold: a tie between two statements at one depth folds the same on every device', () => {
  const ev = (hash, author, version) => ({ hash, author, kind: 'key-rotate', payload: { event: { kind: 'rotate', version, by: author } } });
  const p = ev('k-b', 'bob', 2); const q = ev('k-a', 'ann', 2);
  it('both reading orders give the same sequence', async () => {
    const run = async (list) => keyEventsFromRail({ readVerifiedBodies: async () => ({ bodies: list }) }, 'c');
    expect(await run([p, q])).toEqual(await run([q, p]));
  });
});
