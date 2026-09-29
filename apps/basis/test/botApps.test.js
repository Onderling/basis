/**
 * The bot's admin manages it from its own door: which apps it acts in (`/apps`), how it is doing (`/status`), who it
 * serves (`/users`). A member asking gets a refusal with a reason; the model is never offered these (no chat
 * surface), so a sentence cannot switch an app on.
 *
 * The app list is the `assistant.apps` parameter; switching recomposes the door's catalogue at once (the model's
 * tools and `/help` follow), and the list survives a restart because the parameter does.
 */
import { describe, it, expect, afterAll } from 'vitest';
import { InMemoryBridge } from '@onderling/chat-agent';
import { createMockHouseholdAgent, mockHouseholdManifest } from '../src/core/agent/mockAgent.js';
import { createTelegramRunner } from '../src/telegram/runner.js';
import { createDoorCatalogue } from '../src/telegram/assistantCatalogue.js';
import { EventLog } from '../src/eventLog.js';
import { createBotThreads, memoryThreadStore } from '../src/v2/botThreads.js';
import { withAssistantOps } from '../src/v2/assistantOps.js';
import { ASSISTANT_APPS_PARAM_KEY } from '../src/v2/assistantApps.js';
import { bootRealAgentNode, teardown } from './support/pairRealAgents.js';

const t = (k, p) => (p && typeof p === 'object' && Object.keys(p).length ? `${k}:${JSON.stringify(p)}` : k);
const ROLES = { 'telegram:1': 'admin', 'telegram:2': 'member' };
// The host gate's rule for a door caller, as a stand-in: an admin reaches `trusted`, a member `authenticated`.
const refusal = async (_op, caller, visibility) => (visibility === 'trusted' && ROLES[caller] !== 'admin' ? 'INSUFFICIENT_TIER' : null);

async function door({ stored = { value: undefined } } = {}) {
  const bridge = new InMemoryBridge({ id: 'telegram' });
  const agent = createMockHouseholdAgent();
  const threads = createBotThreads({ eventLog: new EventLog({ initial: [], muted: [] }), store: memoryThreadStore() });
  const doorCatalogue = createDoorCatalogue({
    householdManifest: mockHouseholdManifest,
    getApps: () => stored.value,
    setApps: async (list) => { stored.value = list; },
  });
  const runner = createTelegramRunner({
    bridge, catalogue: doorCatalogue.catalogue, manifestsByOrigin: doorCatalogue.manifestsByOrigin, t, allowedChatIds: '*', collectMs: 0,
    callSkill: withAssistantOps({
      callSkill: (app, op, args) => agent.callSkill(app, op, args), threads, t, refusal,
      admin: { catalogue: doorCatalogue, status: () => ({ model: 'm1', door: 'open', turns: 'off' }), users: async () => [{ id: 'telegram:1', displayName: 'Frits', role: 'admin' }, { id: 'telegram:2', role: 'member' }] },
    }),
    admit: async (who) => `${who.channel}:${who.uid}`, threads,
  });
  await threads.load(); await runner.start();
  const say = async (uid, text) => { bridge.clearOutbox(); await bridge.simulateIncoming({ chatId: uid, text, sender: { bridgeUid: uid } }); await runner.idle(); return bridge.outbox.map((m) => m.text).join('\n'); };
  return { say, doorCatalogue, stored };
}

const nodes = [];
afterAll(() => teardown(nodes));

describe('the bot\'s admin ops', () => {
  it('household and lists by default; /apps on tasks from the admin adds tasks and the catalogue follows; off removes it', async () => {
    const d = await door();
    expect(d.doorCatalogue.apps()).toEqual(['household', 'lists']);
    expect(d.doorCatalogue.catalogue().opsById.has('tasks/addTask') || d.doorCatalogue.catalogue().opsById.has('claimTask')).toBe(false);
    const listed = await d.say('1', '/apps');
    expect(listed).toContain('circle.bot.apps_list');
    await d.say('1', '/apps on tasks');
    expect(d.stored.value).toEqual(['household', 'lists', 'tasks']);
    expect(d.doorCatalogue.apps()).toContain('tasks');
    expect(d.doorCatalogue.catalogue().opsById.has('claimTask'), 'the catalogue was recomposed').toBe(true);
    await d.say('1', '/apps off tasks');
    expect(d.doorCatalogue.apps()).toEqual(['household', 'lists']);
    expect(d.doorCatalogue.catalogue().opsById.has('claimTask')).toBe(false);
  });

  it('a member is refused /apps, /status and /users, with a reason; nothing changes', async () => {
    const d = await door();
    for (const cmd of ['/apps on tasks', '/status', '/users']) {
      const out = await d.say('2', cmd);
      expect(out, cmd).toContain('circle.bot.admin_only');
    }
    expect(d.doorCatalogue.apps()).toEqual(['household', 'lists']);
  });

  it('/status and /users answer the admin; an unknown app is said, not added', async () => {
    const d = await door();
    expect(await d.say('1', '/status')).toContain('circle.bot.status');
    const users = await d.say('1', '/users');
    expect(users).toContain('Frits');
    expect(users).toContain('admin');
    expect(await d.say('1', '/apps on kaboom')).toContain('circle.bot.apps_unknown');
    expect(d.doorCatalogue.apps()).toEqual(['household', 'lists']);
  });

  it('the model is never offered them: no chat surface', async () => {
    const d = await door();
    for (const id of ['assistant-apps', 'assistant-status', 'assistant-users']) {
      const op = d.doorCatalogue.catalogue().opsById.get(id)?.op;
      expect(op, id).toBeTruthy();
      expect(op.surfaces.chat, `${id} has no chat surface`).toBeUndefined();
      expect(op.visibility).toBe('trusted');
    }
  });

  it('the app list survives a restart: it is the agent\'s parameter', async () => {
    const node = await bootRealAgentNode('apps');
    nodes.push(node);
    const { agent } = node;
    const cat = createDoorCatalogue({
      householdManifest: mockHouseholdManifest,
      getApps: () => agent.getParamValue(ASSISTANT_APPS_PARAM_KEY),
      setApps: (list) => agent.callSkill('params', 'set-param', { key: ASSISTANT_APPS_PARAM_KEY, value: list }),
    });
    await cat.setApps(['household', 'lists', 'tasks']);
    expect(agent.getParamValue(ASSISTANT_APPS_PARAM_KEY)).toEqual(['household', 'lists', 'tasks']);
    // a fresh composition over the same agent (what a restart reads) sees it
    const again = createDoorCatalogue({ householdManifest: mockHouseholdManifest, getApps: () => agent.getParamValue(ASSISTANT_APPS_PARAM_KEY), setApps: async () => {} });
    expect(again.apps()).toContain('tasks');
  }, 90_000);
});
