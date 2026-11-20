/**
 * MIJ LEAVES THE TAB BAR — the shared model both shells paint.
 *   - the bar: Vandaag · Kringen · + · Contacten · In de buurt (Mij is no tab; the `me` view is the persona panel)
 *   - the persona panel: a short view (the name with "Aanpassen", "Deel mijn kaart", my devices and helpers), one tab per
 *     persona when there are more than one (the general self first), and the "Laat zien als" switcher kept as a door
 *   - the settings button: its back returns to the tab the person came from
 *   - Vandaag takes what Mij said about now: the availability words and "Wacht op jou", above "Nieuw voor jou"; and
 *     "Nieuw voor jou" holds only what is addressed to the person (ordinary circle conversation is in "Kringen met nieuws")
 */
import { describe, it, expect } from 'vitest';
import { basisManifest } from '../../src/index.js';
import { barSlots } from '../../src/v2/plusDial.js';
import { meActionsFor } from '../../src/v2/meActionProjection.js';
import { mijBlocks, todayTopBlocks } from '../../src/v2/mijScreen.js';
import { personaPanelModel } from '../../src/v2/personaPanel.js';
import { settingsBackFor } from '../../src/v2/settingsHome.js';
import { materializeScreen } from '../../src/v2/userScreenBlocks.js';

const slotIds = (slots) => slots.map((s) => (s.kind === 'plus' ? '+' : s.tab.id));

describe('the tab bar without Mij', () => {
  it('Vandaag · Kringen · + · Contacten · In de buurt on a phone; Vandaag · Kringen · + · Contacten on the web', () => {
    expect(slotIds(barSlots(basisManifest, { hasMesh: true }))).toEqual(['screens', 'circles', '+', 'contacten', 'nearby']);
    expect(slotIds(barSlots(basisManifest, { hasMesh: false }))).toEqual(['screens', 'circles', '+', 'contacten']);
  });
});

describe('the persona panel: the short view', () => {
  it('one action: share my card (Scan is in the "+" only)', () => {
    expect(meActionsFor(basisManifest).map((a) => a.id)).toEqual(['share-contact']);
  });

  it('the name (with Aanpassen) and my devices and helpers; what waits and the readings went to Vandaag', () => {
    const blocks = mijBlocks(basisManifest);
    expect(blocks.map((b) => b.type)).toEqual(['identityLine', 'agents']);
    expect(blocks[0].config.readings).toBeUndefined();
  });

  it('one persona: no tabs, no "Laat zien als"', () => {
    const m = personaPanelModel({ held: [{ id: 'default', name: null }] });
    expect(m.tabs).toEqual([]);
    expect(m.showAs).toBe(false);
    expect(m.selected).toBe('default');
    expect(m.mijSelf).toBeNull();
  });

  it('several: one tab per persona, the general self first, and the switcher kept as a door', () => {
    const held = [{ id: 'werk', name: 'Werk' }, { id: 'default', name: null }, { id: 'buurt', name: 'Buurt' }];
    const m = personaPanelModel({ held });
    expect(m.tabs.map((x) => x.id)).toEqual(['default', 'werk', 'buurt']);
    expect(m.tabs.map((x) => x.nameKey ?? x.name)).toEqual(['circle.switcher.you', 'Werk', 'Buurt']);
    expect(m.tabs.find((x) => x.active).id).toBe('default');
    expect(m.showAs).toBe(true);
    const w = personaPanelModel({ held, selected: 'werk' });
    expect(w.tabs.find((x) => x.active).id).toBe('werk');
    expect(w.mijSelf).toEqual({ id: 'werk', name: 'Werk' });
  });

  it('a tab for a persona no longer held falls back to the general self', () => {
    expect(personaPanelModel({ held: [{ id: 'default' }, { id: 'werk', name: 'Werk' }], selected: 'weg' }).selected).toBe('default');
  });
});

describe('the settings button: back to where the person came from', () => {
  it('names the tab it returns to', () => {
    expect(settingsBackFor('contacten', basisManifest)).toEqual({ tab: 'contacten', labelKey: 'circle.tab.contacten' });
    expect(settingsBackFor('nearby', basisManifest)).toEqual({ tab: 'nearby', labelKey: 'circle.tab.nearby' });
  });
  it('a place that is no tab (or none) returns to Vandaag', () => {
    expect(settingsBackFor('mij', basisManifest)).toEqual({ tab: 'screens', labelKey: 'circle.tab.vandaag' });
    expect(settingsBackFor(null, basisManifest)).toEqual({ tab: 'screens', labelKey: 'circle.tab.vandaag' });
  });
});

describe('Vandaag on top: "Wacht op jou" first, then "Nieuw voor jou"; availability is a line under the title (Frits 2026-11-20)', () => {
  const declared = todayTopBlocks(basisManifest);

  it('is declared in the manifest: "Wacht op jou" only (availability is no block)', () => {
    expect(declared.map((b) => b.type)).toEqual(['awaiting']);
  });

  it('nothing waits: no "Wacht op jou" block, and no availability block either', async () => {
    const blocks = await materializeScreen({
      screen: { id: 'p', blocks: [{ id: 'n', type: 'notes', config: {} }] },
      hostOps: { forYou: true, todayTop: declared, availability: { holiday: { active: false }, quietHours: { enabled: false } }, circles: [], callSkill: async () => null },
    });
    const top = blocks.map((b) => b.type);
    expect(top).not.toContain('awaiting');
    expect(top).not.toContain('availability');
  });

  it('"Wacht op jou" above "Nieuw voor jou" when something waits', async () => {
    const blocks = await materializeScreen({
      screen: { id: 'p', blocks: [{ id: 'n', type: 'notes', config: {} }] },
      hostOps: { forYou: true, todayTop: declared, circles: [], callSkill: async () => null, pendingDeviceOffer: () => true,
        eventLog: { query: () => [] }, turns: [{ messageId: 'm1', contactId: 'c1', from: 'them', text: 'hoi', ts: Date.now(), direction: 'in' }] },
    });
    const types = blocks.map((b) => b.type);
    expect(types.indexOf('awaiting')).toBeGreaterThanOrEqual(0);
    if (types.includes('forYou')) expect(types.indexOf('awaiting')).toBeLessThan(types.indexOf('forYou'));
  });
});
