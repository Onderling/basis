/**
 * A door's person runs in the door's circle: whatever a typed line (or a model, or a screen) puts in `circleId` /
 * `groupId`, a call that carries `ctx.caller` lands in the household circle. The slash parser accepts any
 * `--key=value`, so a Telegram member could write `--circleId=<another circle on the bot>`; the token and the door
 * gate do not look at the circle, so it is pinned at the waist, for every door alike.
 *
 * Composed the way the box composes it: the real agent as a bot (door levels and roles), the box's catalogue, the
 * real Telegram runner with its admission, a typed line.
 */
import { describe, it, expect, afterAll } from 'vitest';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { randomBytes } from 'node:crypto';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { InMemoryBridge } from '@onderling/chat-agent';
import { VaultNodeFs } from '@onderling/vault';
import { createRealHouseholdAgent } from '../src/core/agent/realAgent.js';
import { createTelegramRunner } from '../src/telegram/runner.js';
import { composeAssistantCatalogue } from '../src/telegram/assistantCatalogue.js';
import { ensureHouseholdLists } from '../src/v2/householdTemplate.js';
import { botOpLevel, botRoleAllows } from '../src/v2/botOpMap.js';

import { HOUSEHOLD_BOT_STORE_OPTS } from '../src/v2/householdBotStore.js';
const NAMES = { 'circle.lists.template.shopping': 'Boodschappen', 'circle.lists.template.chores': 'Klusjes', 'circle.lists.template.repairs': 'Reparaties', 'circle.lists.template.schedule': 'Agenda' };
const t = (k, vars) => NAMES[k] ?? (vars ? `${k} ${JSON.stringify(vars)}` : k);
const MEMBER = 'telegram:42';
const OTHER = 'pair-2';

describe('a door\'s person runs in the door\'s circle', () => {
  let dir; let agent;
  afterAll(async () => { await agent?.stop?.().catch(() => {}); if (dir) await rm(dir, { recursive: true, force: true }).catch(() => {}); });

  it('a typed --circleId / --groupId is not followed: the household, the other circle unchanged', async () => {
    dir = await mkdtemp(path.join(tmpdir(), 'bot-door-circle-'));
    const pass = randomBytes(32).toString('base64url');
    await writeFile(path.join(dir, 'vault.passphrase'), pass, { mode: 0o600 });
    agent = await createRealHouseholdAgent({
      ownerRootVault: new VaultNodeFs(path.join(dir, 'vault.json'), pass), chatVault: new VaultNodeFs(path.join(dir, 'chat-vault.json'), pass),
      householdPersistDb: { path: path.join(dir, 'household-items.json') }, seedDemoData: false, seedHousehold: false,
      ...HOUSEHOLD_BOT_STORE_OPTS, doorOpLevel: botOpLevel, doorRoleAllows: botRoleAllows, t,
    });
    const own = (a, o, x) => agent.callSkill(a, o, x);
    await ensureHouseholdLists({ callSkill: own, t });
    await own('stoop', 'addContact', { webid: MEMBER, channel: 'telegram', role: 'member' });
    await agent.setDoorCaller(MEMBER, 'member');
    // a second circle on the bot, reached by the host (which may name any circle)
    await own('lists', 'createList', { text: 'Geheim', circleId: OTHER });
    await own('lists', 'addToList', { list: 'Geheim', text: 'sleutel', circleId: OTHER });
    await own('lists', 'createList', { text: 'Boodschappen', circleId: OTHER });
    const otherOf = async (list) => JSON.stringify(await own('lists', 'listEntries', { list, circleId: OTHER }));
    const before = { geheim: await otherOf('Geheim'), boodschappen: await otherOf('Boodschappen') };
    expect(before.geheim).toContain('sleutel');

    const { catalogue, manifestsByOrigin } = composeAssistantCatalogue({});
    const bridge = new InMemoryBridge({ id: 'telegram' });
    const runner = createTelegramRunner({
      bridge, catalogue, manifestsByOrigin, t, callSkill: (a, o, x, ctx) => agent.callSkill(a, o, x, ctx), allowedChatIds: '*',
      llm: { invoke: async () => null }, interpret: async () => null, admit: async () => MEMBER,
    });
    await runner.start();
    const say = async (text) => {
      bridge.clearOutbox();
      await bridge.simulateIncoming({ chatId: '42', text, sender: { bridgeUid: '42', displayName: 'Ann' } });
      await runner.idle('42');
      return bridge.outbox.map((m) => m.text).join('\n');
    };

    for (const key of ['circleId', 'groupId']) {
      await say(`/add-to-list --list Boodschappen --text melk-${key} --${key}=${OTHER}`);
      await say(`/add-to-list --list Geheim --text inbraak-${key} --${key}=${OTHER}`);
      const household = await agent.householdItems();
      expect(household.some((i) => i.text === `melk-${key}`), `${key}: the entry is the household's`).toBe(true);
      expect(await otherOf('Boodschappen'), `${key}: the other circle's list is unchanged`).toBe(before.boodschappen);
      expect(await otherOf('Geheim'), `${key}: the other circle's list is unchanged`).toBe(before.geheim);
    }
    // the host itself still names a circle (the pin is for a door's person, not for the bot's own calls)
    expect((await own('lists', 'addToList', { list: 'Geheim', text: 'eigen', circleId: OTHER })).ok).toBe(true);
    expect(await otherOf('Geheim')).toContain('eigen');
  }, 120_000);
});
