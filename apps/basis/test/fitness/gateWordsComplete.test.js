/**
 * FITNESS: the gate's words are complete and true in every language (Fable, ledger L174). Each rule id the household
 * bot has (`GATE_RULE_IDS`) has an entry in every `gate.<lang>.json`, with a `doc`, patterns that compile, examples
 * that THIS rule takes (giving the op its id names) and `not` lines it does not take. A translation that drifts — a
 * pattern that never matches, a rule left out — is red here, the way a missing chat hint is.
 */
import { describe, it, expect } from 'vitest';
import { listsGateRules, GATE_RULE_IDS } from '../../src/v2/circleGate.js';
import { GATE_WORDS } from '../../src/v2/gateWords.js';
import { templateLists } from '../../src/v2/householdTemplate.js';

const NAMES = { 'circle.lists.template.shopping': 'Boodschappen', 'circle.lists.template.chores': 'Klusjes', 'circle.lists.template.repairs': 'Reparaties', 'circle.lists.template.schedule': 'Agenda' };
const rules = listsGateRules('nl', templateLists((k) => NAMES[k] ?? k));
const byId = new Map(GATE_RULE_IDS.map((id, i) => [id, rules[i]]));
const opOf = (id) => id.split('.')[1];
// a rule whose op depends on what it names: a read of the agenda is the calendar's own read
const ALSO = { 'lists.listEntries.named': ['listevents'] };
const firstTaker = (text) => { for (let i = 0; i < rules.length; i++) { const c = rules[i].command(text); if (c) return { id: GATE_RULE_IDS[i], cmd: c }; } return null; };

describe('FITNESS: the gate\'s words', () => {
  for (const [lang, entries] of Object.entries(GATE_WORDS)) {
    it(`${lang}: every rule has an entry with a doc, patterns, examples and not-lines`, () => {
      const missing = GATE_RULE_IDS.filter((id) => !entries[id]);
      expect(missing, `rules ${lang} does not carry`).toEqual([]);
      const unknown = Object.keys(entries).filter((id) => !GATE_RULE_IDS.includes(id));
      expect(unknown, `entries in ${lang} no rule reads`).toEqual([]);
      for (const id of GATE_RULE_IDS) {
        const e = entries[id];
        expect(typeof e.doc === 'string' && e.doc.length > 10, `${lang} ${id}: doc`).toBe(true);
        expect(Array.isArray(e.patterns) && e.patterns.length > 0, `${lang} ${id}: patterns`).toBe(true);
        expect(Array.isArray(e.examples) && e.examples.length > 0, `${lang} ${id}: examples`).toBe(true);
      }
    });

    it(`${lang}: each example is taken by its own rule, with its op; no not-line is`, () => {
      for (const id of GATE_RULE_IDS) {
        const e = entries[id];
        for (const ex of e.examples) {
          const got = firstTaker(ex);
          expect(got?.id, `${lang} "${ex}" should be ${id}`).toBe(id);
          const op = got.cmd.opId.toLowerCase();
          expect([opOf(id).toLowerCase(), ...(ALSO[id] ?? [])].some((o) => op.includes(o)), `${lang} "${ex}" gives ${op}, not ${opOf(id)}`).toBe(true);
        }
        for (const no of e.not ?? []) expect(byId.get(id).command(no), `${lang} "${no}" must not be ${id}`).toBeNull();
      }
    });
  }
});
