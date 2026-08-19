import { describe, it, expect } from 'vitest';
import { botIsAddressed } from '../../src/v2/botAddress.js';

const SELF = 'https://me.example/profile#me';
const BOT = { webid: 'urn:onderling:bot', name: 'Onderling', relation: 'agent', isBot: true };
const HUMAN = { webid: 'https://sara.example/#me', name: 'Sara', relation: 'group-member' };

describe('botAddress · botIsAddressed', () => {
  describe('1:1 bot chat → ALWAYS addressed', () => {
    const members = [{ webid: SELF }, BOT];
    it('a plain untagged message is still for the bot', () => {
      expect(botIsAddressed({ text: 'hoe werkt een circle?', circleMembers: members, selfWebid: SELF, botMember: BOT })).toBe(true);
    });
    it('a self-referential question ("ben jij een bot?") is for the bot', () => {
      expect(botIsAddressed({ text: 'ben jij een bot?', circleMembers: members, selfWebid: SELF, botMember: BOT })).toBe(true);
    });
    it('holds even when the bot row carries no name (member logic, not the label)', () => {
      const nameless = { webid: 'urn:onderling:bot', relation: 'agent' };
      expect(botIsAddressed({ text: 'anything', circleMembers: [{ webid: SELF }, nameless], selfWebid: SELF, botMember: nameless })).toBe(true);
    });
  });

  describe('group (2+ members) → addressed ONLY when the bot is @-tagged/named', () => {
    const members = [{ webid: SELF }, BOT, HUMAN];
    it('an untagged group message → false (the bot stays silent)', () => {
      expect(botIsAddressed({ text: 'wie brengt het brood mee?', circleMembers: members, selfWebid: SELF, botMember: BOT })).toBe(false);
    });
    it('@-tagging the bot by name → true', () => {
      expect(botIsAddressed({ text: '@Onderling hoe werkt een circle?', circleMembers: members, selfWebid: SELF, botMember: BOT })).toBe(true);
    });
    it('the generic @assistent / @bot tag → true', () => {
      expect(botIsAddressed({ text: 'hé @assistent kun je helpen?', circleMembers: members, selfWebid: SELF, botMember: BOT })).toBe(true);
      expect(botIsAddressed({ text: '@bot help', circleMembers: members, selfWebid: SELF, botMember: BOT })).toBe(true);
    });
    it('opening with the bot name → true', () => {
      expect(botIsAddressed({ text: 'Onderling, wat kost het?', circleMembers: members, selfWebid: SELF, botMember: BOT })).toBe(true);
    });
  });

  it('no bot member / empty roster → false', () => {
    expect(botIsAddressed({ text: 'hi', circleMembers: [{ webid: SELF }, HUMAN], selfWebid: SELF, botMember: null })).toBe(false);
    expect(botIsAddressed({ text: 'hi', circleMembers: [], selfWebid: SELF, botMember: BOT })).toBe(false);
  });
});
