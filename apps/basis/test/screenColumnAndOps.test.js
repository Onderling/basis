/**
 * The column a person's screen is granted, and the door's screen ops: a member's screen gets the member's column (no
 * admin list ops), the admin's the admin's lists column but none of the admin's own assistant ops, and neither the
 * ops a screen never gets. `/scherm` answers with the link, `/schermen` lists and drops, and revoking a person drops
 * their screens.
 */
import { describe, it, expect } from 'vitest';
import { composeAssistantCatalogue } from '../src/telegram/assistantCatalogue.js';
import { screenColumnFor, BOT_SCREEN_NEVER, SCREEN_ADMIN_OPS } from '../src/v2/screenActing.js';
import { withAssistantOps } from '../src/v2/assistantOps.js';
import { createBotThreads, memoryThreadStore } from '../src/v2/botThreads.js';
import { EventLog } from '../src/eventLog.js';

const { catalogue } = composeAssistantCatalogue({ apps: ['lists', 'tasks', 'calendar'], slim: true });

describe('the screen column', () => {
  it('a member: their ops, no admin list ops; the admin: the lists column, none of the admin\'s assistant ops', () => {
    const member = screenColumnFor(catalogue, 'member');
    const adminCol = screenColumnFor(catalogue, 'admin');
    expect(member).toContain('lists.addToList');
    expect(member).toContain('assistant.assistant-overview');
    expect(member).not.toContain('lists.removeList');
    expect(adminCol).toContain('lists.removeList');
    for (const col of [member, adminCol]) {
      for (const id of BOT_SCREEN_NEVER) expect(col).not.toContain(id);
      // /apps stays in the chat; import never
      expect(col.filter((id) => ['apps', 'import'].some((w) => id === `assistant.assistant-${w}`))).toEqual([]);
    }
    // what admits people, removes them or changes what they may do: on the admin's screen (held for the chat yes), not a member's
    const held = ['invite', 'cohort', 'role', 'revoke', 'rotate'].map((w) => `assistant.assistant-${w}`);
    for (const id of held) { expect(adminCol).toContain(id); expect(member).not.toContain(id); }
    // the admin's screen: the reads, the household's settings and an export now (Fable's list); a member's: none of them
    for (const id of SCREEN_ADMIN_OPS) { expect(adminCol).toContain(id); expect(member).not.toContain(id); }
    // no role (not in the book): nothing, never a default column
    expect(screenColumnFor(catalogue, null)).toEqual([]);
    const observer = screenColumnFor(catalogue, 'observer');
    expect(observer).not.toContain('lists.addToList');
    expect(observer).toContain('lists.listEntries');
  });
});

describe('the door\'s screen ops', () => {
  const t = (k, p) => (p ? `${k} ${JSON.stringify(p)}` : k);
  const threads = createBotThreads({ eventLog: new EventLog({ initial: [], muted: [] }), store: memoryThreadStore() });
  const dropped = [];
  const privately = [];
  const screens = {
    start: async (_person, text) => { privately.push(text('https://basis.example/#scherm=abc', 10)); return { ok: true, until: Date.now() + 600_000 }; },
    list: async () => [{ viewPubKey: 'A', label: 'laptop', ops: ['x', 'y'] }],
    drop: async (_p, n) => (n === 1 ? { ok: true } : { ok: false, reason: 'no-such-screen' }),
    dropAll: async (p) => { dropped.push(p); return 2; },
  };
  const call = withAssistantOps({ callSkill: async () => ({ ok: true }), threads, t, refusal: async () => null, admin: { screens, revoke: async () => ({ id: 'telegram:2', displayName: 'Bert' }) } });
  const as = (op, args = {}) => call('assistant', op, args, { caller: 'telegram:1', threadId: 'telegram:1' });

  it('/scherm sends the link privately and says so where it was asked; /schermen lists, drops one, says when there is none', async () => {
    const r = await as('assistant-screen');
    expect(r.message).toContain('screen_sent_privately');
    expect(r.message).not.toContain('#scherm=');
    expect(privately.at(-1)).toContain('#scherm=abc');
    expect((await as('assistant-screens')).message).toContain('laptop');
    expect((await as('assistant-screens', { change: 'los 1' })).message).toContain('screen_dropped');
    expect((await as('assistant-screens', { change: 'los 3' })).error.code).toBe('no-such-screen');
  });

  it('revoking a person drops their screens, and says so', async () => {
    const r = await call('assistant', 'assistant-revoke', { who: 'Bert' }, { caller: 'telegram:9', threadId: 'telegram:9' });
    expect(dropped).toEqual(['telegram:2']);
    expect(r.message).toContain('revoked_screens');
  });
});
