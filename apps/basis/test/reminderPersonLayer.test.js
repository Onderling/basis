/**
 * A person's own reminders are theirs — a habit, not the item's property: their default and their extras per item live
 * on THEIR thread row (never synced, never another person's). A layer is `{ mode: 'replace'|'add', rules }`; a rule
 * outside the vocabulary is refused; clearing a layer gives the person the household's again.
 */
import { describe, it, expect } from 'vitest';
import { EventLog } from '../src/eventLog.js';
import { createBotThreads, memoryThreadStore } from '../src/v2/botThreads.js';

async function threads() {
  const t = createBotThreads({ eventLog: new EventLog({ initial: [], muted: [] }), store: memoryThreadStore() });
  await t.load();
  return t;
}

describe("a person's own reminder layer", () => {
  it('a default: set, read back, cleared — and another person has none', async () => {
    const t = await threads();
    expect(t.reminderDefaultOf('telegram:1')).toBeNull();
    t.setReminderDefault('telegram:1', { mode: 'add', rules: ['before:60'] });
    expect(t.reminderDefaultOf('telegram:1')).toEqual({ mode: 'add', rules: ['before:60'] });
    expect(t.reminderDefaultOf('telegram:2')).toBeNull();
    t.setReminderDefault('telegram:1', null);
    expect(t.reminderDefaultOf('telegram:1')).toBeNull();
  });

  it('extras per item: only that item, only that person', async () => {
    const t = await threads();
    t.setReminderExtra('telegram:1', 'e1', { mode: 'add', rules: ['evening-before'] });
    expect(t.reminderExtraOf('telegram:1', 'e1')).toEqual({ mode: 'add', rules: ['evening-before'] });
    expect(t.reminderExtraOf('telegram:1', 'e2')).toBeNull();
    expect(t.reminderExtraOf('telegram:2', 'e1')).toBeNull();
    t.setReminderExtra('telegram:1', 'e1', null);
    expect(t.reminderExtraOf('telegram:1', 'e1')).toBeNull();
  });

  it('a rule outside the vocabulary, or a mode that is not one, is refused', async () => {
    const t = await threads();
    expect(() => t.setReminderDefault('telegram:1', { mode: 'add', rules: ['every-hour'] })).toThrow(/rule/);
    expect(() => t.setReminderExtra('telegram:1', 'e1', { mode: 'sideways', rules: ['morning'] })).toThrow(/mode/);
  });
});
