/**
 * Mij = identity: ONE declared screen. The manifest lists its blocks (`meBlocks`: the identity line, the agents list);
 * the one screen materializer fills them. The identity line is the person's name with the readings its config names
 * (availability · online · unread · open chores · next appointment); the agents block lists this person's devices,
 * their companions and the bots linked to them, one row each.
 */
import { describe, it, expect } from 'vitest';
import { basisManifest } from '../../src/index.js';
import { mijScreenBlocks, MIJ_READINGS, identityLineWords, agentRowWords } from '../../src/v2/mijScreen.js';
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
    if (app === 'stoop' && op === 'getMyProfile') return { entry: { handle: 'frits', displayName: 'Frits' } };
    if (app === 'agents' && op === 'getProfileProperties') return registry;
    if (app === 'stoop' && op === 'listContacts') return { contacts: [
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
  it('the manifest declares the Mij blocks, each a known block type placed on Mij', () => {
    const types = (basisManifest.meBlocks ?? []).map((b) => b.type);
    expect(types).toEqual(['identityLine', 'agents']);
    for (const t of types) expect(BLOCK_TYPES).toContain(t);
    const readings = basisManifest.meBlocks[0].config.readings;
    expect(readings.length).toBeGreaterThan(0);
    for (const r of readings) expect(MIJ_READINGS).toContain(r);
  });

  it('the identity line: the name, and each reading its config names', async () => {
    const log = new EventLog({ initial: [], muted: [] });
    log.append({ id: 'm1', ts: 1000, app: 'chat', type: 'chat-message', circleId: 'a', actor: 'bea', payload: { text: 'hoi' } });
    log.append({ id: 'm2', ts: 2000, app: 'chat', type: 'chat-message', circleId: 'a', actor: 'bea', payload: { text: 'hoi' } });
    const soon = Date.now() + 3_600_000;
    const nextWeek = new Date(Date.now() + 7 * 86_400_000).toISOString().slice(0, 10);
    const [line] = await mijScreenBlocks({ hostOps: {
      callSkill: hostCall({ events: [{ id: 'e1', title: 'tandarts', startsAt: new Date(soon).toISOString() }] }),
      eventLog: log, circles: [{ id: 'a', name: 'Thuis' }], seenAt: {}, myRefs: ['me'], myWebid: 'me',
      availability: { holiday: { active: true, until: nextWeek } }, online: true,
    } });
    expect(line.type).toBe('identityLine');
    expect(line.status).toBe('ok');
    expect(line.content.name).toBe('Frits');
    const byKey = Object.fromEntries(line.content.readings.map((r) => [r.key, r]));
    expect(byKey.availability).toMatchObject({ state: 'away', until: nextWeek });
    expect(byKey.online).toMatchObject({ on: true });
    expect(byKey.unread).toMatchObject({ count: 2 });
    expect(byKey.next).toMatchObject({ title: 'tandarts' });
  });

  it('a reading with no source says nothing rather than a guess', async () => {
    const [line] = await mijScreenBlocks({ hostOps: { callSkill: hostCall(), circles: [] } });
    const keys = line.content.readings.map((r) => r.key);
    expect(keys).not.toContain('online');
    expect(keys).not.toContain('availability');
    expect(keys).not.toContain('next');
  });

  it('the agents block: live devices (this one marked), companions, linked bots — no revoked device, no person', async () => {
    const [, agents] = await mijScreenBlocks({ hostOps: { callSkill: hostCall(), circles: [], deviceId: 'laptop' } });
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
    const [, agents] = await mijScreenBlocks({ hostOps: { callSkill: hostCall(), circles: [], deviceId: 'fresh' } });
    expect(agents.content.items.filter((r) => r.here)).toHaveLength(1);
  });

  it('both shells word the line and the rows through one helper, in the declared order', () => {
    const t = (k, v) => `${k}${v ? JSON.stringify(v) : ''}`;
    const words = identityLineWords({ readings: [{ key: 'online', on: false }, { key: 'unread', count: 3 }, { key: 'nope' }] }, { t });
    expect(words).toEqual(['circle.profile.reading_offline', 'circle.profile.reading_unread{"count":3}']);
    expect(agentRowWords({ kind: 'device', label: null, here: true }, t)).toBe('circle.profile.agent_here');
    expect(agentRowWords({ kind: 'bot', label: 'Huishoudbot' }, t)).toBe('circle.profile.agent_bot{"label":"Huishoudbot"}');
  });
});

describe('Mij follows the switcher', () => {
  it('one persona ticked: its own name, its own devices (its device here marked), no bots of the person', async () => {
    const callSkill = async (app, op, args) => {
      if (app === 'stoop' && op === 'getMyProfile') return { entry: { displayName: 'Frits' } };
      if (app === 'agents' && op === 'getProfileProperties') {
        return args?.id === 'p-werk'
          ? { properties: { deviceDelegations: { mode: 'own', value: { wd: { deviceId: 'wd', label: 'werklaptop' } } } } }
          : registry;
      }
      if (app === 'stoop' && op === 'listContacts') return { contacts: [{ displayName: 'Huishoudbot', peerAddr: 'bot', linkedRow: 'r' }] };
      return null;
    };
    const [line, agents] = await mijScreenBlocks({ hostOps: { callSkill, circles: [], mijSelf: { id: 'p-werk', name: 'Werk', deviceId: 'wd' } } });
    expect(line.content.name).toBe('Werk');
    expect(agents.content.items.map((r) => [r.kind, r.label, r.here === true])).toEqual([['device', 'werklaptop', true]]);
  });
});
