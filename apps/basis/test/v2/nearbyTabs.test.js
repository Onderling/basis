/**
 * Nearby's two tabs — what each tab shows and in what order, decided once in shared code so web and the phone paint
 * the same thing: Conversation (the room chat, or one line to join it) and Questions (the ask field, my asks, the
 * room's asks, who is here, circles offered here). A part with nothing in it is not in the list.
 */
import { describe, it, expect } from 'vitest';
import { nearbyTabs, NEARBY_TABS } from '../../src/v2/nearbyTabs.js';
import { sectionsOf } from '../../src/v2/screenSections.js';
import circleNl from '../../src/locales/circle.nl.json' with { type: 'json' };
import circleEn from '../../src/locales/circle.en.json' with { type: 'json' };

const text = (bundle, key) => key.split('.').slice(1).reduce((o, k) => o?.[k], bundle)?.text;
const sectionsIn = (out, tab) => out.tabs.find((x) => x.id === tab).sections;

const full = {
  chat: [{ id: 'm1', text: 'hoi' }],
  myAsks: [{ ask: { id: 'a1' }, heard: 2, answers: [] }],
  asks: [{ ask: { id: 'a2' } }],
  rows: [{ id: 'p1', pseudonym: 'Bob' }],
  invites: [{ invite: { circleId: 'c1' } }],
};

describe('nearbyTabs', () => {
  it('two tabs, Conversation then Questions, each named in both languages', () => {
    expect(NEARBY_TABS.map((x) => x.id)).toEqual(['conversation', 'questions']);
    expect(text(circleNl, NEARBY_TABS[0].labelKey)).toBe('Gesprek');
    expect(text(circleNl, NEARBY_TABS[1].labelKey)).toBe('Vragen');
    expect(text(circleEn, NEARBY_TABS[0].labelKey)).toBe('Conversation');
    expect(text(circleEn, NEARBY_TABS[1].labelKey)).toBe('Questions');
  });

  it('a full room: the chat; then ask field · my asks · the room\'s asks · who is here · circles offered here', () => {
    const out = nearbyTabs(full);
    expect(out.tabs.map((x) => x.id)).toEqual(['conversation', 'questions']);
    expect(sectionsIn(out, 'conversation')).toEqual(['nearby-chat']);
    expect(sectionsIn(out, 'questions')).toEqual(['nearby-ask-field', 'nearby-my-asks', 'nearby-asks', 'nearby-peers', 'nearby-invites']);
  });

  it('an empty room hides every empty part: only the ask field is left, and the chat says how to join', () => {
    const out = nearbyTabs({ chat: null, myAsks: [], asks: [], rows: [], invites: [] });
    expect(sectionsIn(out, 'conversation')).toEqual(['nearby-chat-off']);
    expect(sectionsIn(out, 'questions')).toEqual(['nearby-ask-field']);
  });

  it('a joined chat with nothing said yet is still the chat, not the join line', () => {
    expect(sectionsIn(nearbyTabs({ chat: [] }), 'conversation')).toEqual(['nearby-chat']);
  });

  it('opens on Conversation when the person is in the chat, else on Questions', () => {
    expect(nearbyTabs(full).defaultTab).toBe('conversation');
    expect(nearbyTabs({ ...full, chat: [] }).defaultTab).toBe('conversation');
    expect(nearbyTabs({ ...full, chat: null }).defaultTab).toBe('questions');
    expect(nearbyTabs(null).defaultTab).toBe('questions');
  });

  it('every declared section is reachable: each tab paints its declared screen, and each id shows for some room', () => {
    const shown = new Set([...nearbyTabs(full).tabs, ...nearbyTabs({ chat: null }).tabs].flatMap((x) => x.sections));
    for (const tab of NEARBY_TABS) {
      expect(sectionsOf(tab.screen).length, tab.screen).toBeGreaterThan(0);
      for (const s of sectionsOf(tab.screen)) expect(shown.has(s.id), s.id).toBe(true);
    }
  });
});
