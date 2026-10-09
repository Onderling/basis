/**
 * A list message goes stale the moment someone ticks a line elsewhere. Asked by a household member (2026-10-08): a
 * "refresh" button on the list message that sends the list again, so you know it is up to date. It is a quick reply —
 * the list read's own slash line, decided by the person's gate like a typed one.
 */
import { describe, it, expect } from 'vitest';
import { InMemoryBridge } from '@onderling/chat-agent';
import { listsManifest } from '../../../lists/manifest.js';
import { mergeManifests } from '../../src/manifestMerge.js';
import { createTelegramRunner } from '../../src/telegram/runner.js';

const t = (k, v) => (v ? `${k} ${JSON.stringify(v)}` : k);

describe('the refresh button on a list message', () => {
  it('a list read carries it; a tap sends the list again, read fresh', async () => {
    const bridge = new InMemoryBridge({ id: 'telegram' });
    let lines = ['yoghurt', 'kroepoek'];
    const reads = [];
    const callSkill = async (_app, op, args) => {
      if (op !== 'listEntries') return { ok: false, error: 'not here' };
      reads.push(args?.list);
      return { ok: true, title: 'Boodschappen', items: lines.map((label, i) => ({ id: `I${i}`, label, type: 'list-item' })) };
    };
    const runner = createTelegramRunner({ bridge, t, collectMs: 0, catalogue: mergeManifests([{ manifest: listsManifest }]), callSkill });
    await runner.start();
    await bridge.simulateIncoming({ chatId: '9', text: '/list-entries Boodschappen', sender: { bridgeUid: '9' } });
    await runner.idle();
    const first = bridge.outbox.at(-1);
    const refresh = (first.buttons ?? []).find((b) => b.label === 'circle.telegram.refresh');
    expect(refresh, JSON.stringify(first.buttons)).toBeTruthy();

    lines = ['kroepoek'];   // someone ticked yoghurt elsewhere
    await bridge.simulateIncoming({ chatId: '9', text: refresh.id, sender: { bridgeUid: '9' } });
    await runner.idle();
    expect(reads).toEqual(['Boodschappen', 'Boodschappen']);
    const again = bridge.outbox.at(-1);
    expect(again.text).toContain('kroepoek');
    expect(again.text).not.toContain('yoghurt');
  });

  it('an empty list has it too — it can fill up elsewhere', async () => {
    const bridge = new InMemoryBridge({ id: 'telegram' });
    const callSkill = async () => ({ ok: true, title: 'Boodschappen', items: [] });
    const runner = createTelegramRunner({ bridge, t, collectMs: 0, catalogue: mergeManifests([{ manifest: listsManifest }]), callSkill });
    await runner.start();
    await bridge.simulateIncoming({ chatId: '9', text: '/list-entries Boodschappen', sender: { bridgeUid: '9' } });
    await runner.idle();
    expect((bridge.outbox.at(-1).buttons ?? []).some((b) => b.label === 'circle.telegram.refresh')).toBe(true);
  });
});
