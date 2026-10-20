/**
 * AN APPOINTMENT SHARED WITH A CONTACT travels as an ITEM in the pair circle (the contact's two-member circle), carried
 * by its lane — never a file, never a reference the contact cannot open. Anne shares one of her OWN appointments with
 * Bob: a copy (title, when, length — nothing else) lands in their pair circle and shows on Bob's agenda; moving it on
 * Anne's side re-shares the same copy; cancelling it re-shares the cancel.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { VaultMemory } from '@onderling/vault';
import { createMemoryBackend } from '@onderling/pseudo-pod';
import { startJourneyRelay } from './support/testRelay.js';
import { bootRealAgentNode, connectNodesOverRelay, until, teardown } from './support/pairRealAgents.js';
import { pairCircleIdFor } from '../src/v2/pairRoster.js';
import { EventLog } from '../src/eventLog.js';
import { materializeScreen } from '../src/v2/userScreenBlocks.js';
import { plusEditFor, plusShareTargets, plusShareOp } from '../src/v2/vandaagPlus.js';

const bootPerson = (label) => bootRealAgentNode(label, { contactChannel: true, pairRoster: true, agentOpts: { ownerRootVault: new VaultMemory(), chatVault: new VaultMemory(), registryBackend: createMemoryBackend(), deviceLog: new EventLog({ initial: [], muted: [] }) } });
const pairEventsOn = async (node, pair) => {
  const r = await node.agent.callSkill('calendar', 'listEvents', { circleId: pair, days: 30 });
  return r?.items ?? r?.events ?? [];
};

describe('an own appointment shared with a contact', () => {
  let relay; let anne; let bob; let pair;

  beforeAll(async () => {
    relay = await startJourneyRelay();
    [anne, bob] = await Promise.all([bootPerson('anne'), bootPerson('bob')]);
    await connectNodesOverRelay([anne, bob], { relayUrl: relay.url });
    await anne.agent.callSkill('pinboard', 'addContact', { webid: bob.pubKey, pubKey: bob.pubKey, displayName: 'Bob' });
    await bob.agent.callSkill('pinboard', 'addContact', { webid: anne.pubKey, pubKey: anne.pubKey, displayName: 'Anne' });
    await anne.contactThreadChannel.sendTurn({ peerAddr: bob.pubKey, threadId: bob.pubKey, text: 'hoi Bob', messageId: 'a-1' }).sent;
    await bob.contactThreadChannel.sendTurn({ peerAddr: anne.pubKey, threadId: anne.pubKey, text: 'hoi Anne', messageId: 'b-1' }).sent;
    pair = pairCircleIdFor(anne.pubKey, bob.pubKey);
    const formed = async (n) => (((await n.agent.callSkill('pinboard', 'listMyCircles', {}))?.circles ?? []).map((c) => (typeof c === 'string' ? c : c?.groupId)).includes(pair) ? true : null);
    expect(await until(() => formed(anne), { timeout: 30_000, step: 300 }), 'the pair circle on Anne').toBe(true);
    expect(await until(() => formed(bob), { timeout: 30_000, step: 300 }), 'the pair circle on Bob').toBe(true);
  }, 150_000);

  afterAll(async () => { await teardown(anne, bob); await relay?.close?.(); });

  it('the copy lands on Bob\'s agenda — title, when, length only — and follows a move and a cancel', async () => {
    const when = new Date(Date.now() + 2 * 86_400_000); when.setHours(15, 0, 0, 0);
    const made = await anne.agent.callSkill('calendar', 'addEvent', { title: 'Koffie bij Anne', when: when.toISOString(), duration: '1h', attendees: ['someone-else'] });
    expect(made?.ok, JSON.stringify(made)).toBe(true);
    // shared the way the own sheet shares it ("Delen met…"): Bob is among the contacts it offers, and the pick is the op
    const act = plusEditFor({ id: made.itemId, own: true, fields: { title: 'Koffie bij Anne' } }, 'calendar-event').act;
    const offered = await plusShareTargets(act, (app, op, args) => anne.agent.callSkill(app, op, args));
    expect(offered.map((c) => c.id), JSON.stringify(offered)).toContain(bob.pubKey);
    const op = plusShareOp(act.id, { id: made.itemId, with: bob.pubKey });
    const shared = await anne.agent.callSkill(op.app, op.opId, op.args);
    expect(shared?.ok, JSON.stringify(shared)).toBe(true);

    const onBob = await until(async () => (await pairEventsOn(bob, pair)).find((e) => e.title === 'Koffie bij Anne') ?? null, { timeout: 30_000, step: 300 });
    expect(onBob, 'Bob has the appointment in the pair circle').toBeTruthy();
    // nothing of the source rides along: no attendees, no source circle or id
    const raw = JSON.stringify(onBob);
    expect(raw).not.toContain('someone-else');
    expect(raw).not.toContain(made.itemId);
    expect(onBob.sharedFrom).toBeUndefined();
    // …and it is on Bob's agenda (the calendar block reads his pair circles for appointments; they stay off his circle list)
    const [block] = await materializeScreen({
      screen: { id: 's', name: 'Vandaag', circleFilter: null, blocks: [{ id: 'c', type: 'calendar', config: { horizonDays: 7 } }] },
      hostOps: { callSkill: (app, o, g) => bob.agent.callSkill(app, o, g), circles: [] },
    });
    expect((block?.content?.items ?? []).map((i) => i.title ?? i.label).join(' | ')).toContain('Koffie bij Anne');

    // Bob's answer goes to Anne alone, over the pair lane (an item's own statement)
    expect((await bob.agent.callSkill('calendar', 'rsvpAccept', { circleId: pair, id: onBob.id }))?.ok).not.toBe(false);
    const answered = await until(async () => {
      const e = (await pairEventsOn(anne, pair)).find((x) => x.id === onBob.id);
      return e && JSON.stringify(e.rsvp ?? e).includes('accepted') ? e : null;
    }, { timeout: 30_000, step: 300 });
    // which side stopped it: Bob's own copy without the yes (the write) or with it (the crossing)
    const sides = answered ? null : JSON.stringify({
      bob: (await pairEventsOn(bob, pair)).find((x) => x.id === onBob.id)?.rsvp ?? 'no copy',
      anne: (await pairEventsOn(anne, pair)).find((x) => x.id === onBob.id)?.rsvp ?? 'no copy',
    });
    expect(answered, `Anne sees Bob's yes on the shared copy ${sides}`).toBeTruthy();

    // a move on Anne's side re-shares the SAME copy
    const later = new Date(when.getTime() + 3600_000);
    // named by its WORDS, as a person moves it: the re-share follows the appointment the op resolved
    expect((await anne.agent.callSkill('calendar', 'updateEvent', { id: 'Koffie bij Anne', when: later.toISOString() }))?.ok).not.toBe(false);
    const moved = await until(async () => (await pairEventsOn(bob, pair)).find((e) => e.id === onBob.id && Date.parse(e.startsAt) === later.getTime()) ?? null, { timeout: 30_000, step: 300 });
    expect(moved, 'the copy moved with it').toBeTruthy();
    expect((await pairEventsOn(bob, pair)).filter((e) => e.title === 'Koffie bij Anne')).toHaveLength(1);
    expect(JSON.stringify(moved.rsvp ?? moved), 'the re-share keeps Bob\'s answer').toContain('accepted');

    // a cancel re-shares as a cancel: it leaves Bob's agenda
    expect((await anne.agent.callSkill('calendar', 'cancelEvent', { id: made.itemId }))?.ok).not.toBe(false);
    const gone = await until(async () => ((await pairEventsOn(bob, pair)).some((e) => e.id === onBob.id) ? null : true), { timeout: 30_000, step: 300 });
    expect(gone, 'the cancel reached Bob').toBe(true);
  }, 120_000);
});
