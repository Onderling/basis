/**
 * `/kring` and `/kringen` through the bot's door: the admin's own ops (the host gate refuses a member before anything
 * is read), the invite taken only in the admin's PRIVATE chat, the question there, `/kring ja <id>` joins, `/kring los`
 * leaves. And from a screen, `/kring` is held for a yes in the private chat (the op declares the step-up).
 */
import { describe, it, expect } from 'vitest';
import { withAssistantOps } from '../src/v2/assistantOps.js';
import { createBotUsers } from '../src/v2/botUsers.js';
import { createBotCircles } from '../src/v2/botCircles.js';
import { assistantManifest } from '../src/v2/assistantManifest.js';

const t = (k, p) => (p ? `${k} ${JSON.stringify(p)}` : k);
const ADMIN = 'telegram:1';
const MEMBER = 'telegram:7';
const PRIVATE = { caller: ADMIN, threadId: ADMIN, chatId: '1' };
const GROUP = { caller: ADMIN, threadId: ADMIN, chatId: '-100777' };
const invite = `onderling-invite://${Buffer.from(JSON.stringify({ groupId: 'circle-1', code: 'C0DE', name: 'Huize Rood' })).toString('base64url')}`;

function memStore() {
  const m = new Map();
  return { get: async (id) => m.get(id) ?? null, put: async (row) => { m.set(row.id, { ...row }); return row; }, list: async () => [...m.values()], hide: async (id) => { const r = m.get(id); if (r) m.set(id, { ...r, hidden: true }); }, remove: async (id) => { m.delete(id); } };
}

async function door() {
  const users = createBotUsers({ store: memStore() });
  await users.admit({ channel: 'telegram', uid: '1', displayName: 'Frits' });
  await users.admit({ channel: 'telegram', uid: '7', displayName: 'Bert' });
  await users.setRole('Frits', 'admin');
  const asked = []; const joins = [];
  const circles = createBotCircles({
    store: memStore(),
    join: async (a) => { joins.push(a); return { ok: true, circleId: 'circle-1' }; },
    leave: async () => ({ ok: true }), forget: async () => ({ ok: true }),
    ask: async (person, q) => { asked.push({ person, ...q }); return { ok: true }; },
    handle: () => 'huisbot-van-frits',
  });
  const roles = new Map([[ADMIN, 'admin'], [MEMBER, 'member']]);
  const level = (op) => assistantManifest.operations.find((o) => o.id === op)?.visibility ?? 'authenticated';
  const refusal = async (op, caller, lvl = level(op)) => (lvl === 'trusted' && roles.get(caller) !== 'admin' ? { layer: 'tier', code: 'tier-denied' } : null);
  const held = [];
  const call = withAssistantOps({
    callSkill: async () => ({}), t, refusal, threads: { langOf: () => null },
    admin: { users: async () => users.list(), circles, stepUp: { hold: async (p, req) => { held.push(req); return { ok: true }; } } },
  });
  return { call, asked, joins, held };
}

describe('/kring at the bot\'s door', () => {
  it('a member: refused at the gate, nothing asked', async () => {
    const d = await door();
    const r = await d.call('assistant', 'assistant-circle', { spec: invite }, { caller: MEMBER, threadId: MEMBER, chatId: '7' });
    expect(r.ok).toBe(false);
    expect(r.refusal).toBeTruthy();
    expect((await d.call('assistant', 'assistant-circles', {}, { caller: MEMBER, threadId: MEMBER, chatId: '7' })).ok).toBe(false);
    expect(d.asked).toEqual([]);
  });

  it('the admin in a group: refused, nothing asked', async () => {
    const d = await door();
    const r = await d.call('assistant', 'assistant-circle', { spec: invite }, GROUP);
    expect(r.ok).toBe(false);
    expect(r.error.code).toBe('not-private');
    expect(d.asked).toEqual([]);
  });

  it('the admin in private: asked; `/kring ja <id>` joins; `/kringen` lists; `/kring los` leaves', async () => {
    const d = await door();
    expect(await d.call('assistant', 'assistant-circle', { spec: invite }, PRIVATE)).toMatchObject({ ok: true, message: 'circle.bot.kring_asked' });
    expect(d.asked[0].text).toContain('circle.bot.kring_question');
    expect(d.asked[0].text).toContain('Huize Rood');
    const yes = d.asked[0].buttons[0].id;
    expect(yes).toMatch(/^\/kring ja /);
    expect(d.joins).toEqual([]);
    const joined = await d.call('assistant', 'assistant-circle', { spec: yes.replace('/kring ', '') }, PRIVATE);
    expect(joined.ok).toBe(true);
    expect(joined.message).toContain('circle.bot.kring_joined');
    expect(d.joins).toHaveLength(1);
    expect((await d.call('assistant', 'assistant-circles', {}, PRIVATE)).message).toContain('Huize Rood');
    const left = await d.call('assistant', 'assistant-circle', { spec: 'los Huize Rood' }, PRIVATE);
    expect(left.message).toContain('circle.bot.kring_left');
    expect((await d.call('assistant', 'assistant-circles', {}, PRIVATE)).message).toBe('circle.bot.kringen_none');
  });

  it('`/kring nee <id>`: not joined', async () => {
    const d = await door();
    await d.call('assistant', 'assistant-circle', { spec: invite }, PRIVATE);
    const no = d.asked[0].buttons[1].id;
    expect((await d.call('assistant', 'assistant-circle', { spec: no.replace('/kring ', '') }, PRIVATE)).message).toContain('circle.bot.kring_declined');
    expect(d.joins).toEqual([]);
  });

  it('from a screen: held for the private chat\'s yes (the op declares the step-up)', async () => {
    const d = await door();
    const r = await d.call('assistant', 'assistant-circle', { spec: invite }, { caller: ADMIN, threadId: ADMIN, via: 'screen', viewPubKey: 'VIEW' });
    expect(r).toMatchObject({ ok: true, pending: true });
    expect(d.held).toEqual([expect.objectContaining({ op: 'assistant-circle' })]);
    expect(d.asked).toEqual([]);
  });
});
