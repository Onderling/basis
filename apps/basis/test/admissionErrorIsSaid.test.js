/**
 * An admission that FAILS (the door's code check throws: a store, the gate) is said — on the box's console and in the
 * walk log, with the reason — and the person hears that letting them in went wrong, never "I only understand
 * commands". Seen on the real bot (2026-10-02): a valid `/start <code>` admitted the admin into the book, the next
 * step threw, and the door answered "Hier begrijp ik alleen opdrachten" with nothing in any log.
 */
import { describe, it, expect, vi } from 'vitest';
import { InMemoryBridge } from '@onderling/chat-agent';
import { createTelegramRunner } from '../src/telegram/runner.js';
import { composeAssistantCatalogue } from '../src/telegram/assistantCatalogue.js';

describe('a failing admission', () => {
  it('is logged with its reason, and the person is told it went wrong', async () => {
    const log = [];
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const { catalogue, manifestsByOrigin } = composeAssistantCatalogue({ apps: ['lists'] });
    const bridge = new InMemoryBridge({ id: 'telegram' });
    const runner = createTelegramRunner({
      bridge, catalogue, manifestsByOrigin, t: (k) => k, callSkill: async () => ({ ok: true }), allowedChatIds: '*',
      llm: { invoke: async () => null }, interpret: async () => null, walkLog: (e) => log.push(e),
      admit: async () => { throw new Error('the host gate is not attached'); },
    });
    await runner.start();
    await bridge.simulateIncoming({ chatId: '42', text: '/start abc-def', sender: { bridgeUid: '42', displayName: 'Frits' } });
    await runner.idle('42');
    const said = bridge.outbox.map((m) => m.text).join('\n');
    expect(said).toContain('circle.bot.admission_failed');
    expect(said).not.toContain('circle.telegram.unknown');
    expect(log.find((e) => e.kind === 'admission-error')).toMatchObject({ error: 'the host gate is not attached' });
    expect(warn.mock.calls.flat().join(' ')).toContain('the host gate is not attached');
    warn.mockRestore();
  });
});
