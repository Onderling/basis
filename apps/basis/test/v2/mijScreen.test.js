/**
 * Mij = identity: ONE declared screen. The manifest lists its blocks (`meBlocks`: the identity line, the agents list);
 * the one screen materializer fills them. The identity line is the person's name, nothing else (its readings went
 * 2026-11-20: availability to Vandaag, the counts dropped); the agents block lists this person's devices, their
 * companions and the bots linked to them, one row each.
 */
import { describe, it, expect } from 'vitest';
import { basisManifest } from '../../src/index.js';
import * as mijScreen from '../../src/v2/mijScreen.js';
import * as mijWords from '../../src/v2/mijWords.js';
import * as screenBlocks from '../../src/v2/userScreenBlocks.js';
import { materializeScreen } from '../../src/v2/userScreenBlocks.js';
const { mijScreenBlocks, agentRowWords } = mijScreen;
const { availabilityWords } = mijWords;
// an identity line on a stored page that still names readings in its config (from before 2026-11-20)
const lineWithOldReadings = (hostOps) => materializeScreen({ screen: { id: 'mij', blocks: [{ id: 'l', type: 'identityLine', config: { readings: ['availability', 'online', 'unread', 'open', 'next'] } }] }, hostOps });
import { BLOCK_TYPES } from '../../src/v2/circleRecipe.js';
import { EventLog } from '../../src/eventLog.js';

const registry = {
  properties: {
    deviceDelegations: { mode: 'own', value: {
      phone: { deviceId: 'phone', label: 'telefoon' },
      laptop: { deviceId: 'laptop', label: 'laptop' },
      old: { deviceId: 'old', label: 'oud', revoked: true },
    } },
    ownedNodes: { mode: 'own', value: { n1: { address: 'node-address-1234', label: 'tablet', claimedAt: 1 } } },
  },
};

function hostCall({ events = [], chores = [] } = {}) {
  return async (app, op) => {
    if (app === 'pinboard' && op === 'getMyProfile') return { entry: { handle: 'frits', displayName: 'Frits' } };
    if (app === 'agents' && op === 'getProfileProperties') return registry;
    if (app === 'pinboard' && op === 'listContacts') return { contacts: [
      { contactId: 'bot', displayName: 'Huishoudbot', peerAddr: 'bot-addr', linkedRow: 'row-1' },
      { contactId: 'bea', displayName: 'Bea', peerAddr: 'bea-addr' },
    ] };
    if (app === 'calendar' && op === 'listEvents') return { items: events };
    if (app === 'calendar') return { items: [] };
    if (op.includes('task') || app === 'tasks' || app === 'household') return { items: chores, result: chores };
    return null;
  };
}

describe('Mij — the declared screen', () => {
  it('the manifest declares the persona panel\'s blocks: the name (no readings: what is about now is on Vandaag), the devices', () => {
    const types = (basisManifest.meBlocks ?? []).map((b) => b.type);
    expect(types).toEqual(['identityLine', 'agents']);
    for (const t of types) expect(BLOCK_TYPES).toContain(t);
    expect(basisManifest.meBlocks[0].config).toEqual({});
  });

  it('the identity line is the name, and nothing else: the readings are gone, also on a page whose config still names them', async () => {
    const log = new EventLog({ initial: [], muted: [] });
    log.append({ id: 'm1', ts: 1000, app: 'chat', type: 'chat-message', circleId: 'a', actor: 'bea', payload: { text: 'hoi' } });
    const nextWeek = new Date(Date.now() + 7 * 86_400_000).toISOString().slice(0, 10);
    const [line] = await lineWithOldReadings({
      callSkill: hostCall(), eventLog: log, circles: [{ id: 'a', name: 'Thuis' }], seenAt: {}, myRefs: ['me'], myWebid: 'me',
      availability: { holiday: { active: true, until: nextWeek } }, online: true,
    });
    expect(line.type).toBe('identityLine');
    expect(line.status).toBe('ok');
    expect(line.content).toEqual({ name: 'Frits' });
    expect(mijScreen.MIJ_READINGS, 'no reading list left to name').toBeUndefined();
    expect(screenBlocks.MIJ_READINGS).toBeUndefined();
    expect(mijWords.identityLineWords, 'the words are the availability block\'s only').toBeUndefined();
  });

  it('the agents block: live devices (this one marked), companions, linked bots — no revoked device, no person', async () => {
    const agents = (await mijScreenBlocks({ hostOps: { callSkill: hostCall(), circles: [], deviceId: 'laptop' } })).find((b) => b.type === 'agents');
    expect(agents.type).toBe('agents');
    expect(agents.status).toBe('ok');
    const rows = agents.content.items.map((r) => [r.kind, r.label, r.here === true]);
    expect(rows).toEqual([
      ['device', 'telefoon', false],
      ['device', 'laptop', true],
      ['companion', 'tablet', false],
      ['bot', 'Huishoudbot', false],
    ]);
  });

  it('a device that is not in the delegations still lists itself', async () => {
    const agents = (await mijScreenBlocks({ hostOps: { callSkill: hostCall(), circles: [], deviceId: 'fresh' } })).find((b) => b.type === 'agents');
    expect(agents.content.items.filter((r) => r.here)).toHaveLength(1);
  });

  it('both shells word the availability block and the rows through one helper', () => {
    const t = (k, v) => `${k}${v ? JSON.stringify(v) : ''}`;
    expect(availabilityWords({ key: 'availability', state: 'available' }, { t })).toBe('circle.profile.reading_available');
    expect(availabilityWords(null, { t })).toBe('');
    expect(agentRowWords({ kind: 'device', label: null, here: true }, t)).toBe('circle.profile.agent_here');
    expect(agentRowWords({ kind: 'bot', label: 'Huishoudbot' }, t)).toBe('circle.profile.agent_bot{"label":"Huishoudbot"}');
  });
});

describe('Mij follows the switcher', () => {
  it('one persona ticked: its own name, its own devices (its device here marked), no bots of the person', async () => {
    const callSkill = async (app, op, args) => {
      if (app === 'pinboard' && op === 'getMyProfile') return { entry: { displayName: 'Frits' } };
      if (app === 'agents' && op === 'getProfileProperties') {
        return args?.id === 'p-werk'
          ? { properties: { deviceDelegations: { mode: 'own', value: { wd: { deviceId: 'wd', label: 'werklaptop' } } } } }
          : registry;
      }
      if (app === 'pinboard' && op === 'listContacts') return { contacts: [{ displayName: 'Huishoudbot', peerAddr: 'bot', linkedRow: 'r' }] };
      return null;
    };
    const blocks = await mijScreenBlocks({ hostOps: { callSkill, circles: [], mijSelf: { id: 'p-werk', name: 'Werk', deviceId: 'wd' } } }); const line = blocks.find((b) => b.type === 'identityLine'); const agents = blocks.find((b) => b.type === 'agents');
    expect(line.content.name).toBe('Werk');
    expect(agents.content.items.map((r) => [r.kind, r.label, r.here === true])).toEqual([['device', 'werklaptop', true]]);
  });
});
