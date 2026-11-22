/**
 * AN APPOINTMENT SHARED WITH A CONTACT IS WRITTEN INTO THE PAIR CIRCLE, and that circle's switches are asked there.
 * The share's door asks the own place (where the appointment lives); the copy lands in ANOTHER circle. When that
 * circle has the calendar's add switched off, the copy would show on the sender and be refused on every other device:
 * the share is refused here instead, in the door's words, nothing is written into the pair circle and the own
 * appointment is not marked shared. And the sender answers as the receivers do: a pair circle that never changed its
 * settings applies every row on their side (its first settings have the calendar off), so it is never refused here.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { startJourneyRelay } from './support/testRelay.js';
import { bootRealAgentNode, connectNodesOverRelay, until, teardown } from './support/pairRealAgents.js';
import { pairCircleIdFor } from '../src/v2/pairRoster.js';
import { EventLog } from '../src/eventLog.js';
import { capabilityKey } from '../src/v2/capabilityGate.js';
import { noteKeptPolicyChanges } from '../src/v2/keptPolicyChanges.js';
import { POLICY_UPDATE_KIND } from '../src/v2/policyUpdateLane.js';

describe('a share into a pair circle asks that circle\'s switches', () => {
  let relay; let phone; let cor; let pair; let phoneLog;
  const policies = new Map();   // circleId → policy, as the shell's reader hands it to the gate
  const inputs = async (circleId) => ({ policy: policies.get(circleId) ?? {} });

  beforeAll(async () => {
    relay = await startJourneyRelay();
    phoneLog = new EventLog({ initial: [], muted: [] });
    phone = await bootRealAgentNode('phone', { contactChannel: true, pairRoster: true, agentOpts: { circleCapabilityInputs: inputs, deviceLog: phoneLog } });
    cor = await bootRealAgentNode('cor', { contactChannel: true, pairRoster: true, agentOpts: { deviceLog: new EventLog({ initial: [], muted: [] }) } });
    await connectNodesOverRelay([phone, cor], { relayUrl: relay.url });
    await phone.agent.callSkill('pinboard', 'addContact', { webid: cor.pubKey, pubKey: cor.pubKey, displayName: 'Cor' });
    await cor.agent.callSkill('pinboard', 'addContact', { webid: phone.pubKey, pubKey: phone.pubKey, displayName: 'Anna' });
    // a turn each way: the roster of the two forms the pair circle
    await phone.contactThreadChannel.sendTurn({ peerAddr: cor.pubKey, threadId: cor.pubKey, text: 'hoi Cor', messageId: 't-1' }).sent;
    await cor.contactThreadChannel.sendTurn({ peerAddr: phone.pubKey, threadId: phone.pubKey, text: 'hoi Anna', messageId: 't-2' }).sent;
    pair = pairCircleIdFor(phone.pubKey, cor.pubKey);
    const mine = async () => ((await phone.agent.callSkill('pinboard', 'listMyCircles', {}))?.circles ?? []).map((c) => (typeof c === 'string' ? c : c?.groupId));
    expect(await until(async () => ((await mine()).includes(pair) ? true : null), { timeout: 30000, step: 300 }), 'no pair circle with Cor').toBe(true);
  }, 120_000);

  afterAll(async () => { await teardown(phone, cor); await relay?.close?.(); });

  const when = () => new Date(Date.now() + 24 * 3600_000).toISOString();
  const pairEvents = async () => (await phone.agent.callSkill('calendar', 'listEvents', { circleId: pair, days: 3650 }))?.items ?? [];

  it('switched off in the pair circle: refused in the door\'s words, nothing written there, not marked shared', async () => {
    // a settings change the pair circle's settings lane kept: the calendar on, its add off (as its receivers judge by it)
    const policy = { features: { calendar: true }, capabilities: { [capabilityKey('calendar', 'add', 'calendar-event')]: { enabled: false } } };
    policies.set(pair, policy);
    noteKeptPolicyChanges(phoneLog, pair, [{ kind: POLICY_UPDATE_KIND, author: 'admin', hash: 'p1', payload: { policy, version: 1, contentUpTo: { items: [], chat: [] } } }]);
    const made = await phone.agent.callSkill('calendar', 'addEvent', { title: 'Koffie', startsAt: when() });
    expect(made?.ok, JSON.stringify(made)).toBe(true);
    const r = await phone.agent.callSkill('calendar', 'shareEvent', { id: made.itemId, with: cor.pubKey });
    expect(r?.ok, `the share went into a circle that has the calendar's add off: ${JSON.stringify(r)}`).toBe(false);
    expect(String(r?.error ?? ''), 'the refusal is not told in the door\'s words').not.toBe('');
    expect(await pairEvents(), 'a copy was written into the pair circle').toEqual([]);
    const own = ((await phone.agent.callSkill('calendar', 'listEvents', { days: 3650 }))?.items ?? []).find((e) => e.id === made.itemId);
    expect(own?.shared ?? [], 'the own appointment is marked shared').toEqual([]);
    // the same gate the agent hands both shells for a share's copy into its source circle
    expect(await phone.agent.mayWriteInto(pair, { type: 'calendar-event', act: 'add' }), 'the agent\'s gate does not refuse it').toBeTruthy();
  }, 60_000);

  it('never changed (its first settings have the calendar off): the share goes, as every receiver applies it', async () => {
    policies.delete(pair);
    noteKeptPolicyChanges(phoneLog, pair, []);
    const made = await phone.agent.callSkill('calendar', 'addEvent', { title: 'Thee', startsAt: when() });
    const r = await phone.agent.callSkill('calendar', 'shareEvent', { id: made.itemId, with: cor.pubKey });
    expect(r?.ok, JSON.stringify(r)).toBe(true);
    expect((await pairEvents()).map((e) => e.title)).toContain('Thee');
  }, 60_000);
});
