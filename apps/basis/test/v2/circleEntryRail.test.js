import { describe, it, expect, vi } from 'vitest';
import { AgentIdentity, signSpine, createSignatureMemo } from '@onderling/core';
import { VaultMemory } from '@onderling/vault';
import { makeCircleEntryRail } from '../../src/v2/circleEntryRail.js';
import { foldGovernance } from '../../src/v2/governanceLog.js';

// The rail core: signed circle-scoped governance entries on the device log, verified read,
// projected into the flat events the REAL foldGovernance consumes. Kinds are declared in the fold's own
// event vocabulary (propose/vote/resolve) so the projection needs no mapping table.

const CIRCLE = 'circle:g1';
const KINDS = ['propose', 'vote', 'resolve'];

/** A minimal EventLog fake honouring the contract the rail relies on: query-all + id-deduped silent append. */
function fakeEventLog() {
  const entries = [];
  const byId = new Set();
  return {
    entries,
    query() { return entries.slice(); },
    appendSilentEntry({ circleId, kind, payload, id }) {
      if (byId.has(id)) return entries.find((e) => e.id === id);   // first-write-wins (audit semantics)
      byId.add(id);
      const entry = { id, type: kind, circleId, payload, silent: true };
      entries.push(entry);
      return entry;
    },
  };
}

async function member(ref) {
  return { ref, identity: await AgentIdentity.generate(new VaultMemory()) };
}

const railFor = (eventLog, me, opts = {}) => makeCircleEntryRail({
  eventLog,
  signerFor: async () => ({ identity: me.identity, ref: me.ref }),
  entryKind: 'governance',
  declaredKinds: KINDS,
  ...opts,
});

describe('the rail — append (signed, chained, declared)', () => {
  it('propose + vote round-trip through the REAL governance fold', async () => {
    const log = fakeEventLog();
    const alice = await member('webid:alice');
    const rail = railFor(log, alice);
    await rail.append(CIRCLE, { kind: 'propose', subject: 'prop-1', payload: { action: 'changePolicy', subject: { theme: 'dark' }, by: alice.ref, at: 1 } });
    await rail.append(CIRCLE, { kind: 'vote', subject: 'prop-1', payload: { voter: alice.ref, choice: 'yes', at: 2 } });

    const { events, disputed } = await rail.readVerified(CIRCLE);
    expect(events).toHaveLength(2);
    const fold = foldGovernance(events, {
      policy: {}, members: [{ ref: alice.ref, role: 'admin' }], now: 3, disputed,
    });
    expect(fold.proposals).toHaveLength(1);
    expect(fold.proposals[0].action).toBe('changePolicy');
    // votes carry the chain fields now (hash/parentHash — the revote-supersedence coordinate).
    expect(fold.proposals[0].votes).toMatchObject([{ voter: alice.ref, choice: 'yes', at: 2 }]);
    expect(fold.proposals[0].votes[0].hash).toBeTruthy();
  });

  it('the second append CHAINS on the author\'s first (parent = own head), deps stay empty solo', async () => {
    const log = fakeEventLog();
    const alice = await member('webid:alice');
    const rail = railFor(log, alice);
    const a = await rail.append(CIRCLE, { kind: 'propose', subject: 'p1', payload: { action: 'changeRule', by: alice.ref } });
    const b = await rail.append(CIRCLE, { kind: 'vote', subject: 'p1', payload: { voter: alice.ref, choice: 'yes' } });
    expect(b.statement.body.parentHash).toBe(a.statement.body.hash);
    expect(b.statement.body.deps ?? []).toEqual([]);   // empty deps is omitted from the body by design
  });

  it('D6 loud gate: an UNDECLARED kind throws at the write — never a silent no-op', async () => {
    const rail = railFor(fakeEventLog(), await member('webid:alice'));
    await expect(rail.append(CIRCLE, { kind: 'sneaky-kind', subject: 'x', payload: {} }))
      .rejects.toThrow(/not declared/);
  });

  it('no circle signer resolvable → null (the caller may run its legacy path during cutover)', async () => {
    const rail = makeCircleEntryRail({
      eventLog: fakeEventLog(), signerFor: async () => null, entryKind: 'governance', declaredKinds: KINDS,
    });
    expect(await rail.append(CIRCLE, { kind: 'propose', subject: 'p', payload: {} })).toBeNull();
  });
});

describe('the rail — verified read (the receiver-enforced half)', () => {
  it('acting-as-someone-else is dropped: a valid signature does not let alice vote as bob', async () => {
    const log = fakeEventLog();
    const alice = await member('webid:alice');
    const rail = railFor(log, alice);
    await rail.append(CIRCLE, { kind: 'propose', subject: 'p1', payload: { action: 'changeRule', by: alice.ref } });
    await rail.append(CIRCLE, { kind: 'vote', subject: 'p1', payload: { voter: 'webid:bob', choice: 'yes' } });
    const { events } = await rail.readVerified(CIRCLE);
    expect(events.filter((e) => e.event === 'vote')).toHaveLength(0);   // authorRef ≠ claimed voter → dropped
  });

  it('CONCURRENT APPENDS CHAIN, NOT FORK — the append-order contract', async () => {
    // The CONTRACT this pins: two appends fired without awaiting between them still chain one line —
    // the second's parent IS the first's hash, and the fold sees no equivocation.
    //
    // Honest provenance (2026-08-20 review): the per-circle append queue landed claiming to fix a
    // "device forks against itself" bug observed live. Re-derivation showed that bug could NOT occur in
    // the prior code either — its one await sits BEFORE the log read, and read→sign→append is
    // synchronous, so each call completes atomically after resuming; this test passes against the
    // pre-queue code too. The "parent: null" probe that spawned the theory read `body.parent`, and the
    // field is `body.parentHash`. The queue STAYS because it makes the contract structural rather than
    // incidental: the moment any future edit introduces an await between the head read and the append
    // (an async signer step, an async log), the fork becomes real — and with the queue gone this test
    // is what goes red.
    const log = fakeEventLog();
    const alice = await member('webid:alice');
    const rail = railFor(log, alice);
    const [a, b] = await Promise.all([
      rail.append(CIRCLE, { kind: 'propose', subject: 'p1', payload: { action: 'changePolicy', subject: { theme: 'dark' }, by: alice.ref, at: 1 } }),
      rail.append(CIRCLE, { kind: 'vote',    subject: 'p1', payload: { voter: alice.ref, choice: 'yes', at: 2 } }),
    ]);
    // The second statement chains off the first — one author, one line, no shared parent.
    expect(a.statement.body.parentHash).toBe(null);
    expect(b.statement.body.parentHash).toBe(a.statement.body.hash);
    // And the verified read agrees: nobody is disputed.
    const { events, disputed } = await rail.readVerified(CIRCLE);
    expect(events).toHaveLength(2);
    expect(disputed.size).toBe(0);
  });

  it('CONCURRENT INGESTS NEVER OVERLAP-VERIFY — the sibling-vs-recursion pin', async () => {
    // The live bug this pins (2026-08-20): the roster binding verifier carries a per-circle re-entrancy
    // breaker (`inFlight`) for TRUE recursion — the roster projection reads the membership rail, which
    // verifies through the same gate. But an inFlight set cannot tell recursion from concurrent
    // SIBLINGS: two statements arriving in the same tick both reached the verifier, and the second was
    // refused "unverifiable key-ref binding" — a valid claim silently dropped on the receive side
    // (a task + its claim fanned back-to-back; the peer kept only one). The rail therefore serialises
    // ingest per circle, so sibling verifies never overlap and the breaker only trips on recursion.
    // This test's verifier REFUSES on overlap, exactly like the production breaker — remove the
    // serialisation and it goes red.
    const log = fakeEventLog();
    const alice = await member('webid:alice');
    const bob   = await member('webid:bob');
    let inFlight = false;
    const rail = railFor(log, alice, {
      verifyBinding: async ({ author, ref }) => {
        if (inFlight) return false;                       // the production breaker's shape
        inFlight = true;
        await new Promise((r) => setTimeout(r, 5));       // the roster read's async window
        inFlight = false;
        return author === bob.identity.pubKey && ref === bob.ref;
      },
    });
    const s1 = signSpine(bob.identity, { kind: 'propose', circleId: CIRCLE, subject: 'p1', payload: { action: 'changePolicy', subject: {}, by: bob.ref, at: 1, authorRef: bob.ref }, parent: null });
    const s2 = signSpine(bob.identity, { kind: 'vote', circleId: CIRCLE, subject: 'p1', payload: { voter: bob.ref, choice: 'yes', at: 2, authorRef: bob.ref }, parent: s1.body.hash });
    const [r1, r2] = await Promise.all([rail.ingest(CIRCLE, s1), rail.ingest(CIRCLE, s2)]);
    expect(r1.ok, r1.reason).toBe(true);
    expect(r2.ok, r2.reason).toBe(true);                  // pre-fix: 'unverifiable key-ref binding'
    expect((await rail.readVerified(CIRCLE)).events).toHaveLength(2);
  });

  it('EQUIVOCATION: two votes off one parent → the fork-proof marks the author disputed; the fold discounts them', async () => {
    const log = fakeEventLog();
    const alice = await member('webid:alice');
    const bob   = await member('webid:bob');
    const rail = railFor(log, alice, {
      verifyBinding: async ({ author, ref }) => (author === bob.identity.pubKey && ref === bob.ref),
    });
    await rail.append(CIRCLE, { kind: 'propose', subject: 'p1', payload: { action: 'removeMember', subject: 'webid:mel', by: alice.ref, at: 1 } });
    // bob signs TWO contradictory votes from the SAME parent (null — his first slot) and fans both halves.
    const v1 = signSpine(bob.identity, { kind: 'vote', circleId: CIRCLE, subject: 'p1', payload: { voter: bob.ref, choice: 'yes', at: 2, authorRef: bob.ref }, parent: null });
    const v2 = signSpine(bob.identity, { kind: 'vote', circleId: CIRCLE, subject: 'p1', payload: { voter: bob.ref, choice: 'no',  at: 3, authorRef: bob.ref }, parent: null });
    expect((await rail.ingest(CIRCLE, v1)).ok).toBe(true);
    expect((await rail.ingest(CIRCLE, v2)).ok).toBe(true);
    const { events, disputed } = await rail.readVerified(CIRCLE);
    expect(disputed.has(bob.ref)).toBe(true);                            // the self-verifying fork-proof
    const fold = foldGovernance(events, {
      policy: {}, members: [{ ref: alice.ref, role: 'admin' }, { ref: bob.ref, role: 'member' }], now: 4, disputed,
    });
    expect(fold.proposals[0].votes).toHaveLength(0);                     // the equivocator's votes discounted
  });

  it('ingest refuses: tampered signature · undeclared kind · missing authorRef · unverifiable binding', async () => {
    const log = fakeEventLog();
    const alice = await member('webid:alice');
    const bob   = await member('webid:bob');
    const rail = railFor(log, alice);   // NO verifyBinding → foreign statements cannot resolve
    const good = signSpine(bob.identity, { kind: 'vote', circleId: CIRCLE, subject: 'p1', payload: { voter: bob.ref, choice: 'yes', authorRef: bob.ref }, parent: null });
    expect((await rail.ingest(CIRCLE, { ...good, sig: 'tampered' })).ok).toBe(false);
    const badKind = signSpine(bob.identity, { kind: 'sneaky', circleId: CIRCLE, subject: 'p1', payload: { authorRef: bob.ref }, parent: null });
    expect((await rail.ingest(CIRCLE, badKind)).ok).toBe(false);
    const noRef = signSpine(bob.identity, { kind: 'vote', circleId: CIRCLE, subject: 'p1', payload: { voter: bob.ref, choice: 'yes' }, parent: null });
    expect((await rail.ingest(CIRCLE, noRef)).ok).toBe(false);
    expect((await rail.ingest(CIRCLE, good)).ok).toBe(false);            // no resolver → binding unverifiable
    expect(log.entries).toHaveLength(0);                                 // nothing landed
  });

  it('ingest is idempotent by the stable id (redelivery lands once)', async () => {
    const log = fakeEventLog();
    const alice = await member('webid:alice');
    const bob   = await member('webid:bob');
    const rail = railFor(log, alice, { verifyBinding: async () => true });
    const stmt = signSpine(bob.identity, { kind: 'vote', circleId: CIRCLE, subject: 'p1', payload: { voter: bob.ref, choice: 'yes', authorRef: bob.ref }, parent: null });
    await rail.ingest(CIRCLE, stmt);
    await rail.ingest(CIRCLE, stmt);
    expect(log.entries).toHaveLength(1);
  });
});

// ── TOMBSTONES (L121) — the fold names dead member-props; the rail keeps the chain edge and sheds the bytes ──
describe('the rail — compact (tombstones on the fold\'s word)', () => {
  function fakeEventLogWithCompact() {
    const log = fakeEventLog();
    log.compactEntries = (ids, transform) => {
      const set = new Set(ids); let n = 0;
      for (let i = 0; i < log.entries.length; i += 1) {
        const e = log.entries[i]; if (!set.has(e.id)) continue;
        const next = transform(e); if (!next || next.id !== e.id) continue;
        log.entries[i] = next; n += 1;
      }
      return n;
    };
    return log;
  }
  const MKINDS = ['join', 'member-props'];
  const mrail = (log, me) => makeCircleEntryRail({ eventLog: log, signerFor: async () => ({ identity: me.identity, ref: me.ref }), entryKind: 'membership', declaredKinds: MKINDS, compactableKinds: ['member-props'] });

  it('a tombstoned statement keeps its chain fields and its place, loses its content, and is never resurrected', async () => {
    const log = fakeEventLogWithCompact();
    const bob = await member('webid:bob');
    const rail = mrail(log, bob);
    await rail.append(CIRCLE, { kind: 'join', subject: bob.ref, payload: { peerDisplay: 'bob' } });
    await rail.append(CIRCLE, { kind: 'member-props', subject: bob.ref, payload: { displayName: 'B1', personaProperties: { profilePicture: { enc: { thumb: 'X'.repeat(3000) } } } } });
    await rail.append(CIRCLE, { kind: 'member-props', subject: bob.ref, payload: { displayName: 'B2' } });
    const p1entry = log.entries.find((e) => e.payload?.body?.payload?.displayName === 'B1');
    const h1 = p1entry.payload.body.hash;
    const original = JSON.parse(JSON.stringify(p1entry.payload));

    expect(rail.compact(CIRCLE, [h1, 'not-a-hash'])).toBe(1);
    const t = log.entries.find((e) => e.id === `membership:${h1}`);
    expect(t.payload.tombstone).toBe(true);
    expect(t.payload.sig).toBeUndefined();
    expect(JSON.stringify(t.payload)).not.toContain('XXXX');                   // the bytes are gone
    expect(t.payload.body).toMatchObject({ hash: original.body.hash, author: original.body.author, parentHash: original.body.parentHash, kind: 'member-props' });

    // the verified read still yields the edge (as a payload-less body) and the live statement after it
    const { bodies } = await rail.readVerifiedBodies(CIRCLE);
    const tb = bodies.find((b) => b.hash === h1);
    expect(tb.tombstone).toBe(true);
    expect(Object.keys(tb.payload)).toEqual(['authorRef']);
    const live = bodies.find((b) => b.payload?.displayName === 'B2');
    expect(live).toBeTruthy();
    expect(live.parentHash, 'the live statement still chains on the tombstone').toBe(h1);

    // a redelivery of the ORIGINAL does not bring the bytes back (first-write-wins by id)
    const r = await rail.ingest(CIRCLE, original);
    expect(r.ok).toBe(true);
    expect(log.entries.find((e) => e.id === `membership:${h1}`).payload.tombstone).toBe(true);
    // compacting it again is a no-op; the governance-shaped read skips it
    expect(rail.compact(CIRCLE, [h1])).toBe(0);
    expect((await rail.readVerified(CIRCLE)).events.some((e) => e.hash === h1)).toBe(false);
  });
});

describe('verify-on-read verifies each distinct signed statement once per rail; what binds is re-decided every read', () => {
  it('reading the same lane N times checks each statement\'s signature ONCE', async () => {
    const { vi } = await import('vitest');
    const log = fakeEventLog();
    const alice = await member('webid:alice');
    const rail = railFor(log, alice);
    await rail.append(CIRCLE, { kind: 'propose', subject: 'p1', payload: { action: 'changeRule', by: alice.ref } });
    await rail.append(CIRCLE, { kind: 'vote', subject: 'p1', payload: { voter: alice.ref, choice: 'yes' } });
    const spy = vi.spyOn(AgentIdentity, 'verify');
    try {
      for (let i = 0; i < 5; i++) {
        expect((await rail.readVerified(CIRCLE)).events).toHaveLength(2);
        await rail.readVerifiedBodies(CIRCLE);
      }
      expect(spy.mock.calls.length, 'two statements, ten reads: two signature checks at most').toBeLessThanOrEqual(2);
    } finally { spy.mockRestore(); }
  });

  it('a stored statement tampered AFTER it was memoised is refused on the next read (the memo is keyed by content)', async () => {
    const log = fakeEventLog();
    const alice = await member('webid:alice');
    const rail = railFor(log, alice);
    await rail.append(CIRCLE, { kind: 'propose', subject: 'p1', payload: { action: 'changeRule', by: alice.ref } });
    expect((await rail.readVerified(CIRCLE)).events).toHaveLength(1);   // verified, and memoised
    // flip one character of the stored signature: the chain hash still recomputes, only the signature can catch it
    const stored = log.entries.find((e) => e?.payload?.sig);   // the stored entry's payload IS the statement
    const sig = stored.payload.sig;
    stored.payload = { ...stored.payload, sig: (sig[0] === 'A' ? 'B' : 'A') + sig.slice(1) };
    expect((await rail.readVerified(CIRCLE)).events, 'the tampered statement verifies afresh and is refused').toHaveLength(0);
  });
});

describe('one verdict memo for the process: two rails over one log check each statement once', () => {
  it('the agent\'s rail and a shell\'s rail over the same log: N checks, not 2N', async () => {
    const log = fakeEventLog();
    const alice = await member('webid:alice-memo');
    const writer = railFor(log, alice);
    const N = 5;
    for (let i = 0; i < N; i++) await writer.append(CIRCLE, { kind: 'propose', subject: `memo-${i}`, payload: { action: 'changePolicy', subject: { n: i }, by: alice.ref, at: i } });
    const spy = vi.spyOn(AgentIdentity, 'verify');
    try {
      await railFor(log, alice).readVerified(CIRCLE);
      await railFor(log, alice).readVerified(CIRCLE);
      expect(spy.mock.calls.length, 'the second rail checked the same statements again').toBeLessThanOrEqual(N);
    } finally { spy.mockRestore(); }
  });
});

describe('a narrowed read checks only what it keeps (verify-once step B)', () => {
  it('kinds: [vote] on a lane of N proposals and one vote does one signature check', async () => {
    const log = fakeEventLog();
    const alice = await member('webid:alice-narrow');
    const writer = railFor(log, alice);
    for (let i = 0; i < 4; i++) await writer.append(CIRCLE, { kind: 'propose', subject: `n-${i}`, payload: { action: 'changePolicy', subject: { n: i }, by: alice.ref, at: i } });
    await writer.append(CIRCLE, { kind: 'vote', subject: 'n-0', payload: { voter: alice.ref, choice: 'yes', at: 9 } });
    let checks = 0;
    const memo = createSignatureMemo({ verify: (m, s, k) => { checks += 1; return AgentIdentity.verify(m, s, k); } });
    const { bodies } = await railFor(log, alice, { signatureMemo: memo }).readVerifiedBodies(CIRCLE, { kinds: ['vote'] });
    expect(bodies.map((b) => b.kind)).toEqual(['vote']);
    expect(checks, 'the narrowed read checked statements it then dropped').toBe(1);
  });

  it('a statement whose kind was changed to be kept fails its check and is not kept', async () => {
    const log = fakeEventLog();
    const alice = await member('webid:alice-tamper');
    await railFor(log, alice).append(CIRCLE, { kind: 'propose', subject: 't-0', payload: { action: 'changePolicy', subject: {}, by: alice.ref, at: 1 } });
    log.entries[0].payload = { ...log.entries[0].payload, body: { ...log.entries[0].payload.body, kind: 'vote' } };
    const { bodies } = await railFor(log, alice).readVerifiedBodies(CIRCLE, { kinds: ['vote'] });
    expect(bodies).toEqual([]);
  });
});
