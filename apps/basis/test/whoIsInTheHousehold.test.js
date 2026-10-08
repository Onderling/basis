/**
 * "Wie zitten er in dit huishouden?" — a household member asked it in the bot's log (2026-10-05) and the bot could not
 * say; `/users` is the admin's. Frits: members may see who is in the household. `/wie` lists the people by NAME as the
 * household's names setting lets the asker see them (the same rule as the chores' holders), with their role word —
 * never an id, never whether someone linked an app. Under `names: none` only "jij".
 */
import { describe, it, expect } from 'vitest';
import { withAssistantOps } from '../src/v2/assistantOps.js';
import { BOT_OP_MAP } from '../src/v2/botOpMap.js';
import { createBotThreads, memoryThreadStore } from '../src/v2/botThreads.js';
import { EventLog } from '../src/eventLog.js';

const t = (k, p) => (p ? `${k} ${JSON.stringify(p)}` : k);
const ROWS = [
  { id: 'telegram:9', channel: 'telegram', uid: '9', role: 'admin', displayName: 'Frits', pubKey: 'K9' },
  { id: 'telegram:1', channel: 'telegram', uid: '1', role: 'member', displayName: 'Henk' },
  { id: 'telegram:2', channel: 'telegram', uid: '2', role: 'member', displayName: 'Yvonne' },
  { id: 'web:abc', channel: 'web', uid: 'web:abc', role: 'observer' },   // no name: never shown by id
];

function door(names = null) {
  const params = new Map(names ? [['assistant.names', names]] : []);
  return withAssistantOps({
    callSkill: async (app, op) => (app === 'params' && op === 'list-user-params' ? { ok: true, params: [...params].map(([key, value]) => ({ key, value })) } : { ok: true }),
    threads: createBotThreads({ eventLog: new EventLog({ initial: [], muted: [] }), store: memoryThreadStore() }),
    t, refusal: async () => null, admin: { users: async () => ROWS },
  });
}
const as = (who) => ({ caller: who, threadId: who, chatId: who.split(':')[1] });

describe('/wie: who is in the household', () => {
  it('is a member\'s and an observer\'s op too', () => {
    expect(BOT_OP_MAP.member).toContain('assistant.assistant-people');
    expect(BOT_OP_MAP.observer).toContain('assistant.assistant-people');
  });
  it('a member sees the names and role words — no ids, no linked apps; themselves as "jij"', async () => {
    const r = await door()('assistant', 'assistant-people', {}, as('telegram:1'));
    expect(r.ok, JSON.stringify(r)).toBe(true);
    expect(r.message).toContain('Frits');
    expect(r.message).toContain('Yvonne');
    expect(r.message).toContain('circle.bot.people_you');
    expect(r.message).not.toMatch(/telegram:|web:abc|users_linked/);
  });
  it('under names: none, only the asker', async () => {
    const r = await door('none')('assistant', 'assistant-people', {}, as('telegram:1'));
    expect(r.message).not.toContain('Frits');
    expect(r.message).not.toContain('Yvonne');
    expect(r.message).toContain('circle.bot.people_you');
  });
});
