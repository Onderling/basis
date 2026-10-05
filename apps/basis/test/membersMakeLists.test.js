/**
 * Everyone in the household makes a list (Frits 2026-10-05: "of course anyone should be able to create a list"): on
 * the bot's map `createList` is a member's op, not the admin's; an observer only reads, so not theirs.
 */
import { describe, it, expect } from 'vitest';
import { botOpLevel, botRoleAllows, BOT_OP_MAP } from '../src/v2/botOpMap.js';

describe('making a list', () => {
  it('a member\'s op; an observer still only reads', () => {
    expect(botOpLevel('createList')).toBe('authenticated');
    expect(BOT_OP_MAP.member).toContain('createList');
    expect(BOT_OP_MAP.admin).not.toContain('createList');
    expect(botRoleAllows('member', 'createList')).toBe(true);
    expect(botRoleAllows('observer', 'createList')).toBe(false);
  });
});
