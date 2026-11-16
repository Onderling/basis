/**
 * A FULL STATEMENT REPLACES ITS OWN TOMBSTONE. A tombstone keeps a statement's signed header and drops its payload, and
 * it proves itself, so anyone holding a compactable statement can strip it and pass it on. On the device log a membership
 * entry is written once (the first write wins), so a tombstone that landed first used to make the full statement, arriving
 * later with the same hash, a silent "duplicate": the member's properties gone for good on that device (Fable's review of
 * the format). Now the full one takes the tombstone's place, and a tombstone never replaces a full one.
 */
import { describe, it, expect } from 'vitest';
import { AgentIdentity } from '@onderling/core';
import { VaultMemory } from '@onderling/vault';
import { makeCircleEntryRail } from '../../src/v2/circleEntryRail.js';
import { EventLog } from '../../src/eventLog.js';

const CIRCLE = 'circle:props';
const railOn = (eventLog, me) => makeCircleEntryRail({
  eventLog, entryKind: 'membership', declaredKinds: ['member-props'], compactableKinds: ['member-props'],
  signerFor: async () => ({ identity: me.identity, ref: me.ref }),
  verifyBinding: async () => true,
});
const strip = (stmt) => {
  const { payload, ...head } = stmt.body;
  return { tombstone: true, body: { ...head, payload: { authorRef: head.authorRef } }, sig: stmt.sig };
};
const held = (log, hash) => log.query({}).find((e) => e.id === `membership:${hash}`)?.payload ?? null;

describe('a full statement and its tombstone on the device log', () => {
  it('the tombstone first, then the full one: the device holds and folds the FULL one', async () => {
    const anne = { ref: 'webid:anne', identity: await AgentIdentity.generate(new VaultMemory()) };
    const { statement } = await railOn(new EventLog({ initial: [], muted: [] }), anne)
      .append(CIRCLE, { kind: 'member-props', subject: anne.ref, payload: { handle: 'Anne', picture: 'p1' } });
    const log = new EventLog({ initial: [], muted: [] });
    const rail = railOn(log, { ref: 'webid:bram', identity: await AgentIdentity.generate(new VaultMemory()) });
    expect((await rail.ingest(CIRCLE, strip(statement))).ok, 'a tombstone proves itself').toBe(true);
    expect(held(log, statement.body.hash)?.tombstone).toBe(true);
    const r = await rail.ingest(CIRCLE, statement);
    expect(r.ok).toBe(true);
    expect(r.existed, 'the full one is new here, not a duplicate').toBe(false);
    const now = held(log, statement.body.hash);
    expect(now?.tombstone ?? false).toBe(false);
    expect(now?.body?.payload).toMatchObject({ handle: 'Anne', picture: 'p1' });
  });

  it('the full one first, then its tombstone: the full one stays', async () => {
    const anne = { ref: 'webid:anne', identity: await AgentIdentity.generate(new VaultMemory()) };
    const { statement } = await railOn(new EventLog({ initial: [], muted: [] }), anne)
      .append(CIRCLE, { kind: 'member-props', subject: anne.ref, payload: { handle: 'Anne' } });
    const log = new EventLog({ initial: [], muted: [] });
    const rail = railOn(log, { ref: 'webid:bram', identity: await AgentIdentity.generate(new VaultMemory()) });
    await rail.ingest(CIRCLE, statement);
    await rail.ingest(CIRCLE, strip(statement));
    expect(held(log, statement.body.hash)?.body?.payload).toMatchObject({ handle: 'Anne' });
  });
});
