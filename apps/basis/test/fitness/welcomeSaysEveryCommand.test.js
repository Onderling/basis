/**
 * FITNESS: the welcome keeps up with the bot. Frits 2026-10-06: "the welcome message must be updated each time" — a new
 * person's first message is the one place they learn what the bot does, and it lagged every feature since it was
 * written (/wie, /inapp, own lists, a line becoming a chore, one's own quiet hours…).
 *
 * FOR A FRESH AGENT: when this fails you added a command people can use. Either SAY it in the welcome — a line in
 * `welcomeLines` (src/v2/botWelcome.js) and its op in `WELCOME_SAYS` — or LEAVE it out on purpose: its op in
 * `WELCOME_LEAVES` with the reason (it is part of a line already said, a follow-up step, an admin tool, …). Never both.
 */
import { describe, it, expect } from 'vitest';
import { composeAssistantCatalogue } from '../../src/telegram/assistantCatalogue.js';
import { scopeCatalogueToRole } from '../../src/v2/botOpMap.js';
import { WELCOME_SAYS, WELCOME_LEAVES } from '../../src/v2/botWelcome.js';

const { catalogue } = composeAssistantCatalogue({ apps: ['lists', 'tasks', 'calendar'], slim: true });
const opsOf = (role) => [...scopeCatalogueToRole(catalogue, role).opsById.values()].map((e) => e.op.id);

describe('FITNESS: the welcome says every command, or says why not', () => {
  for (const role of ['member', 'observer', 'admin']) {
    it(`${role}: every op is said or left out with a reason`, () => {
      const unaccounted = [...new Set(opsOf(role))].filter((op) => !(op in WELCOME_SAYS) && !(op in WELCOME_LEAVES));
      expect(unaccounted, 'say it in welcomeLines + WELCOME_SAYS, or add it to WELCOME_LEAVES with the reason').toEqual([]);
    });
  }
  it('an op is said OR left out, never both; every reason is a sentence', () => {
    expect(Object.keys(WELCOME_SAYS).filter((op) => op in WELCOME_LEAVES)).toEqual([]);
    for (const [op, why] of Object.entries(WELCOME_LEAVES)) expect(String(why).length, op).toBeGreaterThan(10);
  });
});
