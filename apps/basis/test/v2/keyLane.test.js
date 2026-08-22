/**
 * THE KEY LANE — the recorded spine route for group-key events, unit-gated:
 *
 *   authority — establish binds only to an ADMIN at version 1; a plain member's rotation is
 *               refused; a circle whose rotateKey decision-class is stricter than the ratified
 *               any-admin default refuses a bare rotation (fail closed until rotations carry
 *               their resolving governance decision);
 *   dispute   — two rotations off ONE parent by one author are a self-verifying fork-proof; the
 *               projection DISCOUNTS the disputed author (the L3 rule as built for governance),
 *               so the chain stays at the last undisputed head and a contested version is never
 *               anyone's current key;
 *   projection — the key-event store mirrors the lane WHOLESALE (replace, not patch), so a
 *               version a later fork-proof discounts disappears from the store too.
 */
import { describe, it, expect } from 'vitest';
import { AgentIdentity, signSpine } from '@onderling/core';
import { VaultMemory } from '@onderling/vault';
import { EventLog } from '../../src/eventLog.js';
import {
  makeKeyRail, makeKeyEmitter, keyBindingVerifier, keyEventsFromRail, projectKeyEventsIntoStore,
  KEY_RAIL_KINDS,
} from '../../src/v2/keyRail.js';
import { createKeyEventStore } from '../../src/v2/keyEventStore.js';
import { KEY_EVENT_KIND } from '@onderling/pod-client';

const CIRCLE = 'key-lane-circle';
const evt = (version, extra = {}) => ({ kind: KEY_EVENT_KIND, version, sealed: `sealed-v${version}`, members: 2, recipients: ['r1', 'r2'], groupId: CIRCLE, ...extra });

/** A stub roster read: rows shaped like the spineless projection. */
const rosterSkill = (rows) => async (app, op, args) => {
  if (app === 'stoop' && op === 'listGroupMembers' && args?.spineless === true) return { members: rows };
  throw new Error(`unexpected callSkill ${app}.${op}`);
};

describe('keyBindingVerifier — the L4 authority rule, receiver-enforced', () => {
  const admin = { webid: 'ref-admin', role: 'admin', circleAddress: 'key-admin', circleAddresses: ['key-admin'] };
  const member = { webid: 'ref-member', role: 'member', circleAddress: 'key-member', circleAddresses: ['key-member'] };

  it('an admin establishes (v1) and rotates; a member does neither; a stranger binds nothing', async () => {
    const verify = keyBindingVerifier(rosterSkill([admin, member]));
    expect(await verify({ author: 'key-admin', ref: 'ref-admin', circleId: CIRCLE, kind: 'key-establish', payload: { event: evt(1) } })).toBe(true);
    expect(await verify({ author: 'key-admin', ref: 'ref-admin', circleId: CIRCLE, kind: 'key-rotate', payload: { event: evt(2) } })).toBe(true);
    expect(await verify({ author: 'key-member', ref: 'ref-member', circleId: CIRCLE, kind: 'key-establish', payload: { event: evt(1) } })).toBe(false);
    expect(await verify({ author: 'key-member', ref: 'ref-member', circleId: CIRCLE, kind: 'key-rotate', payload: { event: evt(2) } })).toBe(false);
    expect(await verify({ author: 'key-stranger', ref: 'ref-stranger', circleId: CIRCLE, kind: 'key-rotate', payload: { event: evt(2) } })).toBe(false);
  });

  it('a member impersonating the admin ref fails the address binding before authority is even asked', async () => {
    const verify = keyBindingVerifier(rosterSkill([admin, member]));
    expect(await verify({ author: 'key-member', ref: 'ref-admin', circleId: CIRCLE, kind: 'key-rotate', payload: { event: evt(2) } })).toBe(false);
  });

  it('an establish that is not version 1 is refused (an establish IS v1, by definition)', async () => {
    const verify = keyBindingVerifier(rosterSkill([admin]));
    expect(await verify({ author: 'key-admin', ref: 'ref-admin', circleId: CIRCLE, kind: 'key-establish', payload: { event: evt(3) } })).toBe(false);
  });

  it('a STRICTER rotateKey class refuses a bare rotation — fail closed until the resolve linkage lands', async () => {
    const verify = keyBindingVerifier(rosterSkill([admin]), { rotateClassFor: () => 'admin-quorum' });
    expect(await verify({ author: 'key-admin', ref: 'ref-admin', circleId: CIRCLE, kind: 'key-rotate', payload: { event: evt(2) } })).toBe(false);
    // …but the establish (v1, at sealing time) is not a governed ROTATION and still binds.
    expect(await verify({ author: 'key-admin', ref: 'ref-admin', circleId: CIRCLE, kind: 'key-establish', payload: { event: evt(1) } })).toBe(true);
  });
});

describe('the lane + projection — emit, fold, and the fork-proof discount', () => {
  async function railFor(identity, { log = null, verifyBinding = null } = {}) {
    return makeKeyRail({
      eventLog: log ?? new EventLog({ initial: [], muted: [] }),
      circleIdentityFor: async () => identity,
      myRef: 'ref-admin',
      callSkill: rosterSkill([]),
      ...(verifyBinding ? { verifyBinding } : {}),
    });
  }

  it('emitted establish + rotation project back as the key-event chain, and the store mirrors it', async () => {
    const identity = await AgentIdentity.generate(new VaultMemory());
    const rail = await railFor(identity);
    const emit = makeKeyEmitter({ rail });
    expect((await emit(CIRCLE, evt(1)))?.body?.kind).toBe('key-establish');
    expect((await emit(CIRCLE, evt(2)))?.body?.kind).toBe('key-rotate');
    const events = await keyEventsFromRail(rail, CIRCLE);
    expect(events.map((e) => e.version).sort()).toEqual([1, 2]);
    const store = createKeyEventStore();
    await projectKeyEventsIntoStore({ rail, store, circleId: CIRCLE });
    expect(store.list(CIRCLE).map((e) => e.version).sort()).toEqual([1, 2]);
  });

  it('KEY-SPLITTING: two rotations off one parent are a fork-proof — the author is discounted and the contested version never lands', async () => {
    const identity = await AgentIdentity.generate(new VaultMemory());
    // The honest device: establish v1, then ONE rotation — this is the parent both forks share.
    const rail = await railFor(identity, { verifyBinding: async () => true });
    const emit = makeKeyEmitter({ rail });
    await emit(CIRCLE, evt(1));
    const v1Hash = rail.storedStatements(CIRCLE)[0].body.hash;
    // The equivocation: the same author signs TWO different v2 rotations off the SAME parent —
    // the "different current key for different members" split the spine exists to catch.
    const forkA = signSpine(identity, { kind: 'key-rotate', circleId: CIRCLE, subject: 'v2', payload: { event: evt(2, { sealed: 'sealed-v2-for-alice' }), authorRef: 'ref-admin' }, parent: v1Hash, deps: [] });
    const forkB = signSpine(identity, { kind: 'key-rotate', circleId: CIRCLE, subject: 'v2', payload: { event: evt(2, { sealed: 'sealed-v2-for-bob' }), authorRef: 'ref-admin' }, parent: v1Hash, deps: [] });
    // A receiver that holds BOTH halves mints the proof. (Own-author statements self-bind; the
    // receiving rail here is a different device's, so the injected binding admits them — the
    // point under test is the FORK, not the binding.)
    const receiver = await railFor(identity, { verifyBinding: async () => true });
    expect((await receiver.ingest(CIRCLE, rail.storedStatements(CIRCLE)[0]))?.ok).toBe(true);
    expect((await receiver.ingest(CIRCLE, forkA))?.ok).toBe(true);
    expect((await receiver.ingest(CIRCLE, forkB))?.ok).toBe(true);
    // PREFIX-PRESERVING discount: both v2 halves are contested and neither lands — but the v1
    // establish below the fork is signed into BOTH halves by the forker themselves (the agreed
    // prefix), so the chain stays at the LAST UNDISPUTED HEAD and the circle keeps opening v1.
    const events = await keyEventsFromRail(receiver, CIRCLE);
    expect(events.map((e) => e.version), 'the contested v2 never lands; the honest v1 head survives').toEqual([1]);
    // The store mirrors the discount: a previously-recorded contested version is TAKEN BACK.
    const store = createKeyEventStore();
    store.record(CIRCLE, evt(2, { sealed: 'sealed-v2-for-alice' }));   // it had landed before the second half arrived
    await projectKeyEventsIntoStore({ rail: receiver, store, circleId: CIRCLE });
    expect(store.list(CIRCLE).map((e) => e.version), 'replace-not-patch: contested v2 gone, honest v1 stands').toEqual([1]);
  });

  it('a disputed author\'s statement with MISSING local ancestry drops conservatively (unknown position on a forked chain)', async () => {
    const identity = await AgentIdentity.generate(new VaultMemory());
    const rail = await railFor(identity, { verifyBinding: async () => true });
    const emit = makeKeyEmitter({ rail });
    await emit(CIRCLE, evt(1));
    const v1Hash = rail.storedStatements(CIRCLE)[0].body.hash;
    const forkA = signSpine(identity, { kind: 'key-rotate', circleId: CIRCLE, subject: 'v2', payload: { event: evt(2, { sealed: 'a' }), authorRef: 'ref-admin' }, parent: v1Hash, deps: [] });
    const forkB = signSpine(identity, { kind: 'key-rotate', circleId: CIRCLE, subject: 'v2', payload: { event: evt(2, { sealed: 'b' }), authorRef: 'ref-admin' }, parent: v1Hash, deps: [] });
    // An orphan whose parent is UNKNOWN here (some statement this device never received).
    const orphan = signSpine(identity, { kind: 'key-rotate', circleId: CIRCLE, subject: 'v3', payload: { event: evt(3), authorRef: 'ref-admin' }, parent: 'unknown-parent-hash', deps: [] });
    const receiver = await railFor(identity, { verifyBinding: async () => true });
    for (const s of [rail.storedStatements(CIRCLE)[0], forkA, forkB, orphan]) {
      expect((await receiver.ingest(CIRCLE, s))?.ok).toBe(true);
    }
    const events = await keyEventsFromRail(receiver, CIRCLE);
    expect(events.map((e) => e.version), 'the unplaceable v3 drops with the contested v2s; v1 stands').toEqual([1]);
  });

  it('the declared-kinds gate: the lane refuses an undeclared kind at append', async () => {
    const identity = await AgentIdentity.generate(new VaultMemory());
    const rail = await railFor(identity);
    await expect(rail.append(CIRCLE, { kind: 'key-wish', subject: 'v9', payload: {} })).rejects.toThrow(/not declared/);
    expect(KEY_RAIL_KINDS).toEqual(['key-establish', 'key-rotate']);
  });
});
