/**
 * `/instellingen` on the household bot: one row per settings op the person's role reaches, with the value it has now and
 * a button per other value that calls that op through its own gate. A member sees their own switches; the admin also
 * the household's (`/huishouden`). How it is painted is the person's view (`/weergave`): buttons (default), a pointer
 * to their connected screen, or words — and the inbox door always in words. Through the real Telegram runner.
 */
import { describe, it, expect } from 'vitest';
import { InMemoryBridge } from '@onderling/chat-agent';
import { createTelegramRunner } from '../src/telegram/runner.js';
import { composeAssistantCatalogue } from '../src/telegram/assistantCatalogue.js';
import { withAssistantOps } from '../src/v2/assistantOps.js';
import { createBotThreads, memoryThreadStore } from '../src/v2/botThreads.js';
import { EventLog } from '../src/eventLog.js';
import nl from '../src/locales/circle.nl.json' with { type: 'json' };

const tr = (k, p) => { const v = k.split('.').slice(1).reduce((o, x) => o?.[x], nl); const s = typeof v === 'string' ? v : (v?.text ?? k); return s.replace(/\{\{(\w+)\}\}/g, (_, n) => String(p?.[n] ?? '')); };
const ANN = 'telegram:42'; const ADMIN = 'telegram:9'; const INBOX = 'web-person-key';

function bot() {
  const threads = createBotThreads({ eventLog: new EventLog({ initial: [], muted: [] }), store: memoryThreadStore() });
  const params = new Map();
  const callSkill = async (app, op, args) => {
    if (app === 'params' && op === 'list-user-params') return { ok: true, params: [...params].map(([key, value]) => ({ key, value })) };
    if (app === 'params' && op === 'set-param') { params.set(args.key, args.value); return { ok: true }; }
    return { ok: true };
  };
  const users = [{ id: ANN, channel: 'telegram', uid: '42', role: 'member' }, { id: ADMIN, channel: 'telegram', uid: '9', role: 'admin' }, { id: INBOX, channel: 'web', role: 'member' }];
  const refusal = async (_op, caller, level) => (level === 'trusted' && caller !== ADMIN ? { layer: 'door-role', code: 'role' } : null);
  const doorCall = withAssistantOps({ callSkill, threads, t: tr, refusal, admin: { users: async () => users, screens: { list: async () => [] } } });
  const { catalogue, manifestsByOrigin } = composeAssistantCatalogue({ apps: ['lists'], slim: true });
  const bridge = new InMemoryBridge({ id: 'telegram' });
  const runner = createTelegramRunner({
    bridge, catalogue, manifestsByOrigin, t: tr, callSkill: doorCall, allowedChatIds: '*', threads,
    llm: { invoke: async () => null }, interpret: async () => null, admit: async ({ uid }) => (uid === '9' ? ADMIN : ANN),
  });
  const say = async (uid, text) => {
    await runner.start?.();
    bridge.clearOutbox();
    await bridge.simulateIncoming({ chatId: uid, text, sender: { bridgeUid: uid, displayName: 'x' } });
    await runner.idle(uid);
    return bridge.outbox.at(-1) ?? {};
  };
  return { say, threads, params, doorCall };
}

describe('the settings menu', () => {
  it('a member: their own switches, values and buttons; no household rows; a tap is the op\'s own slash', async () => {
    const { say, threads } = bot();
    const r = await say('42', '/instellingen');
    expect(r.text).toContain('Herinneringen: aan');
    expect(r.text).toContain('Taal: zoals ik schrijf');
    expect(r.text).not.toContain('huishouden');
    const ids = (r.buttons ?? []).map((b) => b.id);
    expect(ids).toContain('/herinneringen off');
    expect(ids).toContain('/taal en');
    // the button of the value it has now shows it
    expect((r.buttons ?? []).find((b) => b.id === '/herinneringen on')?.label).toContain('✓');
    expect(ids.some((id) => id.startsWith('/huishouden'))).toBe(false);
    await say('42', '/herinneringen off');
    expect(threads.remindersOn(ANN)).toBe(false);
    expect((await say('42', '/instellingen')).text).toContain('Herinneringen: uit');
  });

  it('the admin: also the household\'s settings, each a /huishouden button; a member is refused /huishouden', async () => {
    const { say, params } = bot();
    const r = await say('9', '/instellingen');
    expect(r.text).toContain('Voor het hele huishouden:');
    expect(r.text).toContain('Namen zien: iedereen in huis');
    expect((r.buttons ?? []).map((b) => b.id)).toContain('/huishouden names none');
    await say('9', '/huishouden names none');
    expect(params.get('assistant.names')).toBe('none');
    const member = await say('42', '/huishouden names members');
    expect(member.text).toContain('beheerder');
  });

  it('/weergave: words, or the screen; the Dutch words; the inbox door is always words', async () => {
    const { say, threads, doorCall } = bot();
    await say('42', '/weergave chat');
    expect(threads.viewOf(ANN)).toBe('chat');
    const words = await say('42', '/instellingen');
    expect(words.buttons ?? []).toEqual([]);
    expect(words.text).toContain('herinneringen uit');
    await say('42', '/weergave scherm');
    expect(threads.viewOf(ANN)).toBe('screen');
    expect((await say('42', '/instellingen')).text).toContain('/scherm');
    await say('42', '/weergave knoppen');
    expect(threads.viewOf(ANN)).toBe('inline');
    const inbox = await doorCall('assistant', 'assistant-menu', {}, { caller: INBOX, threadId: INBOX });
    expect(inbox.quickReplies).toBeUndefined();
    expect(inbox.message).toContain('herinneringen uit');
  });
});
