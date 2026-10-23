/**
 * THE RECOVERY PHRASE NEVER SHOWS BY ITSELF. It is the owner root: on screen in a café is a key handed to whoever
 * looks. The phone used to open the full phrase on every start until "Written down" was tapped ("Later" stored
 * nothing). Now a card on Vandaag says the key is not saved yet, and only its explicit "Toon" opens the words;
 * "Later" snoozes the card; "Opgeschreven" ends it. A returning person (a restored device: a handle and a circle —
 * they just typed the phrase) is not asked.
 */
import { describe, it, expect } from 'vitest';
import { onboardingCards, materializeOnboarding } from '../../src/v2/onboardingStrip.js';
import { createOnboardingFlags, KEY_SAVED_KEY, KEY_SNOOZED_UNTIL_KEY, keyCardPending } from '../../src/v2/onboardingFlags.js';

const memIo = (init = {}) => { const m = new Map(Object.entries(init)); return { m, get: (k) => m.get(k) ?? null, set: (k, v) => { m.set(k, v); } }; };

describe('the key card', () => {
  it('comes first while the key is not saved, and is never shown to a returning person', () => {
    expect(onboardingCards({ handle: null, inCircle: false, introSeen: false, keyPending: true }).map((c) => c.id)).toEqual(['key', 'handle', 'intro', 'begin']);
    expect(onboardingCards({ handle: 'anna', inCircle: false, introSeen: true, keyPending: false }).map((c) => c.id)).toEqual(['begin']);
    expect(onboardingCards({ handle: 'anna', inCircle: true, introSeen: false, keyPending: true })).toEqual([]);
  });

  it('is pending until saved, and a snooze hides it until it runs out', async () => {
    const io = memIo();
    const flags = createOnboardingFlags(io);
    const now = 1_000_000;
    expect(await keyCardPending(flags, now)).toBe(true);
    await flags.snoozeKey(now + 5000);
    expect(io.m.get(KEY_SNOOZED_UNTIL_KEY)).toBe(String(now + 5000));
    expect(await keyCardPending(flags, now + 4999)).toBe(false);
    expect(await keyCardPending(flags, now + 5000)).toBe(true);
    await flags.markKeySaved();
    expect(io.m.get(KEY_SAVED_KEY)).toBe('1');
    expect(await keyCardPending(flags, now + 99_999_999)).toBe(false);
  });

  it('materializes from the host\'s keyPending, and the card carries no words', async () => {
    const callSkill = async () => ({ entry: { handle: null } });
    const b = await materializeOnboarding({ id: 'o' }, { callSkill, introSeen: async () => true, keyPending: async () => true });
    expect(b.content.cards[0]).toEqual({ id: 'key' });
  });
});

describe('the phone does not open the phrase at start', () => {
  it('App.js has no boot-time phrase screen any more', async () => {
    const fs = await import('node:fs/promises');
    const src = await fs.readFile(new URL('../../../basis-mobile/App.js', import.meta.url), 'utf8');
    expect(src).not.toMatch(/shouldShowCreateMnemonic|mnemonicState|<MnemonicCreateScreen/);
  });
});
