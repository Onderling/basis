/**
 * WHO MAY WRITE TO ME FIRST, on the persona's profile (decision 2026-11-12: the persona is the policy). Two controls per
 * persona card in Mij, both shells: who may write first (request / open) and whether people in this persona's circles
 * may write (on / off). They read through the registry's own readers (so the defaults live in one place) and write
 * through the waist op the agent's own setters use (`agents.setProfileProperty`, the persona's own value).
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { FIRST_MESSAGES_KEY, CIRCLE_MEMBERS_KEY } from '@onderling/agent-registry';
import { FIRST_CONTACT_CONTROLS, firstContactRows } from '../../src/v2/firstContact.js';
import { buildMijViewModel } from '../../src/v2/personaView.js';
import en from '../../src/locales/circle.en.json' with { type: 'json' };
import nl from '../../src/locales/circle.nl.json' with { type: 'json' };

const own = (value) => ({ mode: 'own', value });
const read = (rel) => readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf8');
const at = (obj, key) => key.split('.').slice(1).reduce((o, k) => o?.[k], obj);

describe('the two first-contact controls', () => {
  it('are the two persona properties, each with its choices', () => {
    expect(FIRST_CONTACT_CONTROLS.map((c) => c.key)).toEqual([FIRST_MESSAGES_KEY, CIRCLE_MEMBERS_KEY]);
    expect(FIRST_CONTACT_CONTROLS[0].choices.map((c) => c.value)).toEqual(['request', 'open']);
    expect(FIRST_CONTACT_CONTROLS[1].choices.map((c) => c.value)).toEqual([true, false]);
  });

  it('every label and choice says what it does, in both languages', () => {
    for (const c of FIRST_CONTACT_CONTROLS) {
      for (const key of [c.labelKey, ...c.choices.map((x) => x.labelKey)]) {
        expect(at(en, key)?.text ?? at(en, key), `en ${key}`).toBeTruthy();
        expect(at(nl, key)?.text ?? at(nl, key), `nl ${key}`).toBeTruthy();
      }
    }
  });

  it('a persona\'s rows read the registry\'s defaults: a person requests, members may write', () => {
    expect(firstContactRows({ properties: {} }).map((r) => [r.key, r.value])).toEqual([[FIRST_MESSAGES_KEY, 'request'], [CIRCLE_MEMBERS_KEY, true]]);
    expect(firstContactRows({ properties: { [FIRST_MESSAGES_KEY]: own('open'), [CIRCLE_MEMBERS_KEY]: own(false) } }).map((r) => r.value)).toEqual(['open', false]);
    // a function profile's door is open by default (one mechanism: a bot is a persona whose door is open)
    expect(firstContactRows({ properties: {}, kind: 'function' })[0].value).toBe('open');
  });

  it('every persona card in Mij carries them', () => {
    const m = buildMijViewModel({ personas: [
      { id: 'default', name: 'Me', properties: {} },
      { id: 'werk', name: 'Werk', properties: { [CIRCLE_MEMBERS_KEY]: own(false) } },
    ], circles: [], releases: {} });
    const card = (id) => m.personas.find((p) => p.id === id);
    expect(card('default').firstContact.map((r) => r.value)).toEqual(['request', true]);
    expect(card('werk').firstContact.map((r) => r.value)).toEqual(['request', false]);
  });

  it('the loader hands each persona its kind (a function profile reads open)', () => {
    expect(read('../../src/v2/mijLoader.js')).toMatch(/kind: +r\.kind \?\? null,/);
  });

  it('both shells paint them on the persona card and write them for THAT persona through the waist', () => {
    const web = read('../../web/v2/circleMij.js');
    expect(web).toMatch(/for \(const row of \(p\.firstContact \|\| \[\]\)\)/);
    expect(web).toMatch(/onSetPersonaProperty\(p\.id, row\.key, choice\.value\)/);
    const webHost = read('../../web/v2/circleApp.js');
    expect(webHost).toMatch(/onSetPersonaProperty: async \(personaId, key, value\) => \{[^}]*rawCallSkill\('agents', 'setProfileProperty', \{ id: personaId, key, value \}\)/);
    const mobile = read('../../../basis-mobile/src/screens/v2/CircleMijScreen.js');
    expect(mobile).toMatch(/\(p\.firstContact \|\| \[\]\)\.map\(\(row\) =>/);
    expect(mobile).toMatch(/callSkill\('agents', 'setProfileProperty', \{ id: p\.id, key: row\.key, value: choice\.value \}\)/);
    expect(mobile).toMatch(/testID=\{`mij-first-contact-\$\{p\.id\}-\$\{row\.key\}-\$\{String\(choice\.value\)\}`\}/);
  });
});
