/**
 * What the bot's model use costs, counted per calendar month: each person's own calls on their own thread row, the
 * household's total on its own row. A person sees their own count (`/verbruik`); the household's total is the admin's
 * (`/status`, and `/verbruik` for them), and everyone's only when the admin says so (`/huishouden usage members`). Never
 * one person's count to another: the total is the only number that crosses people.
 */
import { describe, it, expect } from 'vitest';
import { createBotThreads, memoryThreadStore } from '../src/v2/botThreads.js';
import { EventLog } from '../src/eventLog.js';
import { withAssistantOps } from '../src/v2/assistantOps.js';
import { monthOf } from '../src/v2/botUsage.js';
import nl from '../src/locales/circle.nl.json' with { type: 'json' };

const tr = (k, p) => { const v = k.split('.').slice(1).reduce((o, x) => o?.[x], nl); const s = typeof v === 'string' ? v : (v?.text ?? k); return s.replace(/\{\{(\w+)\}\}/g, (_, n) => String(p?.[n] ?? '')); };
const OCT = Date.UTC(2026, 9, 5);
const NOV = Date.UTC(2026, 10, 2);
const call = (prompt, cached, completion = 20) => ({ promptTokens: prompt, cachedPromptTokens: cached, completionTokens: completion });

const threadsWith = () => createBotThreads({ eventLog: new EventLog({ initial: [], muted: [] }), store: memoryThreadStore() });

describe('counting, per month', () => {
  it('a person\'s calls on their row, every call in the household\'s total; a new month starts at zero', () => {
    const th = threadsWith();
    th.addUsage('telegram:1', call(3000, 2700), OCT);
    th.addUsage('telegram:1', call(3000, 2800), OCT);
    th.addUsage('telegram:2', call(3100, 0), OCT);
    th.addUsage(null, call(500, 0), OCT);   // a call no person made (the box's own)
    expect(th.usageOf('telegram:1', OCT)).toEqual({ month: '2026-10', calls: 2, prompt: 6000, cached: 5500, completion: 40 });
    expect(th.householdUsage(OCT)).toMatchObject({ calls: 4, prompt: 9600, cached: 5500 });
    expect(th.usageOf('telegram:1', NOV)).toEqual({ month: '2026-11', calls: 0, prompt: 0, cached: 0, completion: 0 });
    expect(th.householdUsage(NOV).calls).toBe(0);
    expect(monthOf(OCT)).toBe('2026-10');
  });
});

function bot({ visible = null, now = OCT } = {}) {
  const threads = threadsWith();
  const params = new Map(visible ? [['assistant.usageVisible', visible]] : []);
  const callSkill = async (app, op, args) => {
    if (app === 'params' && op === 'list-user-params') return { ok: true, params: [...params].map(([key, value]) => ({ key, value })) };
    if (app === 'params' && op === 'set-param') { params.set(args.key, args.value); return { ok: true }; }
    return { ok: true };
  };
  const users = [{ id: 'telegram:9', channel: 'telegram', uid: '9', role: 'admin' }, { id: 'telegram:1', channel: 'telegram', uid: '1', role: 'member' }];
  const door = withAssistantOps({ callSkill, threads, t: tr, refusal: async () => null, now: () => now, admin: { users: async () => users, status: async () => ({ model: 'glm-5.3' }) } });
  threads.addUsage('telegram:1', call(3000, 2700), OCT);
  threads.addUsage('telegram:9', call(4000, 1000), OCT);
  const as = (who) => (op, args = {}) => door('assistant', op, args, { caller: who, threadId: who, chatId: who.split(':')[1] });
  return { as, threads, params };
}

describe('/verbruik: your own count, and the household\'s when you may see it', () => {
  it('a member sees their own count only — never the total, never another\'s', async () => {
    const r = await bot().as('telegram:1')('assistant-usage');
    expect(r.ok).toBe(true);
    expect(r.message).toContain(tr('circle.bot.usage_you', { calls: 1, tokens: '3.000', cached: 90 }));
    expect(r.message).not.toContain('7.000');   // the household's prompt tokens
    expect(r.message).not.toContain('4.000');   // the admin's
  });
  it('with the admin\'s word (usage members) a member sees the household total too', async () => {
    const r = await bot({ visible: 'members' }).as('telegram:1')('assistant-usage');
    expect(r.message).toContain(tr('circle.bot.usage_household', { calls: 2, tokens: '7.000', cached: 53, limit: '1.000.000', share: 1 }));
  });
  it('the admin sees their own and the total; /status carries the month too', async () => {
    const b = bot();
    const r = await b.as('telegram:9')('assistant-usage');
    expect(r.message).toContain(tr('circle.bot.usage_you', { calls: 1, tokens: '4.000', cached: 25 }));
    expect(r.message).toContain(tr('circle.bot.usage_household', { calls: 2, tokens: '7.000', cached: 53, limit: '1.000.000', share: 1 }));
    expect((await b.as('telegram:9')('assistant-status')).message).toContain(tr('circle.bot.usage_household', { calls: 2, tokens: '7.000', cached: 53, limit: '1.000.000', share: 1 }));
  });
  it('the setting is the household\'s, on the admin\'s menu: who sees the total (admin · members)', async () => {
    const b = bot();
    const r = await b.as('telegram:9')('assistant-settings', { change: 'usage members' });
    expect(r.ok).toBe(true);
    expect(b.params.get('assistant.usageVisible')).toBe('members');
    expect(r.quickReplies.map((q) => q.label)).toContain(`${tr('circle.bot.menu_usage')}: ${tr('circle.bot.value_members')} ✓`);
  });
});
