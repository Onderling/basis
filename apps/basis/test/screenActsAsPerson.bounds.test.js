/**
 * What a connected screen on a household bot can NOT do (Fable's review of the screen binding): it acts as its person
 * and nothing more. Through the real path — the kernel's token check, then the registered skill — with the bot
 * composed as the box composes it: the door's call (`withAssistantOps` over the host gate), the bot's book, the
 * screen exposure over `renderA2A` with `ctxFor`. Each case is one way a screen (someone else's code) could try to
 * reach further: another circle, another person's args, someone else's token, a token it made itself, a revoked or
 * demoted person, a household setting, a withheld op, a replaced skill, a book that fails. (The same over a real relay
 * between two processes runs with the box's own screen wiring, where the runner composes it.)
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { randomBytes } from 'node:crypto';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { VaultNodeFs, VaultMemory } from '@onderling/vault';
import { CapabilityToken, DataPart, AgentIdentity } from '@onderling/core';
import { renderA2A, NEVER_DELEGABLE } from '@onderling/app-manifest';
import { createRealHouseholdAgent } from '../src/core/agent/realAgent.js';
import { ensureHouseholdLists } from '../src/v2/householdTemplate.js';
import { botOpLevel, botRoleAllows } from '../src/v2/botOpMap.js';
import { withAssistantOps } from '../src/v2/assistantOps.js';
import { createBotUsers, contactBookStore } from '../src/v2/botUsers.js';
import { screenActsAs, BOT_SCREEN_NEVER } from '../src/v2/screenActing.js';
import { listsManifest } from '../../lists/manifest.js';
import { calendarManifest } from '../../calendar/manifest.js';
import { assistantManifest } from '../src/v2/assistantManifest.js';
import { EventLog } from '../src/eventLog.js';
import { createBotThreads, memoryThreadStore } from '../src/v2/botThreads.js';

const NAMES = { 'circle.lists.template.shopping': 'Boodschappen', 'circle.lists.template.chores': 'Klusjes', 'circle.lists.template.repairs': 'Reparaties', 'circle.lists.template.schedule': 'Agenda' };
const t = (k, vars) => NAMES[k] ?? (vars ? `${k} ${JSON.stringify(vars)}` : k);
const MEMBER = 'telegram:1';
const BERT = 'telegram:2';
const ADMIN = 'telegram:9';
const OTHER = 'pair-2';   // a second circle on the bot (a pair circle today; every circle the bot joins later)
const SNEAKY = { actor: ADMIN, caller: ADMIN, threadId: ADMIN, createdBy: ADMIN };
const holders = (i) => [...(i?.assignees ?? []), i?.assignee, i?.createdBy, i?.author].filter(Boolean);

describe('a screen acts as its person, and no further', () => {
  let dir; let agent; let own; let threads; let users; let bot; let view; let failBook = false;
  // the bot's own tokens come from its own grants (on the lane, as `/scherm` mints them); any other issuer signs directly
  const mint = async (skill, constraints, issuer = null, subject = view.pubKey, extra = {}) => {
    if (!issuer) {
      const r = await own('household', 'grantSurface', { viewPubKey: subject, ops: [skill], ...(constraints?.actingAs ? { actingAs: constraints.actingAs } : {}) });
      return r.tokens[0];
    }
    return (await CapabilityToken.issue(issuer, { subject, agentId: bot.identity.pubKey, skill, constraints, ...extra })).toJSON();
  };
  const act = async (skillId, args, token, from = view) => {
    try { await bot.policyEngine.checkInbound({ peerPubKey: from.pubKey, skillId, token }); } catch (e) { return { refusedAt: 'token', code: e?.code, message: e?.message }; }
    return bot.skills.get(skillId).handler({ parts: [DataPart(args)], envelope: { payload: { _token: token } } });
  };
  const asMember = async (skill, args) => act(skill, args, await mint(skill, { role: 'surface', actingAs: MEMBER }));
  const items = () => agent.householdItems();
  const otherEntries = async (list) => (await own('lists', 'listEntries', { list, circleId: OTHER }));

  beforeAll(async () => {
    dir = await mkdtemp(path.join(tmpdir(), 'bot-screen-bounds-'));
    const pass = randomBytes(32).toString('base64url');
    await writeFile(path.join(dir, 'vault.passphrase'), pass, { mode: 0o600 });
    agent = await createRealHouseholdAgent({
      ownerRootVault: new VaultNodeFs(path.join(dir, 'vault.json'), pass), chatVault: new VaultNodeFs(path.join(dir, 'chat-vault.json'), pass),
      householdPersistDb: { path: path.join(dir, 'household-items.json') }, seedDemoData: false, seedHousehold: false,
      tasksCircleId: 'household', calendarInCircle: true, doorOpLevel: botOpLevel, doorRoleAllows: botRoleAllows, trustOwnGrants: true, t,
    });
    own = (a, o, x) => agent.callSkill(a, o, x);
    await ensureHouseholdLists({ callSkill: own, t });
    for (const [webid, role] of [[MEMBER, 'member'], [BERT, 'member'], [ADMIN, 'admin']]) { await own('stoop', 'addContact', { webid, channel: 'telegram', role }); await agent.setDoorCaller(webid, role); }
    await own('stoop', 'setContactName', { webid: BERT, name: 'Bert' }).catch(() => {});
    threads = createBotThreads({ eventLog: new EventLog({ initial: [], muted: [] }), store: memoryThreadStore() });
    await threads.load();
    const doorCall = withAssistantOps({ callSkill: (a, o, x, ctx) => agent.callSkill(a, o, x, ctx), threads, t, refusal: agent.doorRefusal, admin: {} });
    const book = createBotUsers({ store: contactBookStore(own) });
    users = { list: async () => { if (failBook) throw new Error('book unreadable'); return book.list(); }, revoke: (w) => book.revoke(w) };
    agent.exposeToPeers(renderA2A([listsManifest, calendarManifest, assistantManifest], { callSkill: doorCall }, { ctxFor: screenActsAs(users, { activeEntry: (id) => agent.surfaceTokenEntry(id) }), never: BOT_SCREEN_NEVER }));
    bot = agent.sa.agent;
    view = await AgentIdentity.generate(new VaultMemory());
    await agent.sa.trust?.setTier?.(view.pubKey, 'authenticated');

    // a second circle on the bot, with a list and an entry of its own (the host, which may name any circle)
    await own('lists', 'createList', { text: 'Geheim', circleId: OTHER });
    await own('lists', 'addToList', { list: 'Geheim', text: 'sleutel', circleId: OTHER });
  }, 120_000);
  afterAll(async () => { await agent?.stop?.().catch(() => {}); if (dir) await rm(dir, { recursive: true, force: true }).catch(() => {}); });

  it('the second circle is really there (the host reaches it by name)', async () => {
    expect(JSON.stringify(await otherEntries('Geheim'))).toContain('sleutel');
    expect((await items()).some((i) => i.text === 'sleutel'), 'the second circle is not the household').toBe(false);
  });

  it('another circle by args: the household, never the other one (circleId and groupId alike; reads too)', async () => {
    for (const key of ['circleId', 'groupId']) {
      const before = JSON.stringify(await otherEntries('Geheim'));
      const into = await asMember('lists.addToList', { list: 'Geheim', text: `inbraak-${key}`, [key]: OTHER });
      expect(into, `${key}: the household has no list Geheim`).toMatchObject({ ok: false, error: expect.stringContaining('no_such_list') });
      expect(JSON.stringify(await otherEntries('Geheim')), `${key}: the other circle is unchanged`).toBe(before);
      const r = await asMember('lists.addToList', { list: 'Boodschappen', text: `melk-${key}`, [key]: OTHER });
      expect(r.ok, JSON.stringify(r)).toBe(true);
      expect((await items()).some((i) => i.text === `melk-${key}`), `${key}: it landed in the household`).toBe(true);
      const read = await asMember('lists.listEntries', { list: 'Geheim', [key]: OTHER });
      expect(read, `${key}: no read of the other circle`).toMatchObject({ ok: false, error: expect.stringContaining('no_such_list') });
    }
  });

  it('undeclared args are dropped: an entry, a chore, an appointment and the overview are the token\'s person\'s', async () => {
    expect((await asMember('lists.addToList', { list: 'Boodschappen', text: 'kaas', ...SNEAKY })).ok).toBe(true);
    expect((await asMember('lists.addToList', { list: 'Klusjes', text: 'ramen', assignee: 'mij', ...SNEAKY })).ok).toBe(true);
    const day = new Date(Date.now() + 2 * 86_400_000).toISOString().slice(0, 10);
    expect((await asMember('calendar.addEvent', { title: 'tandarts', when: `${day}T10:00`, ...SNEAKY })).ok).toBe(true);
    const all = await items();
    for (const text of ['kaas', 'ramen']) {
      const it = all.find((i) => i.text === text);
      expect(holders(it), `${text} is not the admin's`).not.toContain(ADMIN);
    }
    expect(holders(all.find((i) => i.text === 'ramen'))).toContain(MEMBER);
    const appt = all.find((i) => i.type === 'calendar-event' && /tandarts/.test(JSON.stringify(i)));
    expect(JSON.stringify(appt), 'the appointment does not name the admin').not.toContain(ADMIN);
    // the overview switch lands on the member's thread row; the admin's row is unchanged
    expect(threads.overviewOn(ADMIN)).toBe(false);
    const ov = await asMember('assistant.assistant-overview', { mode: 'on', ...SNEAKY });
    expect(ov.ok, JSON.stringify(ov)).not.toBe(false);
    expect(threads.overviewOn(MEMBER)).toBe(true);
    expect(threads.overviewOn(ADMIN), 'another person\'s thread row is unchanged').toBe(false);
  });

  it('a stolen token: the member\'s valid token from a different key is refused at the token check', async () => {
    const tok = await mint('lists.addToList', { role: 'surface', actingAs: MEMBER });
    const thief = await AgentIdentity.generate(new VaultMemory());
    await agent.sa.trust?.setTier?.(thief.pubKey, 'authenticated');
    expect(await act('lists.addToList', { list: 'Boodschappen', text: 'gestolen' }, tok, thief)).toMatchObject({ refusedAt: 'token' });
    expect((await items()).some((i) => i.text === 'gestolen')).toBe(false);
  });

  it('a token for one op used on another is refused', async () => {
    const readTok = await mint('lists.listEntries', { role: 'surface', actingAs: MEMBER });
    expect(await act('lists.addToList', { list: 'Boodschappen', text: 'verkeerd' }, readTok)).toMatchObject({ refusedAt: 'token' });
  });

  it('an admin cannot mint: a keyed admin trusted in the door\'s gate issues for a member, or for themselves → refused', async () => {
    const webAdmin = await AgentIdentity.generate(new VaultMemory());
    await agent.setDoorCaller(webAdmin.pubKey, 'admin');   // the door's person tiers: the HOST's registry
    for (const actingAs of [MEMBER, webAdmin.pubKey]) {
      const tok = await mint('lists.addToList', { role: 'surface', actingAs }, webAdmin);
      expect(await act('lists.addToList', { list: 'Boodschappen', text: 'x' }, tok), `naming ${actingAs}`).toMatchObject({ refusedAt: 'token' });
    }
  });

  it('a chained token: the screen issues a sub-token from its own valid one to a second key, naming the admin → refused', async () => {
    const parent = await mint('lists.addToList', { role: 'surface', actingAs: MEMBER });
    const second = await AgentIdentity.generate(new VaultMemory());
    await agent.sa.trust?.setTier?.(second.pubKey, 'authenticated');
    const child = await mint('lists.addToList', { role: 'surface', actingAs: ADMIN }, view, second.pubKey, { parentId: parent.id });
    expect(await act('lists.addToList', { list: 'Boodschappen', text: 'keten' }, child, second)).toMatchObject({ refusedAt: 'token' });
  });

  it('the settings bind as typed: names, assign, cancel', async () => {
    await own('params', 'set-param', { key: 'assistant.names', value: 'admin' });
    const named = await asMember('lists.addToList', { list: 'Klusjes', text: 'stofzuigen', assignee: 'Bert' });
    expect(named.refusal).toEqual({ layer: 'door-settings', code: 'setting:names' });
    await own('params', 'set-param', { key: 'assistant.names', value: 'members' });
    await own('params', 'set-param', { key: 'assistant.assignPolicy', value: 'self' });
    const assigned = await asMember('lists.addToList', { list: 'Klusjes', text: 'dweilen', assignee: BERT });
    expect(assigned.refusal).toEqual({ layer: 'door-settings', code: 'setting:assign' });
    await own('params', 'set-param', { key: 'assistant.assignPolicy', value: 'roles' });
    const day = new Date(Date.now() + 3 * 86_400_000).toISOString().slice(0, 10);
    expect((await asMember('calendar.addEvent', { title: 'kapper', when: `${day}T11:00` })).ok).toBe(true);
    await own('params', 'set-param', { key: 'assistant.cancelPolicy', value: 'admin' });
    const cancel = await asMember('calendar.cancelEvent', { id: 'kapper' });
    expect(cancel.refusal).toEqual({ layer: 'door-settings', code: 'setting:cancel' });
    await own('params', 'set-param', { key: 'assistant.cancelPolicy', value: 'own' });
    expect((await items()).some((i) => i.type === 'calendar-event' && /kapper/.test(JSON.stringify(i)) && !i.cancelled && i.status !== 'cancelled'), 'the appointment stands').toBe(true);
  });

  it('withheld means withheld: every shell- and kernel-withheld op, with a token the bot itself minted → refused', async () => {
    const exposed = new Set(renderA2A([listsManifest, calendarManifest, assistantManifest], { callSkill: async () => ({}) }).map((d) => d.id));
    const ids = [...BOT_SCREEN_NEVER, ...[...NEVER_DELEGABLE].filter((id) => exposed.has(id))];
    for (const id of ids) {
      expect(bot.skills.get(id)?.policy ?? bot.skills.get(id)?.meta?.policy, `${id} is withheld`).toBe('never');
      expect(await act(id, {}, await mint(id, { role: 'surface', actingAs: ADMIN })), id).toMatchObject({ refusedAt: 'token' });
    }
  });

  it('no replacing: exposing an id that is already registered throws; the earlier skill still answers', async () => {
    const before = bot.skills.get('lists.addToList').handler;
    const replacement = [{ id: 'lists.addToList', handler: async () => ({ ok: true, replaced: true }), policy: 'requires-token' }];
    expect(() => agent.exposeToPeers(replacement)).toThrow(/already registered/);
    expect(bot.skills.get('lists.addToList').handler).toBe(before);
    expect((await asMember('lists.addToList', { list: 'Boodschappen', text: 'nog-steeds' })).replaced).toBeUndefined();
  });

  it('demoted: member → observer, an add token still verifies, the door-role check refuses; a read still works', async () => {
    await own('stoop', 'setContactRole', { webid: MEMBER, role: 'observer' }).catch(() => {});
    await agent.setDoorCaller(MEMBER, 'observer');
    const add = await asMember('lists.addToList', { list: 'Boodschappen', text: 'als-kijker' });
    expect(add.refusedAt, 'the token verified').toBeUndefined();
    expect(add.refusal).toEqual({ layer: 'door-role', code: 'role' });
    expect((await asMember('lists.listEntries', { list: 'Boodschappen' })).ok).not.toBe(false);
    await own('stoop', 'setContactRole', { webid: MEMBER, role: 'member' }).catch(() => {});
    await agent.setDoorCaller(MEMBER, 'member');
  });

  it('the lane is the allow-list: a token signed with the bot\'s own key but never granted, or one dropped, acts as nobody', async () => {
    const offLane = (await CapabilityToken.issue(bot.identity, { subject: view.pubKey, agentId: bot.identity.pubKey, skill: 'lists.addToList', constraints: { role: 'surface', actingAs: MEMBER } })).toJSON();
    // refused already at the token check (the door allows only surface tokens active on the lane); `screenActsAs`
    // would refuse it too, as `not-bound`
    expect(await act('lists.addToList', { list: 'Boodschappen', text: 'naast-de-lijn' }, offLane)).toMatchObject({ refusedAt: 'token' });
    const granted = await mint('lists.addToList', { role: 'surface', actingAs: MEMBER });
    expect((await act('lists.addToList', { list: 'Boodschappen', text: 'wel-gegeven' }, granted)).ok).toBe(true);
    await own('household', 'revokeSurface', { viewPubKey: view.pubKey });
    const after = await act('lists.addToList', { list: 'Boodschappen', text: 'na-los' }, granted);
    expect(after.ok, JSON.stringify(after)).not.toBe(true);
    expect((await items()).some((i) => ['naast-de-lijn', 'na-los'].includes(i.text))).toBe(false);
  });

  it('the book fails: the call fails, nothing runs as the host', async () => {
    failBook = true;
    try {
      const tok = await mint('lists.addToList', { role: 'surface', actingAs: MEMBER });
      await expect(act('lists.addToList', { list: 'Boodschappen', text: 'zonder-boek' }, tok)).rejects.toThrow(/book/);
    } finally { failBook = false; }
    expect((await items()).some((i) => i.text === 'zonder-boek')).toBe(false);
  });

  it('revoked: the person (/revoke) → not-bound; the token → refused at the token check', async () => {
    const tok = await mint('lists.addToList', { role: 'surface', actingAs: MEMBER });
    expect((await act('lists.addToList', { list: 'Boodschappen', text: 'voor' }, tok)).ok).toBe(true);
    await agent.agentsTokenRegistry.revoke(tok.id);
    expect(await act('lists.addToList', { list: 'Boodschappen', text: 'na-token' }, tok)).toMatchObject({ refusedAt: 'token' });
    await users.revoke(MEMBER);
    expect(await asMember('lists.addToList', { list: 'Boodschappen', text: 'na-persoon' })).toMatchObject({ ok: false, error: 'not-bound' });
  });

});
