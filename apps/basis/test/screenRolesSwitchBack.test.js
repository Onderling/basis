/**
 * A screen's token outlives a change of the roles preset; what it may do does not. A token minted for a member's
 * reassignTask while the household is flat stays a valid token after the admin switches back to standard — and the
 * call through it is refused, because the door asks the role rule with the CURRENT preset on every call. The switch
 * also tells the shells to republish the menus.
 */
import { describe, it, expect, afterAll } from 'vitest';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { randomBytes } from 'node:crypto';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { VaultNodeFs, VaultMemory } from '@onderling/vault';
import { DataPart, AgentIdentity } from '@onderling/core';
import { renderA2A } from '@onderling/app-manifest';
import { createRealHouseholdAgent } from '../src/core/agent/realAgent.js';
import { ensureHouseholdLists } from '../src/v2/householdTemplate.js';
import { botOpLevel, botRoleAllows } from '../src/v2/botOpMap.js';
import { withAssistantOps } from '../src/v2/assistantOps.js';
import { createBotUsers, contactBookStore } from '../src/v2/botUsers.js';
import { screenActsAs, BOT_SCREEN_NEVER } from '../src/v2/screenActing.js';
import { listsManifest } from '../../lists/manifest.js';
import { tasksManifest } from '../../tasks-v0/manifest.js';
import { assistantManifest } from '../src/v2/assistantManifest.js';
import { EventLog } from '../src/eventLog.js';
import { createBotThreads, memoryThreadStore } from '../src/v2/botThreads.js';
import { HOUSEHOLD_BOT_STORE_OPTS } from '../src/v2/householdBotStore.js';

const NAMES = { 'circle.lists.template.shopping': 'Boodschappen', 'circle.lists.template.chores': 'Klusjes', 'circle.lists.template.repairs': 'Reparaties', 'circle.lists.template.schedule': 'Agenda' };
const t = (k, vars) => NAMES[k] ?? (vars ? `${k} ${JSON.stringify(vars)}` : k);
const MEMBER = 'telegram:1';
const ADMIN = 'telegram:9';

describe('flat → standard: a token minted under flat keeps its bytes, not its reach', () => {
  let dir; let agent;
  afterAll(async () => { await agent?.stop?.().catch(() => {}); if (dir) await rm(dir, { recursive: true, force: true }).catch(() => {}); });

  it('the member moves a chore through the screen under flat; after the switch back the same token is refused at the waist', async () => {
    dir = await mkdtemp(path.join(tmpdir(), 'bot-roles-back-'));
    const pass = randomBytes(32).toString('base64url');
    await writeFile(path.join(dir, 'vault.passphrase'), pass, { mode: 0o600 });
    agent = await createRealHouseholdAgent({
      ownerRootVault: new VaultNodeFs(path.join(dir, 'vault.json'), pass), chatVault: new VaultNodeFs(path.join(dir, 'chat-vault.json'), pass),
      householdPersistDb: { path: path.join(dir, 'household-items.json') }, seedDemoData: false, seedHousehold: false,
      ...HOUSEHOLD_BOT_STORE_OPTS, doorOpLevel: botOpLevel, doorRoleAllows: botRoleAllows, trustOwnGrants: true, t,
    });
    const own = (a, o, x) => agent.callSkill(a, o, x);
    await ensureHouseholdLists({ callSkill: own, t });
    for (const [webid, role] of [[MEMBER, 'member'], [ADMIN, 'admin']]) { await own('stoop', 'addContact', { webid, channel: 'telegram', role }); await agent.setDoorCaller(webid, role); }
    const threads = createBotThreads({ eventLog: new EventLog({ initial: [], muted: [] }), store: memoryThreadStore() });
    await threads.load();
    const changed = [];
    const doorCall = withAssistantOps({
      callSkill: (a, o, x, ctx) => agent.callSkill(a, o, x, ctx), threads, t, refusal: agent.doorRefusal,
      admin: { users: async () => [{ id: ADMIN, channel: 'telegram', uid: '9', role: 'admin' }], onSettingChanged: (key) => changed.push(key) },
    });
    const users = createBotUsers({ store: contactBookStore(own) });
    agent.exposeToPeers(renderA2A([listsManifest, tasksManifest, assistantManifest], { callSkill: doorCall }, { ctxFor: screenActsAs(users, { activeEntry: (id) => agent.surfaceTokenEntry(id) }), never: BOT_SCREEN_NEVER }));
    const bot = agent.sa.agent;
    const view = await AgentIdentity.generate(new VaultMemory());
    await agent.sa.trust?.setTier?.(view.pubKey, 'authenticated');
    const act = async (skillId, args, token) => {
      try { await bot.policyEngine.checkInbound({ peerPubKey: view.pubKey, skillId, token }); } catch (e) { return { refusedAt: 'token', code: e?.code }; }
      return bot.skills.get(skillId).handler({ parts: [DataPart(args)], envelope: { payload: { _token: token } } });
    };
    const asAdmin = (op, args) => doorCall('assistant', op, args, { caller: ADMIN, threadId: ADMIN, chatId: '9' });
    const chore = async (text) => {
      await agent.callSkill('lists', 'addToList', { list: 'Klusjes', text }, { caller: ADMIN });
      return ((await own('tasks', 'listOpen', {})).items ?? []).find((x) => x.text === text)?.id;
    };

    expect((await asAdmin('assistant-settings', { change: 'roles flat' })).ok).toBe(true);
    const token = (await own('household', 'grantSurface', { viewPubKey: view.pubKey, ops: ['tasks.reassignTask'], actingAs: MEMBER })).tokens[0];
    const ramen = await chore('ramen');
    const underFlat = await act('tasks.reassignTask', { id: ramen, newAssignee: ADMIN }, token);
    expect(underFlat.ok, JSON.stringify(underFlat)).not.toBe(false);

    expect((await asAdmin('assistant-settings', { change: 'roles standard' })).ok).toBe(true);
    expect(changed).toEqual(['assistant.roles', 'assistant.roles']);
    const glas = await chore('glas');
    const after = await act('tasks.reassignTask', { id: glas, newAssignee: ADMIN }, token);
    expect(after.refusedAt, 'the token itself still checks out — the refusal is the waist\'s').toBeUndefined();
    expect(after.ok, JSON.stringify(after)).toBe(false);
    const g = (await agent.householdItems()).find((i) => i.text === 'glas');
    expect([...(g.assignees ?? []), g.assignee]).not.toContain(ADMIN);
  }, 120_000);
});
