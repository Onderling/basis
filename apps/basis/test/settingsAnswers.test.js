/**
 * A setting's answer is the menu as it now stands: after `/huishouden names admin` the bot says it saved and shows the
 * settings with the new value ticked (buttons in the chat and on a screen), never the long list of raw words. And the
 * language answers with the language's name ("Nederlands"), not its code.
 */
import { describe, it, expect } from 'vitest';
import { withAssistantOps } from '../src/v2/assistantOps.js';
import { createBotThreads, memoryThreadStore } from '../src/v2/botThreads.js';
import { EventLog } from '../src/eventLog.js';
import nl from '../src/locales/circle.nl.json' with { type: 'json' };
import en from '../src/locales/circle.en.json' with { type: 'json' };

const tr = (k, p, lng) => { const v = k.split('.').slice(1).reduce((o, x) => o?.[x], lng === 'en' ? en : nl); const s = typeof v === 'string' ? v : (v?.text ?? k); return s.replace(/\{\{(\w+)\}\}/g, (_, n) => String(p?.[n] ?? '')); };
const ADMIN = 'telegram:9';

function door() {
  const threads = createBotThreads({ eventLog: new EventLog({ initial: [], muted: [] }), store: memoryThreadStore() });
  const params = new Map();
  const callSkill = async (app, op, args) => {
    if (app === 'params' && op === 'list-user-params') return { ok: true, params: [...params].map(([key, value]) => ({ key, value })) };
    if (app === 'params' && op === 'set-param') { params.set(args.key, args.value); return { ok: true }; }
    return { ok: true };
  };
  const users = [{ id: ADMIN, channel: 'telegram', uid: '9', role: 'admin' }];
  const call = withAssistantOps({ callSkill, threads, t: tr, refusal: async () => null, admin: { users: async () => users, screens: { list: async () => [] } } });
  return (op, args) => call('assistant', op, args, { caller: ADMIN, threadId: ADMIN, chatId: '9' });
}

describe('a setting answers with the menu as it now stands', () => {
  it('/huishouden names admin: saved, then the menu with the new value ticked', async () => {
    const r = await door()('assistant-settings', { change: 'names admin' });
    expect(r.ok).toBe(true);
    expect(r.message.split('\n')[0]).toBe(tr('circle.bot.settings_saved'));
    expect(r.message).toContain(`${tr('circle.bot.menu_names')}: ${tr('circle.bot.value_admin')}`);
    expect(r.message).not.toContain('(members: iedereen');
    expect(r.quickReplies.map((b) => b.label)).toContain(`${tr('circle.bot.menu_names')}: ${tr('circle.bot.value_admin')} ✓`);
  });

  it('the lead and the days: the menu too', async () => {
    const d = door();
    const r = await d('assistant-settings', { change: 'lead 15' });
    expect(r.quickReplies.map((b) => b.label)).toContain(`${tr('circle.bot.menu_lead')}: ${tr('circle.bot.value_lead_min', { n: 15 })} ✓`);
  });

  it('the bare /huishouden still explains every value in words', async () => {
    const r = await door()('assistant-settings', {});
    expect(r.message).toContain('(members: iedereen');
  });

  it('/taal: the language by its name', async () => {
    const d = door();
    expect((await d('assistant-language', { lang: 'nl' })).message).toBe(tr('circle.bot.lang_set', { lang: 'Nederlands' }));
    expect((await d('assistant-language', { lang: 'en' })).message).toBe(tr('circle.bot.lang_set', { lang: 'English' }, 'en'));
  });
});
