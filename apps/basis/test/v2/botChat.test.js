import { describe, it, expect } from 'vitest';
import { oneToOneBotLabel } from '../../src/v2/botChat.js';

const SELF = 'https://me.example/profile#me';

describe('botChat · oneToOneBotLabel', () => {
  it('1:1 with a bot → the bot label', () => {
    const members = [
      { webid: SELF, displayName: 'Me' },
      { webid: 'https://bot.example/#a', relation: 'agent', displayName: 'Circle bot' },
    ];
    expect(oneToOneBotLabel({ members, selfWebid: SELF })).toBe('Circle bot');
  });

  it('1:1 with a human → null (no strip)', () => {
    const members = [
      { webid: SELF, displayName: 'Me' },
      { webid: 'https://sara.example/#me', relation: 'group-member', displayName: 'Sara' },
    ];
    expect(oneToOneBotLabel({ members, selfWebid: SELF })).toBe(null);
  });

  it('group (2+ others, even if one is a bot) → null', () => {
    const members = [
      { webid: SELF, displayName: 'Me' },
      { webid: 'https://bot.example/#a', relation: 'agent', displayName: 'Circle bot' },
      { webid: 'https://sara.example/#me', relation: 'group-member', displayName: 'Sara' },
    ];
    expect(oneToOneBotLabel({ members, selfWebid: SELF })).toBe(null);
  });

  it('empty roster → null', () => {
    expect(oneToOneBotLabel({ members: [], selfWebid: SELF })).toBe(null);
    expect(oneToOneBotLabel({})).toBe(null);
  });

  it('bot name missing → fallbackLabel', () => {
    const members = [
      { webid: SELF, displayName: 'Me' },
      { webid: 'https://bot.example/#a', relation: 'agent' },
    ];
    expect(oneToOneBotLabel({ members, selfWebid: SELF, fallbackLabel: 'Assistent' })).toBe('Assistent');
  });

  it('accepts the alternate bot markers (isBot / type a2a / hybrid)', () => {
    const mk = (extra) => [
      { webid: SELF },
      { webid: 'https://bot.example/#a', displayName: 'Bot', ...extra },
    ];
    expect(oneToOneBotLabel({ members: mk({ isBot: true }), selfWebid: SELF })).toBe('Bot');
    expect(oneToOneBotLabel({ members: mk({ type: 'a2a' }), selfWebid: SELF })).toBe('Bot');
    expect(oneToOneBotLabel({ members: mk({ type: 'hybrid' }), selfWebid: SELF })).toBe('Bot');
  });

  it('filters self by id as well as webid, and prefers name → displayName → label', () => {
    const members = [
      { id: SELF },
      { id: 'bot', relation: 'agent', label: 'Labelled' },
    ];
    expect(oneToOneBotLabel({ members, selfWebid: SELF })).toBe('Labelled');
  });
});
