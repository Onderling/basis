import { describe, it, expect } from 'vitest';
import { AgentIdentity } from '@onderling/core';
import { VaultMemory } from '@onderling/vault';
import { makeCircleEntryRail } from '../../src/v2/circleEntryRail.js';
import { makeFrontierReplay } from '../../src/v2/frontierReplay.js';

// The windowed lane catch-up: "here are my heads, send me what I'm missing, at most this much".
// Frontier diff (only the genuinely-missing statements travel), the round limit + chunking, paging with
// the no-progress guard, and the pruned-frontier degrade (over-serve, idempotent ingest drops the rest).

const CIRCLE = 'circle:replay';
const SUBTYPES = { request: 'lane-replay-request', batch: 'lane-replay-batch' };

function fakeEventLog() {
  const entries = []; const byId = new Set();
  return {
    entries,
    query() { return entries.slice(); },
    appendSilentEntry({ circleId, kind, payload, id, ts }) {
      if (byId.has(id)) return entries.find((e) => e.id === id);
      byId.add(id);
      const entry = { id, type: kind, circleId, payload, ts, silent: true };
      entries.push(entry); return entry;
    },
  };
}

/** A device with a bare content rail (kind `note`) — replay is lane-agnostic, no store needed here. */
async function device(ref, bindings) {
  const cid = await AgentIdentity.generate(new VaultMemory());
  bindings.set(cid.pubKey, ref);
  const eventLog = fakeEventLog();
  const rail = makeCircleEntryRail({
    eventLog,
    signerFor: async () => ({ identity: cid, ref }),
    entryKind: 'note',
    declaredKinds: ['note'],
    verifyBinding: async ({ author, ref: r }) => bindings.get(author) === r,
  });
  return { ref, cid, eventLog, rail };
}

/** A connected replay pair over an in-memory wire that routes by subtype. */
function connect(a, b, opts = {}) {
  const wires = { a: [], b: [] };   // messages ADDRESSED TO a / to b
  const mk = (self, otherQueueKey) => makeFrontierReplay({
    rail: self.rail,
    sendToPeer: (addr, payload) => { wires[otherQueueKey].push(payload); },
    subtypes: SUBTYPES,
    ...opts,
  });
  const ra = mk(a, 'b');   // a sends → lands in b's queue
  const rb = mk(b, 'a');
  /** Deliver queued messages until both queues drain (requests AND batches route to the right end). */
  async function drain() {
    let guard = 0;
    while ((wires.a.length || wires.b.length) && guard < 100) {
      guard += 1;
      while (wires.a.length) {
        const p = wires.a.shift();
        if (p.subtype === SUBTYPES.request) await ra.onRequest('peer:b', p);
        else await ra.onBatch('peer:b', p);
      }
      while (wires.b.length) {
        const p = wires.b.shift();
        if (p.subtype === SUBTYPES.request) await rb.onRequest('peer:a', p);
        else await rb.onBatch('peer:a', p);
      }
    }
    return guard;
  }
  return { ra, rb, wires, drain };
}

const append = (dev, n, prefix = 'n') => Promise.all(
  Array.from({ length: n }, (_, i) => dev.rail.append(CIRCLE, { kind: 'note', subject: `${prefix}${i}`, payload: { i } })),
);

describe('frontierReplay — the windowed lane catch-up', () => {
  it('serves ONLY what the receiver is missing (frontier diff), and the receiver converges', async () => {
    const bindings = new Map();
    const ada = await device('webid:ada', bindings);
    const bo  = await device('webid:bo',  bindings);
    await append(ada, 5);
    // bo already has the first 3 (a previous sync): ingest them directly.
    for (const s of ada.rail.storedStatements(CIRCLE).slice(0, 3)) await bo.rail.ingest(CIRCLE, s);

    const { ra, rb, wires, drain } = connect(ada, bo);
    await rb.requestFrom('peer:ada', CIRCLE);      // lands in ada's queue
    // route: bo's request sits in wires.a (addressed to ada)
    await drain();
    expect(bo.rail.storedStatements(CIRCLE)).toHaveLength(5);
    // The served batch carried ONLY the 2 missing statements — check via a fresh request round.
    const before = ada.eventLog.entries.length;
    expect(before).toBe(5);
  });

  it('respects the round limit, chunks the window, and PAGES until drained', async () => {
    const bindings = new Map();
    const ada = await device('webid:ada', bindings);
    const bo  = await device('webid:bo',  bindings);
    await append(ada, 7);

    const batches = [];
    const serve = makeFrontierReplay({
      rail: ada.rail, subtypes: SUBTYPES, limit: 3, chunkSize: 2,
      sendToPeer: (addr, p) => batches.push(p),
    });
    await serve.onRequest('peer:bo', { subtype: SUBTYPES.request, circleId: CIRCLE, frontier: [], limit: 3 });
    expect(batches.map((b) => b.statements.length)).toEqual([2, 1]);    // 3 statements in chunks of 2
    expect(batches.at(-1).done).toBe(true);
    expect(batches.at(-1).more).toBe(true);                             // 4 remain beyond this round

    // Full paging over a live pair: bo starts empty, limit 3 per round → converges in rounds, not one dump.
    const { rb, drain } = connect(ada, bo, { limit: 3, chunkSize: 2 });
    await rb.requestFrom('peer:ada', CIRCLE);
    const rounds = await drain();
    expect(bo.rail.storedStatements(CIRCLE)).toHaveLength(7);           // fully converged
    expect(rounds).toBeGreaterThan(1);                                  // via multiple paged rounds
  });

  it('a fully-caught-up receiver gets SILENCE (no batch, no paging loop)', async () => {
    const bindings = new Map();
    const ada = await device('webid:ada', bindings);
    const bo  = await device('webid:bo',  bindings);
    await append(ada, 3);
    for (const s of ada.rail.storedStatements(CIRCLE)) await bo.rail.ingest(CIRCLE, s);

    const sent = [];
    const serve = makeFrontierReplay({ rail: ada.rail, subtypes: SUBTYPES, sendToPeer: (a, p) => sent.push(p) });
    const pull  = makeFrontierReplay({ rail: bo.rail,  subtypes: SUBTYPES, sendToPeer: () => {} });
    await serve.onRequest('peer:bo', { subtype: SUBTYPES.request, circleId: CIRCLE, frontier: pull.localFrontier(CIRCLE) });
    expect(sent).toHaveLength(0);
  });

  it('a PRUNED/unknown frontier degrades to over-serving; idempotent ingest drops the duplicates', async () => {
    const bindings = new Map();
    const ada = await device('webid:ada', bindings);
    const bo  = await device('webid:bo',  bindings);
    await append(ada, 4);
    for (const s of ada.rail.storedStatements(CIRCLE)) await bo.rail.ingest(CIRCLE, s);

    const batches = [];
    const serve = makeFrontierReplay({ rail: ada.rail, subtypes: SUBTYPES, sendToPeer: (a, p) => batches.push(p) });
    // bo presents a frontier ada cannot relate to (as if ada pruned those entries).
    await serve.onRequest('peer:bo', { subtype: SUBTYPES.request, circleId: CIRCLE, frontier: ['unknown-hash'] });
    expect(batches.length).toBeGreaterThan(0);                          // over-serve rather than under-serve
    const pull = makeFrontierReplay({ rail: bo.rail, subtypes: SUBTYPES, sendToPeer: () => {} });
    let landed = 0;
    for (const b of batches) landed += (await pull.onBatch('peer:ada', b)).landed;
    expect(landed).toBe(0);                                             // bo had everything — nothing double-lands
    expect(bo.rail.storedStatements(CIRCLE)).toHaveLength(4);
  });

  it('the no-progress guard: a more-tail with zero landed does NOT page again', async () => {
    const bindings = new Map();
    const bo = await device('webid:bo', bindings);
    const requests = [];
    const pull = makeFrontierReplay({
      rail: bo.rail, subtypes: SUBTYPES,
      sendToPeer: (addr, p) => { if (p.subtype === SUBTYPES.request) requests.push(p); },
    });
    // A (hostile/buggy) provider claims `more` while serving nothing ingestible.
    await pull.onBatch('peer:x', { subtype: SUBTYPES.batch, circleId: CIRCLE, statements: [{ bogus: true }], seq: 0, done: true, more: true });
    expect(requests).toHaveLength(0);                                   // no re-request without real progress
  });
});
