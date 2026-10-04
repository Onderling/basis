/**
 * Every household setting the bot's `/huishouden` writes is a param in the register, so the write lands: an unregistered
 * key is refused by `set-param` (`param-unknown`), and the menu then shows the old value as if nothing was asked. The
 * reminder lead (`/huishouden lead 15`) was such a key — its buttons on the chat and the screen changed nothing. And when
 * a write is refused, the settings op says so instead of answering with the unchanged list.
 */
import { describe, it, expect } from 'vitest';
import * as botSettings from '../src/v2/botSettings.js';
import { basisParamRegistry } from '../src/v2/paramsService.js';
import { createRealHouseholdAgent } from '../src/core/agent/realAgent.js';
import { withAssistantOps } from '../src/v2/assistantOps.js';
import { createBotThreads, memoryThreadStore } from '../src/v2/botThreads.js';
import { EventLog } from '../src/eventLog.js';

const settingKeys = Object.entries(botSettings).filter(([name]) => name.endsWith('_KEY')).map(([, key]) => key);

describe('the household settings are registered params', () => {
  it('every key botSettings declares is in the register as a settable param', () => {
    const settable = new Set(basisParamRegistry().userParams().map((p) => p.key));
    expect(settingKeys).toContain('assistant.reminderLeadMin');
    expect(settingKeys.filter((k) => !settable.has(k))).toEqual([]);
  });

  it('/huishouden lead 15 through the real params service: the menu shows 15', async () => {
    const a = await createRealHouseholdAgent({ seedHousehold: false });
    const threads = createBotThreads({ eventLog: new EventLog({ initial: [], muted: [] }), store: memoryThreadStore() });
    const door = withAssistantOps({ callSkill: a.callSkill, t: (k, p) => (p ? `${k} ${JSON.stringify(p)}` : k), threads });
    const r = await door('assistant', 'assistant-settings', { change: 'lead 15' }, { caller: 'telegram:1', threadId: 'telegram:1', chatId: '1' });
    expect(r.ok).toBe(true);
    expect(r.quickReplies.map((b) => b.label)).toContain('circle.bot.menu_lead: circle.bot.value_lead_min {"n":15} ✓');
  });

  it('a refused write is said, not answered with the unchanged list', async () => {
    const door = withAssistantOps({
      callSkill: async (app, op) => (app === 'params' && op === 'set-param' ? { ok: false, error: 'param-unknown' } : { ok: true, params: [] }),
      t: (k) => k, threads: { langOf: () => null },
    });
    for (const change of ['lead 15', 'days 3', 'quiet 22:00-07:00', 'names admin']) {
      const r = await door('assistant', 'assistant-settings', { change }, { caller: 'telegram:1', threadId: 'telegram:1', chatId: '1' });
      expect(r.ok, change).toBe(false);
      expect(r.error?.message, change).toBe('circle.bot.settings_failed');
    }
  });
});
