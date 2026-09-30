/**
 * A list read says which list. Frits' session asked for five lists in one turn and got five numbered blocks with no
 * names. A `listEntries` reply now starts with the list's name — always, one list or five.
 */
import { describe, it, expect } from 'vitest';
import { InMemoryBridge } from '@onderling/chat-agent';
import { mergeManifests } from '../../src/manifestMerge.js';
import { createTelegramRunner } from '../../src/telegram/runner.js';
import { listsManifest } from '../../../lists/manifest.js';

const t = (k) => k;

describe('a list read', () => {
  it('starts with the list\'s name', async () => {
    const bridge = new InMemoryBridge({ id: 'telegram' });
    const callSkill = async (app, op, args) => (op === 'listEntries'
      ? { ok: true, title: args.list === 'boodschappen' ? 'Boodschappen' : 'Klusjes', items: [{ id: 'e1', label: 'melk', type: 'list-item' }] }
      : { ok: false });
    const runner = createTelegramRunner({
      bridge, callSkill, catalogue: mergeManifests([{ manifest: listsManifest }]),
      manifestsByOrigin: { lists: listsManifest }, allowedChatIds: ['42'], t, collectMs: 0,
    });
    await runner.start();
    const say = async (text) => {
      bridge.clearOutbox();
      await bridge.simulateIncoming({ chatId: '42', text, sender: { bridgeUid: '42', displayName: 'Frits' } });
      await runner.idle('42');
      return bridge.outbox.map((m) => m.text);
    };
    const [first] = await say('/list-entries boodschappen');
    expect(first.split('\n')[0]).toBe('Boodschappen:');
    const [second] = await say('/list-entries klusjes');
    expect(second.split('\n')[0]).toBe('Klusjes:');
  });
});
