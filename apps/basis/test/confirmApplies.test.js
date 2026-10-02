import { describe, it, expect } from 'vitest';
import { confirmApplies } from '../src/confirmApplies.js';

describe('confirmApplies — does the op\'s confirm ask for this call', () => {
  it('no confirm: never; no `when`: always', () => {
    expect(confirmApplies(null, { change: 'x' })).toBe(false);
    expect(confirmApplies({ severity: 'warn' }, {})).toBe(true);
  });
  it('`when`: only the named values — from a form (`change`) or a slash argline (`_match`)', () => {
    const c = { severity: 'warn', when: ['names none', 'reminders off'] };
    expect(confirmApplies(c, { change: 'names none' })).toBe(true);
    expect(confirmApplies(c, { _match: ' Reminders OFF ' })).toBe(true);
    expect(confirmApplies(c, { _match: 'names members' })).toBe(false);
    expect(confirmApplies(c, {})).toBe(false);
  });
});
