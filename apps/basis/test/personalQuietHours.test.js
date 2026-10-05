/**
 * Quiet hours per person (Frits 2026-10-05: "quiet hours must be adjustable by the user"): a person's own quiet hours
 * (`/stil 23:00-09:00`, on their settings menu) win over the household's for THEIR reminders; someone without their own
 * follows the household's. One person's quiet never holds another's reminder back.
 */
import { describe, it, expect } from 'vitest';
import { dueReminders } from '../src/v2/botReminders.js';
import { withAssistantOps } from '../src/v2/assistantOps.js';
import { createBotThreads, memoryThreadStore } from '../src/v2/botThreads.js';
import { EventLog } from '../src/eventLog.js';

const tz = 'Europe/Amsterdam';
// 08:30 in Amsterdam on a day with a chore due: the household's quiet ends at 08:00, Ann's own at 09:00
const NOW = Date.parse('2026-10-07T06:30:00Z');
const chore = { id: 'c1', text: 'ramen', dueAt: '2026-10-07T10:00:00Z', assignees: ['ann', 'bob'] };

describe('quiet hours per person', () => {
  it('Ann sleeps till 09:00 by her own choice; Bob follows the household (till 08:00) and is reminded', () => {
    const people = [{ id: 'ann', role: 'member', quiet: '23:00-09:00' }, { id: 'bob', role: 'member' }];
    const due = dueReminders({ chores: [chore], people, now: NOW, tz, quiet: '21:00-08:00' });
    expect(due.map((d) => d.personId)).toEqual(['bob']);
  });

  it('/stil sets a person\'s own; /stil huis follows the household again; a bad time is refused', async () => {
    const threads = createBotThreads({ eventLog: new EventLog({ initial: [], muted: [] }), store: memoryThreadStore() });
    const door = withAssistantOps({ callSkill: async () => ({ ok: true }), threads, t: (k, p) => (p ? `${k} ${JSON.stringify(p)}` : k) });
    const as = { caller: 'telegram:1', threadId: 'telegram:1' };
    expect((await door('assistant', 'assistant-quiet', { hours: '23:00-09:00' }, as)).ok).toBe(true);
    expect(threads.quietOf('telegram:1')).toBe('23:00-09:00');
    expect((await door('assistant', 'assistant-quiet', { hours: 'huis' }, as)).ok).toBe(true);
    expect(threads.quietOf('telegram:1')).toBe(null);
    expect((await door('assistant', 'assistant-quiet', { hours: '25:00-09:00' }, as)).ok).toBe(false);
  });
});
