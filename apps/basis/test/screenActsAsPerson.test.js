/**
 * A connected screen acts AS its person on a household bot (Fable, setup brief §7): the bot exposes its door's ops to
 * peers (`renderA2A` over the door's call, `ctxFor` = the token's `actingAs`), so a screen's call passes the same gate
 * as that person's typed line. Through the REAL path: the kernel's token check, then the registered skill.
 */
import { describe, it, expect, afterAll } from 'vitest';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { randomBytes } from 'node:crypto';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { VaultNodeFs } from '@onderling/vault';
import { CapabilityToken, DataPart, AgentIdentity } from '@onderling/core';
import { VaultMemory } from '@onderling/vault';
import { renderA2A } from '@onderling/app-manifest';
import { createRealHouseholdAgent } from '../src/core/agent/realAgent.js';
import { ensureHouseholdLists } from '../src/v2/householdTemplate.js';
import { botOpLevel, botRoleAllows } from '../src/v2/botOpMap.js';
import { withAssistantOps } from '../src/v2/assistantOps.js';
import { createBotUsers, contactBookStore } from '../src/v2/botUsers.js';
import { screenActsAs, BOT_SCREEN_NEVER } from '../src/v2/screenActing.js';
import { listsManifest } from '../../lists/manifest.js';
import { assistantManifest } from '../src/v2/assistantManifest.js';
import { EventLog } from '../src/eventLog.js';
import { createBotThreads, memoryThreadStore } from '../src/v2/botThreads.js';

const NAMES = { 'circle.lists.template.shopping': 'Boodschappen', 'circle.lists.template.chores': 'Klusjes', 'circle.lists.template.repairs': 'Reparaties', 'circle.lists.template.schedule': 'Agenda' };
const t = (k, vars) => NAMES[k] ?? (vars ? `${k} ${JSON.stringify(vars)}` : k);
const MEMBER = 'telegram:1';
const ADMIN = 'telegram:9';

describe('a screen acts as its person on the bot', () => {
  let dir; let agent;
  afterAll(async () => { await agent?.stop?.().catch(() => {}); if (dir) await rm(dir, { recursive: true, force: true }).catch(() => {}); });

  it('the gate as that person; refused without a person; the old exposure would have run as the host', async () => {
    dir = await mkdtemp(path.join(tmpdir(), 'bot-screen-'));
    const pass = randomBytes(32).toString('base64url');
    await writeFile(path.join(dir, 'vault.passphrase'), pass, { mode: 0o600 });
    agent = await createRealHouseholdAgent({
      ownerRootVault: new VaultNodeFs(path.join(dir, 'vault.json'), pass), chatVault: new VaultNodeFs(path.join(dir, 'chat-vault.json'), pass),
      householdPersistDb: { path: path.join(dir, 'household-items.json') }, seedDemoData: false, seedHousehold: false,
      tasksCircleId: 'household', calendarInCircle: true, doorOpLevel: botOpLevel, doorRoleAllows: botRoleAllows, t,
    });
    const own = (a, o, x) => agent.callSkill(a, o, x);
    await ensureHouseholdLists({ callSkill: own, t });
    for (const [webid, role] of [[MEMBER, 'member'], [ADMIN, 'admin']]) { await own('stoop', 'addContact', { webid, channel: 'telegram', role }); await agent.setDoorCaller(webid, role); }
    const threads = createBotThreads({ eventLog: new EventLog({ initial: [], muted: [] }), store: memoryThreadStore() });
    await threads.load();
    const doorCall = withAssistantOps({ callSkill: (a, o, x, ctx) => agent.callSkill(a, o, x, ctx), threads, t, refusal: agent.doorRefusal, admin: {} });
    const users = createBotUsers({ store: contactBookStore(own) });

    // the bot exposes its door to screens
    expect(typeof agent.exposeToPeers).toBe('function');
    agent.exposeToPeers(renderA2A([listsManifest, assistantManifest], { callSkill: doorCall }, { ctxFor: screenActsAs(users), never: BOT_SCREEN_NEVER }));
    const bot = agent.sa.agent;
    const view = await AgentIdentity.generate(new VaultMemory());
    await agent.sa.trust?.setTier?.(view.pubKey, 'authenticated');
    await agent.sa.trust?.setTier?.(bot.identity.pubKey, 'trusted');
    const mint = async (skill, constraints) => (await CapabilityToken.issue(bot.identity, { subject: view.pubKey, agentId: bot.identity.pubKey, skill, constraints })).toJSON();
    const act = async (skillId, args, token) => {
      try { await bot.policyEngine.checkInbound({ peerPubKey: view.pubKey, skillId, token }); } catch (e) { return { refusedAt: 'token', code: e?.code }; }
      return bot.skills.get(skillId).handler({ parts: [DataPart(args)], envelope: { payload: { _token: token } } });
    };

    // the member's screen adds a chore, claiming to be the admin: it is the member's
    const tok = await mint('lists.addToList', { role: 'surface', actingAs: MEMBER });
    const r = await act('lists.addToList', { list: 'Klusjes', text: 'ramen', assignee: 'mij', actor: ADMIN }, tok);
    expect(r.ok, JSON.stringify(r)).toBe(true);
    const chore = (await agent.householdItems()).find((i) => i.type === 'task' && i.text === 'ramen');
    expect([...(chore.assignees ?? []), chore.assignee]).toContain(MEMBER);
    expect([...(chore.assignees ?? []), chore.assignee]).not.toContain(ADMIN);

    // a token with no person, or a person not in the book: refused before the op
    expect(await act('lists.addToList', { list: 'Klusjes', text: 'x' }, await mint('lists.addToList', { role: 'surface' }))).toMatchObject({ ok: false, error: 'not-bound' });
    expect(await act('lists.addToList', { list: 'Klusjes', text: 'x' }, await mint('lists.addToList', { role: 'surface', actingAs: 'telegram:404' }))).toMatchObject({ ok: false, error: 'not-bound' });
    // the admin's op on a member's screen: the door-role check refuses it (the gate reads the current role)
    const rm1 = await act('lists.removeList', { list: 'Reparaties' }, await mint('lists.removeList', { role: 'surface', actingAs: MEMBER }));
    expect(rm1.ok, JSON.stringify(rm1)).toBe(false);
    // a withheld op, whatever the token
    expect(await act('assistant.assistant-import', { file: 'x' }, await mint('assistant.assistant-import', { role: 'surface', actingAs: ADMIN }))).toMatchObject({ refusedAt: 'token' });

    // a token the screen (or anyone but the bot) issues itself, naming any person: refused at the token check —
    // the door's person tiers (an admin is 'trusted' there) live in the host's registry, not this one
    const forged = (await CapabilityToken.issue(view, { subject: view.pubKey, agentId: bot.identity.pubKey, skill: 'lists.addToList', constraints: { role: 'surface', actingAs: ADMIN } })).toJSON();
    expect(await act('lists.addToList', { list: 'Klusjes', text: 'x' }, forged)).toMatchObject({ refusedAt: 'token' });

    // THE RED: exposed the old way (no ctxFor), the same call runs as the HOST — no person, no gate
    const [plain] = renderA2A([listsManifest], { callSkill: (a, o, x) => agent.callSkill(a, o, x) }).filter((d) => d.id === 'lists.removeList');
    const asHost = await plain.handler({ parts: [DataPart({ list: 'Reparaties' })] });
    expect(asHost.ok, 'without ctxFor a screen\'s removeList ran as the host').toBe(true);
  }, 120_000);
});
