/**
 * `/weergave` without a word (and the screen's button for it) shows how the view stands, with a button per choice —
 * as `/geheugen`, `/herinneringen` and `/taal` do — instead of asking for the word to be typed (found by the
 * every-button walk, 2026-10-05: the screen opened a free-text field for a choice of three).
 */
import { describe, it, expect } from 'vitest';
import { withAssistantOps } from '../src/v2/assistantOps.js';
import { assistantManifest } from '../src/v2/assistantManifest.js';
import { createBotThreads, memoryThreadStore } from '../src/v2/botThreads.js';
import { EventLog } from '../src/eventLog.js';

describe('the view setting, asked without a word', () => {
  it('its current value, a button per choice; and the op asks no field', async () => {
    const threads = createBotThreads({ eventLog: new EventLog({ initial: [], muted: [] }), store: memoryThreadStore() });
    const door = withAssistantOps({ callSkill: async () => ({ ok: true }), threads, t: (k, p) => (p ? `${k} ${JSON.stringify(p)}` : k) });
    const r = await door('assistant', 'assistant-view', {}, { caller: 'telegram:1', threadId: 'telegram:1' });
    expect(r.ok).toBe(true);
    expect(r.quickReplies).toHaveLength(3);
    expect(assistantManifest.operations.find((o) => o.id === 'assistant-view').params.every((p) => !p.required)).toBe(true);
  });
});
