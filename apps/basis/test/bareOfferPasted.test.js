/**
 * A screen's code or an app's link offer, pasted ALONE in the chat: the person copied the code the page showed, not
 * the line with its command (Frits, 2026-10-04: "the copy on the page isn't what the bot is looking for"). The door
 * takes a line that is nothing but such an offer as its command; anything else is untouched.
 */
import { describe, it, expect } from 'vitest';
import { InMemoryBridge } from '@onderling/chat-agent';
import { createTelegramRunner } from '../src/telegram/runner.js';
import { createDoorCatalogue } from '../src/telegram/assistantCatalogue.js';
import { householdBotApps } from '../src/v2/householdTemplate.js';
import { scopeCatalogueToRole } from '../src/v2/botOpMap.js';
import { commandForBareOffer } from '../src/v2/doorOffers.js';

describe('an offer pasted alone', () => {
  it('the rule: a bare connect code is /koppel-scherm, a bare link offer /koppel; anything else is not', () => {
    expect(commandForBareOffer('onderling-connect://eyJhIjoxfQ')).toBe('/koppel-scherm onderling-connect://eyJhIjoxfQ');
    expect(commandForBareOffer('  onderling-koppel:eyJhIjoxfQ  ')).toBe('/koppel onderling-koppel:eyJhIjoxfQ');
    expect(commandForBareOffer('/koppel-scherm onderling-connect://x')).toBe(null);
    expect(commandForBareOffer('zet onderling-connect://x op de lijst')).toBe(null);
    expect(commandForBareOffer('melk')).toBe(null);
  });

  it('through the runner: the bare code reaches the screen paste', async () => {
    const cat = createDoorCatalogue({ slim: true, getApps: () => householdBotApps() });
    const calls = [];
    const bridge = new InMemoryBridge({ id: 'telegram' });
    const runner = createTelegramRunner({
      bridge, catalogue: cat.catalogue, manifestsByOrigin: cat.manifestsByOrigin, t: (k) => k,
      callSkill: async (a, o, x) => { calls.push({ a, o, x }); return { ok: true, message: 'ok' }; },
      admit: async () => 'telegram:42', roleFor: () => 'admin', scopeToRole: scopeCatalogueToRole,
    });
    await runner.start();
    await bridge.simulateIncoming({ chatId: '42', text: 'onderling-connect://eyJhIjoxfQ', sender: { bridgeUid: '42', displayName: 'F' } });
    await runner.idle('42');
    expect(calls).toEqual([expect.objectContaining({ o: 'assistant-screen-paste', x: expect.objectContaining({ offer: 'onderling-connect://eyJhIjoxfQ' }) })]);
  });
});
