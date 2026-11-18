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
  it('a circle whose name has not arrived yet is not news: left out of the line and of what is kept, then told once BY NAME', () => {
    const first = plusNews({ told: null, circles: [thuis], t: tNl });
    const fresh = plusNews({ told: first.told, circles: [thuis, { id: 'k9', name: '' }], t: tNl });
    expect(fresh.line, 'no "untitled" news').toBeNull();
    expect(fresh.told.circles, 'not kept as told').not.toContain('k9');
    const named = plusNews({ told: fresh.told, circles: [thuis, { id: 'k9', name: 'Buurt' }], t: tNl });
    expect(named.line).toMatch(/Buurt/);
    // a circle already told whose name is missing for a moment stays told: no second news when it comes back
    const blink = plusNews({ told: named.told, circles: [{ id: 'k1', name: '' }, { id: 'k9', name: 'Buurt' }], t: tNl });
    expect(blink.line).toBeNull();
    expect(plusNews({ told: blink.told, circles: [thuis, { id: 'k9', name: 'Buurt' }], t: tNl }).line, 'Thuis was told before').toBeNull();
  });
  it('the first open keeps only the named circles too, so a nameless one is news once it has its name', () => {
    const first = plusNews({ told: null, circles: [thuis, { id: 'k9' }], t: tNl });
    expect(first.told.circles).toEqual(['k1']);
    expect(plusNews({ told: first.told, circles: [thuis, { id: 'k9', name: 'Buurt' }], t: tNl }).line).toMatch(/Buurt/);
  });
  it('the Help circle is never news (the "+" never offers it)', () => {
    const first = plusNews({ told: null, circles: [], t: tNl });
    expect(plusNews({ told: first.told, circles: [{ id: 'help', name: 'Help' }], t: tNl, helpCircleId: 'help' }).line).toBeNull();
  });
});

describe('the door opens the conversation: the intro once, then what changed, kept on this device (plus-told)', async () => {
  const { entryKind, RETAIN, SYNC, isMirroredKind } = await import('@onderling/item-store');
  const mk = (log, circles) => createPlusDoor({
    llm: null, t: tNl, lang: 'nl', threads: createBotThreads({ eventLog: log, store: memoryThreadStore() }), threadId: 'own:me',
    circles: async () => circles.list, ownListsOf: async () => [], toldLog: log,
  });
  it('first open: the intro; again: nothing; a circle joined: one line, once; forgetting the conversation: the intro again', async () => {
    const log = new EventLog({ initial: [], muted: [] });
    const circles = { list: [thuis] };
    // a fresh door per call, as the phone composes one: what was told lives on the log, not in the door
    const first = await mk(log, circles).opening({});
    expect(first.intro?.examples?.length).toBe(3);
    expect(await mk(log, circles).opening({}), 'said once').toEqual({});
    circles.list = [thuis, { id: 'k2', name: 'Werk', manifestsByOrigin, lists: [] }];
    expect((await mk(log, circles).opening({})).news).toMatch(/Werk/);
    expect(await mk(log, circles).opening({}), 'the news is said once').toEqual({});
    await mk(log, circles).forget({});
    expect((await mk(log, circles).opening({})).intro, 'forgotten: a first open again').toBeTruthy();
  });
  it('one entry per self, whatever happens: the newest carries the whole set', async () => {
    const log = new EventLog({ initial: [], muted: [] });
    const circles = { list: [thuis] };
    for (let i = 0; i < 4; i += 1) await mk(log, circles).opening({});
    circles.list = [thuis, { id: 'k3', name: 'Club' }];
    await mk(log, circles).opening({});
    const told = log.query().filter((e) => e.type === 'plus-told');
    expect(told).toHaveLength(1);
    expect(told[0].payload.circles.sort()).toEqual(['k1', 'k3']);
  });
  it('the kind: system plumbing, never wakes, kept while the self exists (record), never leaves the device, not mirrored', () => {
    const k = entryKind('plus-told');
    expect(k).toMatchObject({ lane: 'system', wakes: false, retain: RETAIN.RECORD, audit: false, syncPolicy: SYNC.NONE });
    expect(isMirroredKind('plus-told')).toBe(false);
  });
});

describe('a circle no name has reached is marked as such where its placeholder is made (Fable, step B)', async () => {
  const { normalizeCircle, mergeCircles } = await import('../../src/v2/circleModel.js');
  const { circleSourcesFromAgent } = await import('../../src/v2/circleSources.js');
  it('the sources give the word AND the mark; a named one has no mark', async () => {
    const src = circleSourcesFromAgent({ callSkill: async () => ({ circles: ['k1', 'k9'], names: { k1: 'Thuis' } }), unnamedCircleName: () => 'Kring zonder naam' });
    const got = await src.fetchGroups();
    expect(got.find((c) => c.id === 'k9')).toMatchObject({ name: 'Kring zonder naam', unnamed: true });
    expect(got.find((c) => c.id === 'k1').unnamed).toBeFalsy();
  });
  it('the model keeps the mark, counts a fallback to the id as nameless, and a real name from another source wins', () => {
    expect(normalizeCircle({ id: 'k9', name: 'Kring zonder naam', unnamed: true }).unnamed).toBe(true);
    expect(normalizeCircle({ id: 'k8' }).unnamed, 'the id is no name').toBe(true);
    expect(normalizeCircle({ id: 'k1', name: 'Thuis' }).unnamed).toBeUndefined();
    const [c] = mergeCircles([{ id: 'k9', name: 'Kring zonder naam', unnamed: true }], [{ id: 'k9', name: 'Buurt' }]);
    expect(c).toMatchObject({ name: 'Buurt' });
    expect(c.unnamed).toBeFalsy();
  });
  it('the "+" counts a marked circle as nameless: no news, not kept, not an example', () => {
    const first = plusNews({ told: null, circles: [thuis], t: tNl });
    const marked = { id: 'k9', name: 'Kring zonder naam', unnamed: true };
    const r = plusNews({ told: first.told, circles: [thuis, marked], t: tNl });
    expect(r.line).toBeNull();
    expect(r.told.circles).not.toContain('k9');
    expect(plusIntro({ ownLists: [], circles: [marked], t: tNl }).examples.join(' ')).not.toMatch(/zonder naam/);
  });
});

describe('"help" says what the "+" offers HERE, generated, never a kept list (the plan\'s step B)', () => {
  const t = (k, v) => (v ? `${k} ${JSON.stringify(v)}` : k);
  it('what it reads, what it makes, the circle line only with a circle, and the model line last', async () => {
    const { plusHelp } = await import('../../src/v2/plusIntro.js');
    const r = plusHelp({ reads: ['/agenda', '/notities'], acts: ['Een notitie', 'Een afspraak'], hasCircle: true, routeLine: 'route: lokaal', t });
    expect(r).toEqual([
      'circle.vandaag.plus_help_reads {"reads":"/agenda, /notities"}',
      'circle.vandaag.plus_help_makes {"acts":"Een notitie, Een afspraak"}',
      'circle.vandaag.plus_intro_circle',
      'route: lokaal',
    ]);
  });
  it('no circle: no circle line; no model: the model line says how without one; nothing to read: no read line', async () => {
    const { plusHelp } = await import('../../src/v2/plusIntro.js');
    const r = plusHelp({ reads: [], acts: ['Een notitie'], hasCircle: false, routeLine: null, modelPlace: 'Mij → Instellingen', t });
    expect(r).toEqual([
      'circle.vandaag.plus_help_makes {"acts":"Een notitie"}',
      'circle.vandaag.plus_help_no_model {"place":"Mij → Instellingen"}',
    ]);
  });
  it('the door answers "help" with it, from its own catalogue: a read it offers is named, a circle line only with a circle', async () => {
    const log = new EventLog({ initial: [], muted: [] });
    const d = createPlusDoor({ llm: null, t: tNl, lang: 'nl', threads: createBotThreads({ eventLog: log, store: memoryThreadStore() }), threadId: 'own:me', circles: async () => [thuis], ownListsOf: async () => [shopping] });
    const r = await d.read('help');
    expect(r.done).toMatch(/^Ik kan laten zien: \//);
    expect(r.done).toMatch(/Ik kan voor je maken: /);
    expect(r.done).toContain(tNl('circle.vandaag.plus_intro_circle'));
    expect(r.done).toMatch(/Zonder model lees ik vaste zinnen/);
    // and what to try, the intro's examples (each read by the door, tested above): help still teaches the list lines
    expect(r.done).toMatch(/Probeer: .*zet melk op boodschappen/);
    for (const k of ['plus_help_reads', 'plus_help_makes', 'plus_help_no_model']) expect(en.vandaag?.[k]?.text, k).toBeTruthy();
  });
});
