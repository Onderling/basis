/**
 * HOW FAR THE "+" GOES, on the persona's card in Mij (ledger L977, D.3b): one row per persona with four choices, the
 * one in force marked (its own, else the general persona's, else 3). A tap writes it through the ceiling's own op for
 * THAT persona; which op is the row's to say (`write`), never a shell's. Both shells paint it.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { PLUS_CEILING_KEY } from '@onderling/agent-registry';
import { PLUS_CEILING_ROW, plusCeilingRow } from '../../src/v2/plusCeilingRow.js';
import { buildMijViewModel } from '../../src/v2/personaView.js';
import en from '../../src/locales/circle.en.json' with { type: 'json' };
import nl from '../../src/locales/circle.nl.json' with { type: 'json' };

const own = (value) => ({ mode: 'own', value });
const read = (rel) => readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf8');
const at = (obj, key) => key.split('.').slice(1).reduce((o, k) => o?.[k], obj);

describe('the "+" row on a persona card', () => {
  it('four choices, from off to a circle\'s things after a yes; title, choices and hint in both languages', () => {
    expect(PLUS_CEILING_ROW.choices.map((c) => c.value)).toEqual([0, 1, 2, 3]);
    for (const key of [PLUS_CEILING_ROW.labelKey, PLUS_CEILING_ROW.hintKey, ...PLUS_CEILING_ROW.choices.map((c) => c.labelKey)]) {
      expect(at(en, key)?.text ?? at(en, key), `en ${key}`).toBeTruthy();
      expect(at(nl, key)?.text ?? at(nl, key), `nl ${key}`).toBeTruthy();
    }
    expect(at(nl, PLUS_CEILING_ROW.labelKey)?.text).toBe('Wat de + voor me mag doen');
  });

  it('the value in force: own, else the general persona\'s, else 3', () => {
    const m = buildMijViewModel({ personas: [
      { id: 'default', name: 'Me', properties: { [PLUS_CEILING_KEY]: own(2) } },
      { id: 'werk', name: 'Werk', properties: {} },
      { id: 'club', name: 'Club', properties: { [PLUS_CEILING_KEY]: own(0) } },
    ], circles: [], releases: {} });
    const row = (id) => m.personas.find((p) => p.id === id).plusCeiling;
    expect([row('default').value, row('werk').value, row('club').value]).toEqual([2, 2, 0]);
    expect(plusCeilingRow({ id: 'x', properties: {} }).value).toBe(3);
  });

  it('a tap writes it through its own op, for that persona', () => {
    expect(plusCeilingRow({ id: 'werk', properties: {} }).write(1)).toEqual({ app: 'agents', opId: 'setPlusCeiling', args: { id: 'werk', ceiling: 1 } });
  });

  it('the card does not list it as a raw property row', () => {
    const m = buildMijViewModel({ personas: [{ id: 'default', name: 'Me', properties: { [PLUS_CEILING_KEY]: own(1) } }], circles: [], releases: {} });
    expect(m.personas[0].entries.map((e) => e.key)).not.toContain(PLUS_CEILING_KEY);
  });

  it('both shells paint it and write what the row says', () => {
    const web = read('../../web/v2/circleMij.js');
    expect(web).toMatch(/p\.plusCeiling/);
    expect(web).toMatch(/onPersonaWrite\(row\.write\(choice\.value\)\)/);
    const webHost = read('../../web/v2/circleApp.js');
    expect(webHost).toMatch(/onPersonaWrite: async \(w\) => \{[^}]*rawCallSkill\(w\.app, w\.opId, w\.args\)/);
    const mobile = read('../../../basis-mobile/src/screens/v2/CircleMijScreen.js');
    expect(mobile).toMatch(/p\.plusCeiling/);
    expect(mobile).toMatch(/const w = row\.write\(choice\.value\); await callSkill\(w\.app, w\.opId, w\.args\)/);
    expect(mobile).toMatch(/testID=\{`mij-plus-ceiling-\$\{p\.id\}-\$\{choice\.value\}`\}/);
  });
});
