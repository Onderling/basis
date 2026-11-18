/**
 * The "+" says what it is (the assistant plan, step B; stories 1 and 2): three lines the first time a self's conversation
 * opens, with examples built from what the person HAS, every one of them a line the "+" really reads; and, on a later
 * open, one line for a circle the person has joined since, said once. No model call anywhere.
 */
import { describe, it, expect } from 'vitest';
import { plusIntro, plusNews } from '../../src/v2/plusIntro.js';
import { createPlusDoor } from '../../src/assistant/plusDoor.js';
import { catalogueManifests } from '../../src/v2/manifestSources.js';
import { EventLog } from '../../src/eventLog.js';
import { createBotThreads, memoryThreadStore } from '../../src/v2/botThreads.js';
import nl from '../../src/locales/circle.nl.json';
import en from '../../src/locales/circle.en.json';

const manifestsByOrigin = Object.fromEntries(catalogueManifests().filter((m) => m?.app).map((m) => [m.app, m]));
const shopping = { name: 'boodschappen', kind: 'list', defaultChild: null, aliases: [] };
const thuis = { id: 'k1', name: 'Thuis', manifestsByOrigin, lists: [] };
// the Dutch bundle, filled: the examples must be real lines in the person's language
const tOf = (bundle) => (k, v = {}) => {
  const node = k.replace(/^circle\./, '').split('.').reduce((o, p) => o?.[p], bundle);
  const s = typeof node === 'string' ? node : node?.text;
  return typeof s === 'string' ? s.replace(/{{(\w+)}}/g, (_, n) => String(v[n] ?? '')) : k;
};
const tNl = tOf(nl);
const tEn = tOf(en);

describe('the first open: three lines, examples from what the person has', () => {
  it('a person with an own list and a circle: an example on her list, one naming her circle, one more; three in all', () => {
    const r = plusIntro({ ownLists: [shopping], circles: [thuis], t: tNl, lang: 'nl' });
    expect(r.lines).toHaveLength(2);
    expect(r.examples).toHaveLength(3);
    expect(r.examples[0]).toMatch(/boodschappen/);
    expect(r.examples[1]).toMatch(/^Thuis: /);
    expect(new Set(r.examples).size, 'no example twice').toBe(3);
  });
  it('a person with nothing yet still gets three examples', () => {
    const r = plusIntro({ ownLists: [], circles: [], t: tNl, lang: 'nl' });
    expect(r.examples).toHaveLength(3);
  });
  it('every example, nl and en, is a line the "+" READS here, with no model: an example that does nothing would contradict it', async () => {
    for (const [lang, tL] of [['nl', tNl], ['en', tEn]]) for (const has of [{ ownLists: [shopping], circles: [thuis] }, { ownLists: [], circles: [] }]) {
      const { examples } = plusIntro({ ...has, t: tL, lang });
      const d = createPlusDoor({
        llm: null, t: tL, lang, threads: createBotThreads({ eventLog: new EventLog({ initial: [], muted: [] }), store: memoryThreadStore() }), threadId: 'own:me',
        circles: async () => has.circles, ownListsOf: async () => has.ownLists, runInCircle: async () => ({ done: 'ok' }), readAs: () => async () => ({ ok: true, items: [] }),
      });
      const readsNothing = (r) => r?.error === tL('circle.vandaag.plus_line_unread') || String(r?.done ?? '').startsWith(tL('circle.vandaag.plus_no_model', { path: '' }).slice(0, 25));
      // the probe can tell: a line nobody reads is caught by it
      expect(readsNothing(await d.read('qwerty zxcv bnm')), 'the probe sees a line the "+" does not read').toBe(true);
      for (const ex of examples) {
        const r = await d.read(ex);
        expect(readsNothing(r), `"${ex}" is read (${JSON.stringify(r).slice(0, 120)})`).toBe(false);
      }
    }
  });
  it('the words are in both languages', async () => {
    const en = (await import('../../src/locales/circle.en.json')).default;
    for (const bundle of [nl, en]) {
      for (const k of ['plus_intro_own', 'plus_intro_circle', 'plus_intro_try', 'plus_news_circle']) {
        const v = bundle.vandaag?.[k];
        expect(typeof v === 'string' ? v : v?.text, k).toBeTruthy();
      }
    }
  });
});

describe('what changed since the last open: said once', () => {
  it('a circle joined since: one line naming it; then nothing again; a circle gone says nothing', () => {
    const first = plusNews({ told: null, circles: [thuis], t: tNl });
    expect(first.line, 'the first open is the intro, not news').toBeNull();
    const werk = { id: 'k2', name: 'Werk', manifestsByOrigin, lists: [] };
    const later = plusNews({ told: first.told, circles: [thuis, werk], t: tNl });
    expect(later.line).toMatch(/Werk/);
    expect(plusNews({ told: later.told, circles: [thuis, werk], t: tNl }).line, 'said once').toBeNull();
    expect(plusNews({ told: later.told, circles: [werk], t: tNl }).line, 'a circle gone says nothing').toBeNull();
  });
  it('the Help circle is never news (the "+" never offers it)', () => {
    const first = plusNews({ told: null, circles: [], t: tNl });
    expect(plusNews({ told: first.told, circles: [{ id: 'help', name: 'Help' }], t: tNl, helpCircleId: 'help' }).line).toBeNull();
  });
});
