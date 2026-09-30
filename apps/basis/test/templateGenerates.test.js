/**
 * The template is the ONE source of a bot's lists: their names, the words people use for them, what they hold. The
 * model's lines, the deterministic gate's rules and the eval are GENERATED from it — so a tennis club's template
 * ("Wedstrijden", "Bardienst") gets the same gate rules and the same prompt quality with no other change, and a
 * circle's own lists can later be read the same way.
 */
import { describe, it, expect } from 'vitest';
import { HOUSEHOLD_TEMPLATE, templateLists, promptLinesFor } from '../src/v2/householdTemplate.js';
import { listsGateRules } from '../src/v2/circleGate.js';

const NAMES = {
  'circle.lists.template.shopping': 'Boodschappen', 'circle.lists.template.chores': 'Klusjes',
  'circle.lists.template.repairs': 'Reparaties', 'circle.lists.template.schedule': 'Agenda',
  'tennis.wedstrijden': 'Wedstrijden', 'tennis.bardienst': 'Bardienst',
};
const t = (k) => NAMES[k] ?? k;
const TENNIS = {
  id: 'tennis',
  lists: [
    { key: 'tennis.wedstrijden', kind: 'matches', defaultChild: 'calendar-event', aliases: ['wedstrijden', 'wedstrijd'] },
    { key: 'tennis.bardienst', kind: 'bar', defaultChild: 'task', aliases: ['bardienst', 'bar'] },
  ],
};
/** The first rule that takes the line, and what it makes of it. */
const route = (rules, text) => {
  for (const r of rules) {
    const hit = r.test instanceof RegExp ? r.test.test(text) : r.test(text);
    if (hit) { const c = r.command(text); if (c) return c; }
  }
  return null;
};

describe('the template generates', () => {
  it('the household\'s lines: Fable\'s words, the names filled in from the template, no placeholder left', () => {
    const lines = promptLinesFor(t);
    expect(lines[0]).toBe('Dit huishouden houdt alles op LIJSTEN: Boodschappen, Klusjes, Reparaties, Agenda.');
    expect(lines.join('\n')).toContain('addToList(list: Klusjes, text: X');
    expect(lines.join('\n')).not.toMatch(/\{[a-z]+\}/);
  });

  it('the household\'s gate: the lists by the words people use, "de takenlijst" is Klusjes', () => {
    const rules = listsGateRules('nl', templateLists(t));
    expect(route(rules, 'zet melk op de boodschappen')).toMatchObject({ opId: 'addToList', args: { list: 'Boodschappen', text: 'melk' } });
    expect(route(rules, 'wat staat er op de takenlijst')).toMatchObject({ opId: 'listEntries', args: { list: 'Klusjes' } });
    expect(route(rules, 'nieuwe taak: lamp vervangen')).toMatchObject({ opId: 'addToList', args: { list: 'Klusjes', text: 'lamp vervangen' } });
  });

  it('a tennis club\'s template: working gate rules and lines, with no other change', () => {
    const rules = listsGateRules('nl', templateLists(t, TENNIS));
    expect(route(rules, 'zet koffie op de bardienst')).toMatchObject({ opId: 'addToList', args: { list: 'Bardienst', text: 'koffie' } });
    expect(route(rules, 'wat staat er op de wedstrijden')).toMatchObject({ opId: 'listEntries', args: { list: 'Wedstrijden' } });
    expect(route(rules, 'nieuwe taak: glazen spoelen')).toMatchObject({ opId: 'addToList', args: { list: 'Bardienst', text: 'glazen spoelen' } });
    const lines = promptLinesFor(t, TENNIS).join('\n');
    expect(lines).toContain('Wedstrijden');
    expect(lines).toContain('Bardienst');
    expect(lines).toMatch(/Bardienst[^\n]*TAKEN/);
    expect(lines).toMatch(/Wedstrijden[^\n]*AFSPRAKEN/);
    expect(lines).not.toMatch(/Boodschappen|Klusjes|\{[a-z]+\}/);
  });

  it('every template list carries the words people use for it', () => {
    for (const l of HOUSEHOLD_TEMPLATE.lists) expect(l.aliases?.length, l.key).toBeGreaterThan(0);
  });
});
