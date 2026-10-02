/**
 * FITNESS: an app's gate words are complete and true in every language it ships. A manifest declares THAT an op has
 * gate words (`surfaces.slash.match`, its shape); the words are the app's `gate.<lang>.json`, carried on the manifest
 * as `gateWords`. Per language: every op with a match has an entry (`doc`, `verbs`, `examples`), no entry names an op
 * the manifest lacks, each example is taken by the manifest's gate — in that language — as its own op, and no
 * `not` line is. An op keeps its words in ONE place: never `match.verbs` beside the files.
 */
import { describe, it, expect } from 'vitest';
import { createGate } from '@onderling/manifest-host';
import { calendarManifest } from '../../../calendar/manifest.js';
import { mockTasksManifest, mockStoopManifest, mockFolioManifest } from '../../src/core/manifests/mockManifests.js';
import { householdManifest } from '../../../household/manifest.js';

const MANIFESTS = [calendarManifest, mockTasksManifest, mockStoopManifest, mockFolioManifest, householdManifest];
const appOf = (m) => m.appId ?? m.app;
const matched = (m) => (m.operations ?? []).filter((op) => op?.surfaces?.slash?.match);

describe('FITNESS: the apps\' gate words', () => {
  it('an app with gate matches ships its words as files — never verbs on the manifest', () => {
    for (const m of MANIFESTS) {
      const app = appOf(m);
      const onManifest = matched(m).filter((op) => Array.isArray(op.surfaces.slash.match.verbs)).map((op) => op.id);
      expect(onManifest, `${app}: verbs on the manifest — they go in its gate.<lang>.json`).toEqual([]);
      if (matched(m).length) expect(Boolean(m.gateWords), `${app} has gate matches but no word files`).toBe(true);
    }
  });

  for (const m of MANIFESTS.filter((x) => x.gateWords)) {
    const app = appOf(m);
    for (const [lang, entries] of Object.entries(m.gateWords)) {
      it(`${app} · ${lang}: every matched op has its entry, and each entry an op`, () => {
        const want = matched(m).map((op) => `${app}.${op.id}`);
        expect(want.filter((id) => !entries[id]), `${lang} lacks`).toEqual([]);
        expect(Object.keys(entries).filter((id) => !want.includes(id)), `${lang} names no such op`).toEqual([]);
        for (const id of want) {
          const e = entries[id];
          expect(typeof e.doc === 'string' && e.doc.length > 5, `${lang} ${id}: doc`).toBe(true);
          expect(Array.isArray(e.verbs) && e.verbs.length > 0, `${lang} ${id}: verbs`).toBe(true);
          expect(Array.isArray(e.examples) && e.examples.length > 0, `${lang} ${id}: examples`).toBe(true);
          // the doc is for whoever translates (a person or a model): English in every language's file
          if (m.gateWords.en) expect(e.doc, `${lang} ${id}: the doc is the English one`).toBe(m.gateWords.en[id]?.doc);
          const drops = matched(m).find((op) => `${app}.${op.id}` === id)?.surfaces.slash.match.dropTrailing;
          expect(Array.isArray(drops), `${id}: the dropped words are in the files, not on the manifest`).toBe(false);
          if (e.dropTrailing !== undefined) expect(drops, `${lang} ${id}: words to drop, but the match does not say it drops them`).toBe(true);
        }
      });

      it(`${app} · ${lang}: each example is its own op in that language; no not-line is`, () => {
        const { rules } = createGate([m], { locale: lang });
        const take = (text) => { for (const r of rules) { const c = r.command(text); if (c) return c; } return null; };
        for (const [id, e] of Object.entries(entries)) {
          const op = id.slice(app.length + 1);
          for (const ex of e.examples) expect(take(ex)?.opId, `${lang} "${ex}" should be ${op}`).toBe(op);
          for (const no of e.not ?? []) expect(take(no)?.opId, `${lang} "${no}" must not be ${op}`).not.toBe(op);
        }
      });
    }
  }

  it('a locale takes only its own words; without one, every language\'s', () => {
    const { rules: nl } = createGate([calendarManifest], { locale: 'nl' });
    const { rules: en } = createGate([calendarManifest], { locale: 'en' });
    const { rules: any } = createGate([calendarManifest]);
    const take = (rules, text) => rules.map((r) => r.command(text)).find(Boolean)?.opId ?? null;
    expect(take(nl, 'accept dentist')).toBeNull();
    expect(take(en, 'accepteer tandarts')).toBeNull();
    expect(take(any, 'accept dentist')).toBe('rsvpAccept');
    expect(take(any, 'accepteer tandarts')).toBe('rsvpAccept');
  });

  it('the connector words a match drops are its language\'s: "met" is a Dutch word, not an English one', () => {
    const title = (locale, text) => createGate([calendarManifest], { locale }).rules.map((r) => r.command(text)).find(Boolean)?.args?.title;
    expect(title('en', 'new appointment dentist with Bert')).toBe('dentist');
    expect(title('nl', 'nieuwe afspraak tandarts met Bert')).toBe('tandarts');
    expect(title('en', 'schedule dinner met Sarah')).toBe('dinner met Sarah');
    expect(title('nl', 'plan etentje with Sarah')).toBe('etentje with Sarah');
  });
});
