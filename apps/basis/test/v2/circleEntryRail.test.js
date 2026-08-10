import { describe, it, expect } from 'vitest';
import { AgentIdentity, signSpine } from '@onderling/core';
import { VaultMemory } from '@onderling/vault';
import { makeCircleEntryRail } from '../../src/v2/circleEntryRail.js';
import { foldGovernance } from '../../src/v2/governanceLog.js';

// The rail core (slice 1 step 1): signed circle-scoped governance entries on the device log, verified read,
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
    expect(fold.proposals[0].votes).toEqual([{ voter: alice.ref, choice: 'yes', at: 2 }]);
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
