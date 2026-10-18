/**
 * "Nieuwe afspraak: koekhappen morgen om 10 uur" — the words that SAY it is an appointment are not its title. The
 * household's log: the gate stored "Nieuwe afspraak: koekhappen" as the title.
 */
import { describe, it, expect } from 'vitest';
import { listsGateRules } from '../../src/v2/circleGate.js';
import { templateLists } from '../../src/v2/householdTemplate.js';

const names = { 'circle.lists.template.shopping': 'Boodschappen', 'circle.lists.template.chores': 'Klusjes', 'circle.lists.template.repairs': 'Reparaties', 'circle.lists.template.schedule': 'Agenda' };
const rules = listsGateRules('nl', templateLists((k) => names[k] ?? k));
const take = (text) => { for (const r of rules) { const c = r.command(text); if (c) return c; } return null; };

describe('an appointment\'s title', () => {
  it('drops the words that announce it', () => {
    for (const line of ['Nieuwe afspraak: koekhappen morgen om 10 uur', 'afspraak: koekhappen morgen om 10 uur', 'New appointment: koekhappen morgen om 10 uur']) {
      const c = take(line);
      expect(c, line).toMatchObject({ opId: 'addEvent' });
      expect(c.args.title, line).toBe('koekhappen');
    }
  });
  it('a title that merely contains the word keeps it', () => {
    expect(take('afspraak tandarts morgen om 10 uur')?.args?.title).toBe('afspraak tandarts');
  });
});
