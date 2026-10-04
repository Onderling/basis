/**
 * The Telegram menu button: the bot hands Telegram its commands, so the "Menu" button beside the typing box lists them.
 * The list is the one `/help` reads (the catalogue scoped to a role), worded in the person's language. Everyone's
 * private chat gets the member's list, in Dutch and in English (Telegram picks by the person's app language); a person
 * whose role is not member (the admin, a coordinator, an observer) gets their own list on their own chat, in the
 * language they chose. A role change publishes again; a chat that no longer needs its own list goes back to the default.
 */
import { describe, it, expect } from 'vitest';
import { botCommandList, createCommandMenus } from '../src/v2/botCommandMenu.js';
import { composeAssistantCatalogue } from '../src/telegram/assistantCatalogue.js';
import { scopeCatalogueToRole } from '../src/v2/botOpMap.js';
import { createBotUsers } from '../src/v2/botUsers.js';
import nl from '../src/locales/circle.nl.json' with { type: 'json' };
import en from '../src/locales/circle.en.json' with { type: 'json' };

const tr = (k, p, lng) => { const v = k.split('.').slice(1).reduce((o, x) => o?.[x], lng === 'en' ? en : nl); const s = typeof v === 'string' ? v : (v?.text ?? k); return s.replace(/\{\{(\w+)\}\}/g, (_, n) => String(p?.[n] ?? '')); };
const { catalogue } = composeAssistantCatalogue({ apps: ['lists', 'tasks', 'calendar'], slim: true });

describe('the command list Telegram shows', () => {
  it('names Telegram takes (a-z, 0-9, _; at most 32), each with the help line in the language asked', () => {
    const list = botCommandList({ catalogue: scopeCatalogueToRole(catalogue, 'member'), t: (k, p) => tr(k, p, 'nl') });
    expect(list.length).toBeGreaterThan(3);
    expect(list.length).toBeLessThanOrEqual(100);
    for (const c of list) {
      expect(c.command).toMatch(/^[a-z0-9_]{1,32}$/);
      expect(c.description.length).toBeGreaterThan(2);
      expect(c.description.length).toBeLessThanOrEqual(256);
    }
    expect(list.map((c) => c.command)).toContain('instellingen');
    const enList = botCommandList({ catalogue: scopeCatalogueToRole(catalogue, 'member'), t: (k, p) => tr(k, p, 'en') });
    expect(enList.find((c) => c.command === 'instellingen').description).not.toBe(list.find((c) => c.command === 'instellingen').description);
  });

  it('a member is not shown the admin commands', () => {
    const member = botCommandList({ catalogue: scopeCatalogueToRole(catalogue, 'member'), t: (k) => tr(k) }).map((c) => c.command);
    const admin = botCommandList({ catalogue: scopeCatalogueToRole(catalogue, 'admin'), t: (k) => tr(k) }).map((c) => c.command);
    expect(admin).toContain('huishouden');
    expect(member).not.toContain('huishouden');
  });
});

describe('publishing the lists', () => {
  const setup = (users) => {
    const sets = [];
    const menus = createCommandMenus({
      setCommands: async (commands, opts = {}) => { sets.push({ n: commands.length, commands: commands.map((c) => c.command), ...opts }); },
      catalogue: () => catalogue, scopeToRole: scopeCatalogueToRole,
      users: async () => users, langOf: (id) => (id === 'telegram:9' ? 'en' : null), t: tr, lang: 'nl',
    });
    return { sets, menus };
  };

  it('the default in Dutch and English; the admin on their own chat in their language', async () => {
    const { sets, menus } = setup([{ id: 'telegram:9', channel: 'telegram', uid: '9', role: 'admin' }, { id: 'telegram:7', channel: 'telegram', uid: '7', role: 'member' }, { id: 'web-x', channel: 'web', role: 'coordinator' }]);
    await menus.publish();
    expect(sets.filter((s) => !s.chatId).map((s) => s.languageCode ?? 'default')).toEqual(['default', 'en']);
    const own = sets.filter((s) => s.chatId);
    expect(own.map((s) => s.chatId)).toEqual(['9']);   // the member keeps the default; a web person has no Telegram chat
    expect(own[0].commands).toContain('huishouden');
    expect(sets.find((s) => !s.chatId && !s.languageCode).commands).not.toContain('huishouden');
  });

  it('a chat that no longer needs its own list is cleared', async () => {
    const users = [{ id: 'telegram:5', channel: 'telegram', uid: '5', role: 'coordinator' }];
    const { sets, menus } = setup(users);
    await menus.publish();
    expect(sets.some((s) => s.chatId === '5' && !s.clear)).toBe(true);
    users[0].role = 'member';
    sets.length = 0;
    await menus.publish();
    expect(sets.filter((s) => s.chatId)).toEqual([expect.objectContaining({ chatId: '5', clear: true })]);
  });
});

describe('the people tell the menus when someone comes, goes or gets another role', () => {
  it('admit (new or back), setRole and revoke each say so; a name change alone does not', async () => {
    const rows = new Map();
    const store = { get: async (id) => rows.get(id) ?? null, put: async (r) => { rows.set(r.id, r); return r; }, list: async () => [...rows.values()] };
    let n = 0;
    const users = createBotUsers({ store, adminUid: '9', onChange: () => { n += 1; } });
    await users.admit({ channel: 'telegram', uid: '9' });
    await users.admit({ channel: 'telegram', uid: '7', displayName: 'Bert' });
    expect(n).toBe(2);
    await users.admit({ channel: 'telegram', uid: '7', displayName: 'Bertje' });
    expect(n).toBe(2);
    await users.setRole('telegram:7', 'coordinator');
    await users.revoke('telegram:7');
    await users.admit({ channel: 'telegram', uid: '7' });
    expect(n).toBe(5);
  });
});
