import { describe, it, expect, vi } from 'vitest';
import { nearbyWizardStep, nearbyWizardPress, nearbyCardTags, NEARBY_WIZARD_STEPS } from '../../src/v2/nearbyWizard.js';

const acts = (over = {}) => ({
  now: { level: 'none', visibility: {} },
  setLevel: vi.fn(async () => ({ ok: true })),
  setQuiet: vi.fn(),
  setRadio: vi.fn(),
  markAsked: vi.fn(),
  setAllow: vi.fn(),
  showCard: vi.fn(async () => ({ ok: true })),
  ...over,
});

describe('the first-time wizard: what each step shows', () => {
  it('has three steps, each headed "step n of 3"', () => {
    expect(NEARBY_WIZARD_STEPS).toBe(3);
    for (const n of [1, 2, 3]) expect(nearbyWizardStep(n).head).toEqual({ key: 'circle.nearbyScreen.wizard_step', vars: { n, of: 3 } });
  });

  it('step 1 lists the selves the room may be entered as, the general self marked so it reads "{{name}} · yourself"', () => {
    const s = nearbyWizardStep(1, { selfView: { ask: true, self: null, choices: [{ id: 'default', name: 'Frits' }, { id: 'p1', name: 'Buurman' }] } });
    expect(s.selves.map((c) => [c.id, c.general])).toEqual([['default', true], ['p1', false]]);
    expect(s.buttons.map((b) => b.id)).toEqual(['yes', 'look']);
    const one = nearbyWizardStep(1, { selfView: { ask: false, self: { id: 'default', name: 'Frits' }, choices: [] } });
    expect(one.selves).toEqual([{ id: 'default', name: 'Frits', general: true }]);
    expect(one.selected).toBe('default');
  });

  it('step 2 offers the switch only when something is offered; otherwise the line that says where', () => {
    expect(nearbyWizardStep(2, { offers: ['koken', ' '] }).offers).toEqual({ key: 'circle.nearbyScreen.wizard2_offers', vars: { offers: 'koken' }, list: ['koken'] });
    expect(nearbyWizardStep(2, { offers: [] }).offers).toEqual({ noneKey: 'circle.nearbyScreen.wizard2_no_offers' });
  });

  it('step 3 says nothing is kept (the one sentence for it) and starts the switch where the chat allow stands', () => {
    const s = nearbyWizardStep(3, { chat: true });
    expect(s.boxKey).toBe('circle.nearbyScreen.chat_ephemeral');
    expect(s.chat.on).toBe(true);
    expect(s.buttons.map((b) => b.id)).toEqual(['back', 'done']);
  });
});

describe('the first-time wizard: what a press writes', () => {
  it('"Ja, als …" is the menu\'s Zichtbaar: from no level it writes the floor, marks asked, goes to step 2', async () => {
    const a = acts();
    expect(await nearbyWizardPress({ step: 1 }, 'yes', {}, a)).toEqual({ step: 2 });
    expect(a.setLevel).toHaveBeenCalledWith('handle');
    expect(a.setQuiet).toHaveBeenCalledWith(false);
    expect(a.markAsked).toHaveBeenCalled();
  });

  it('a level that could not be written stops on step 1 with the notice (nothing announced, not marked asked)', async () => {
    const a = acts({ setLevel: vi.fn(async () => ({ ok: false })) });
    expect(await nearbyWizardPress({ step: 1 }, 'yes', {}, a)).toEqual({ step: 1, notice: 'level_not_set' });
    expect(a.markAsked).not.toHaveBeenCalled();
    expect(a.setQuiet).not.toHaveBeenCalled();
  });

  it('"Alleen kijken" writes no level and no quiet: only the asked-mark, and the wizard ends', async () => {
    const a = acts();
    expect(await nearbyWizardPress({ step: 1 }, 'look', {}, a)).toEqual({ done: true });
    expect(a.markAsked).toHaveBeenCalled();
    expect(a.setLevel).not.toHaveBeenCalled();
    expect(a.setQuiet).not.toHaveBeenCalled();
    expect(a.setAllow).not.toHaveBeenCalled();
  });

  it('a card saved in step 2 turns the card switch on and shows it; no name typed, no card and the switch stays', async () => {
    const a = acts();
    expect(await nearbyWizardPress({ step: 2 }, 'next', { label: ' Frits ', line: ' nummer 8 ' }, a)).toEqual({ step: 3 });
    expect(a.setAllow).toHaveBeenCalledWith('card', true);
    expect(a.showCard).toHaveBeenCalledWith({ label: 'Frits', line: 'nummer 8', tags: [] });
    const b = acts();
    expect(await nearbyWizardPress({ step: 2 }, 'next', { label: '  ' }, b)).toEqual({ step: 3 });
    expect(b.setAllow).not.toHaveBeenCalled();
    expect(b.showCard).not.toHaveBeenCalled();
  });

  it('the offers switch is a prefill: on, the chips still listed go as the card\'s tags; off, no tags whatever is listed', async () => {
    const a = acts();
    await nearbyWizardPress({ step: 2 }, 'next', { label: 'Frits', showOffers: true, tags: ['koken', ' ', 'fietsen'] }, a);
    expect(a.showCard).toHaveBeenCalledWith({ label: 'Frits', line: '', tags: ['koken', 'fietsen'] });
    const b = acts();
    await nearbyWizardPress({ step: 2 }, 'next', { label: 'Frits', showOffers: false, tags: ['koken'] }, b);
    expect(b.showCard).toHaveBeenCalledWith({ label: 'Frits', line: '', tags: [] });
  });

  it('Verder does not wait for the room to receive the card (a device still connecting took 30 s on a phone): the outcome goes to the host when it comes', async () => {
    let deliver;
    const cardShown = vi.fn();
    const a = acts({ showCard: vi.fn(() => new Promise((r) => { deliver = r; })), cardShown });
    expect(await nearbyWizardPress({ step: 2 }, 'next', { label: 'Frits' }, a), 'moves on at once').toEqual({ step: 3 });
    expect(cardShown).not.toHaveBeenCalled();
    deliver({ ok: false, notice: 'card_hidden' });
    await new Promise((r) => setTimeout(r, 0));
    expect(cardShown).toHaveBeenCalledWith({ ok: false, notice: 'card_hidden' });
  });

  it('step 3 Klaar writes the chat switch and ends; Vorige goes back a step', async () => {
    const a = acts();
    expect(await nearbyWizardPress({ step: 3 }, 'done', { chat: true }, a)).toEqual({ done: true });
    expect(a.setAllow).toHaveBeenCalledWith('chat', true);
    const b = acts();
    await nearbyWizardPress({ step: 3 }, 'done', {}, b);
    expect(b.setAllow).toHaveBeenCalledWith('chat', false);
    expect(await nearbyWizardPress({ step: 3 }, 'back', {}, acts())).toEqual({ step: 2 });
    expect(await nearbyWizardPress({ step: 1 }, 'back', {}, acts())).toEqual({ step: 1 });
  });
});

describe('the card\'s tags: one rule for the wizard and the card editor', () => {
  it('only with the switch on, and only the chips still listed (trimmed, blanks dropped)', () => {
    expect(nearbyCardTags({ showOffers: true, tags: [' koken ', '', 'fietsen'] })).toEqual(['koken', 'fietsen']);
    expect(nearbyCardTags({ showOffers: false, tags: ['koken'] })).toEqual([]);
    expect(nearbyCardTags({ showOffers: true })).toEqual([]);
    expect(nearbyCardTags()).toEqual([]);
  });
});
