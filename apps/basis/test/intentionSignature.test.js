/**
 * A row in a circle's store carries its AUTHOR'S signature over its canonical fields `{id, actsAs, op, args, trigger}`,
 * made with the author's circle key; a host runs it as `actsAs` only when the signature verifies, the roster binds that
 * key to the author, and the author is the one it acts as (or, for the household's own rows, the host itself).
 */
import { describe, it, expect } from 'vitest';
import { AgentIdentity } from '@onderling/core';
import { VaultMemory } from '@onderling/vault';
import { signIntention, verifyIntention } from '../src/v2/intentionSignature.js';

const row = (o = {}) => ({ id: 'r1', type: 'intention', trigger: { every: 'week', on: 'sun', at: '18:00' }, op: 'sendWeekOverview', appOrigin: 'assistant', args: {}, actsAs: 'person-a', state: 'open', ...o });

async function world() {
  const keyA = await AgentIdentity.generate(new VaultMemory());
  const keyB = await AgentIdentity.generate(new VaultMemory());
  // the roster: A's circle key belongs to person-a, B's to person-b
  const bound = new Map([[keyA.pubKey, 'person-a'], [keyB.pubKey, 'person-b']]);
  const bindingOk = async ({ author, ref }) => bound.get(author) === ref;
  return { keyA, keyB, bindingOk };
}

describe('the author\'s signature on a circle row', () => {
  it('signed by its author, acting as its author: runs', async () => {
    const w = await world();
    const signed = signIntention(row(), { identity: w.keyA, ref: 'person-a' });
    expect(signed.authorSig).toMatchObject({ key: w.keyA.pubKey, ref: 'person-a' });
    expect(await verifyIntention(signed, { circleId: 'c1', bindingOk: w.bindingOk })).toBe(true);
  });

  it('unsigned, or changed after signing (its op, its args, whom it acts as), is refused', async () => {
    const w = await world();
    const signed = signIntention(row(), { identity: w.keyA, ref: 'person-a' });
    expect(await verifyIntention(row(), { circleId: 'c1', bindingOk: w.bindingOk })).toBe('unsigned');
    expect(await verifyIntention({ ...signed, args: { to: 'everyone' } }, { circleId: 'c1', bindingOk: w.bindingOk })).toBe('signature');
    expect(await verifyIntention({ ...signed, op: 'assistant-role' }, { circleId: 'c1', bindingOk: w.bindingOk })).toBe('signature');
    expect(await verifyIntention({ ...signed, actsAs: 'person-admin' }, { circleId: 'c1', bindingOk: w.bindingOk })).toBe('signature');
    // the app it is handed to: the runner dispatches on it, so it is signed too
    expect(await verifyIntention({ ...signed, appOrigin: 'household' }, { circleId: 'c1', bindingOk: w.bindingOk })).toBe('signature');
  });

  it('a member signing a row that acts as someone else is refused, however well signed', async () => {
    const w = await world();
    const signed = signIntention(row({ actsAs: 'person-admin' }), { identity: w.keyB, ref: 'person-b' });
    expect(await verifyIntention(signed, { circleId: 'c1', bindingOk: w.bindingOk })).toBe('acts-as-another');
  });

  it('a key the roster does not bind to the ref it names is refused', async () => {
    const w = await world();
    const signed = signIntention(row({ actsAs: 'person-b' }), { identity: w.keyA, ref: 'person-b' });   // A claims to be B
    expect(await verifyIntention(signed, { circleId: 'c1', bindingOk: w.bindingOk })).toBe('not-a-member-key');
  });

  it('a household row runs only when the host signed it itself', async () => {
    const w = await world();
    const allow = (actsAs, ref) => actsAs === ref || (actsAs === 'household' && ref === 'person-a');   // person-a is the host here
    const byHost = signIntention(row({ actsAs: 'household', op: 'announceChange' }), { identity: w.keyA, ref: 'person-a' });
    expect(await verifyIntention(byHost, { circleId: 'c1', bindingOk: w.bindingOk, actsAsAllowed: allow })).toBe(true);
    const byMember = signIntention(row({ actsAs: 'household', op: 'announceChange' }), { identity: w.keyB, ref: 'person-b' });
    expect(await verifyIntention(byMember, { circleId: 'c1', bindingOk: w.bindingOk, actsAsAllowed: allow })).toBe('acts-as-another');
  });
});

describe('the box\'s rule for a circle row', async () => {
  const { createCircleRowGate } = await import('../src/v2/circleRowGate.js');
  const { createIntentionBook } = await import('../src/v2/intentionBook.js');
  const { createIntentionRunner } = await import('../src/v2/intentionRunner.js');
  const { createOwnDevicesStore } = await import('../src/v2/ownDevicesStore.js');
  const { EventLog } = await import('../src/eventLog.js');
  const { memoryDataSource, createCircleStores } = await import('@onderling/item-store');
  const { validate } = await import('@onderling/item-types');

  async function box() {
    const hostKey = await AgentIdentity.generate(new VaultMemory());
    const annaKey = await AgentIdentity.generate(new VaultMemory());
    const beaKey = await AgentIdentity.generate(new VaultMemory());
    const roster = new Map([[annaKey.pubKey, 'anna-person'], [beaKey.pubKey, 'bea-person']]);
    const home = createCircleStores({ dataSource: memoryDataSource(), registry: { validate } }).getStore('c-home');
    const gate = createCircleRowGate({
      hostRef: 'host-person', circleKeyFor: async () => hostKey,
      rosterBinding: async ({ author, ref }) => roster.get(author) === ref,
      // the household's people: Anna linked her Basis key to her Telegram row; Bea did not
      people: async () => [{ id: 'telegram:1', pubKey: 'anna-person' }, { id: 'telegram:2' }],
    });
    const SUN = Date.parse('2026-10-11T17:30:00Z');
    const book = createIntentionBook({ store: createOwnDevicesStore({ dataSource: memoryDataSource() }), circles: async () => [{ scope: 'c-home', store: home }], actor: 'host', now: () => SUN });
    const calls = []; const fired = [];
    const runner = createIntentionRunner({
      book, log: new EventLog({ initial: [], muted: [] }), tz: 'Europe/Amsterdam', now: () => SUN, claimAs: 'host',
      mayRun: (o, scope, row) => gate.mayRun(o, scope, row),
      run: async (o) => { calls.push({ op: o.op, as: await gate.callerFor(o.actsAs) }); return { ok: true }; },
      onFired: (e) => fired.push(e),
    });
    // a member's app writes its row into the circle's store, signed by its circle key
    const write = async (key, ref, over) => home.put(signIntention({ id: `r-${Math.random().toString(36).slice(2)}`, type: 'intention', trigger: { every: 'week', on: 'sun', at: '18:00' }, op: 'sendWeekOverview', appOrigin: 'assistant', args: {}, actsAs: ref, state: 'open', createdAt: '2026-10-05T10:00:00.000Z', ...over }, { identity: key, ref }), { by: ref });
    return { annaKey, beaKey, home, runner, calls, fired, write };
  }

  it('Anna\'s own signed row runs as her (her linked Telegram row); Bea\'s runs nowhere (the box does not act for her)', async () => {
    const w = await box();
    await w.write(w.annaKey, 'anna-person');
    await w.write(w.beaKey, 'bea-person');
    await w.runner.pass();
    expect(w.calls).toEqual([{ op: 'sendWeekOverview', as: 'telegram:1' }]);
    expect(w.fired.filter((e) => e.outcome === 'refused').map((e) => e.reason)).toEqual(['not a person this host acts for']);
  });

  it('a row Bea writes acting as Anna, an unsigned one, and one changed after signing: none runs', async () => {
    const w = await box();
    await w.write(w.beaKey, 'bea-person', { actsAs: 'anna-person' });
    await w.home.put({ id: 'r-unsigned', type: 'intention', trigger: { every: 'week', on: 'sun', at: '18:00' }, op: 'sendWeekOverview', args: {}, actsAs: 'anna-person', state: 'open', createdAt: '2026-10-05T10:00:00.000Z' }, { by: 'x' });
    const ok = await w.write(w.annaKey, 'anna-person');
    await w.home.put({ ...ok, op: 'assistant-role', args: { who: 'bea', role: 'admin' } }, { by: 'x' });   // tampered after signing
    await w.runner.pass();
    expect(w.calls).toEqual([]);
    expect(w.fired.map((e) => e.reason).sort()).toEqual(['acts-as-another', 'signature', 'unsigned'].sort());
  });
});

describe('rows signed before the current version', async () => {
  const { createIntentionBook } = await import('../src/v2/intentionBook.js');
  const { createOwnDevicesStore } = await import('../src/v2/ownDevicesStore.js');
  const { memoryDataSource, createCircleStores } = await import('@onderling/item-store');
  const { validate } = await import('@onderling/item-types');
  const { INTENTION_SIG_VERSION } = await import('../src/v2/intentionSignature.js');

  it('are refused, and the host re-signs its own (as the boot does for the household\'s announce rows)', async () => {
    const key = await AgentIdentity.generate(new VaultMemory());
    const home = createCircleStores({ dataSource: memoryDataSource(), registry: { validate } }).getStore('c-home');
    const book = createIntentionBook({ store: createOwnDevicesStore({ dataSource: memoryDataSource() }), circles: async () => [{ scope: 'c-home', store: home }], actor: 'host', signerFor: async () => ({ identity: key, ref: 'host-person' }) });
    await book.load();
    const made = await book.intend({ trigger: { every: 'day', at: '08:00' }, op: 'announceChange', appOrigin: 'assistant', args: {}, actsAs: 'host-person', scope: 'c-home' });
    // as a v1 row was: no version, a signature over fields that did not include the app
    const old = await home.put({ ...made, authorSig: { key: key.pubKey, ref: 'host-person', sig: made.authorSig.sig } }, { by: 'host' });
    const bindingOk = async () => true;
    expect(await verifyIntention(old, { circleId: 'c-home', bindingOk })).toBe('signature');
    await book.load();
    const resigned = await book.sign(old.id);
    expect(resigned.authorSig.v).toBe(INTENTION_SIG_VERSION);
    expect(await verifyIntention(resigned, { circleId: 'c-home', bindingOk })).toBe(true);
  });
});
