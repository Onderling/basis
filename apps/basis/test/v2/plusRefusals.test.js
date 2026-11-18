/**
 * THE "+" SAYS WHY IT DID NOTHING (the assistant plan's step B, part 2b), with no model call:
 *   - a line it could not read: the plain line, plus ONE example that fits the words (a line the "+" reads here);
 *   - a line about one of the person's circles that it cannot place: it does not read circles, and what to do instead.
 * Never the model's own refusal text as the system speaking (that stays the model-refused line, plusNoModel.test.js).
 */
import { describe, it, expect } from 'vitest';
import { plusNearest } from '../../src/v2/plusIntro.js';
import { createPlusDoor } from '../../src/assistant/plusDoor.js';
import { catalogueManifests } from '../../src/v2/manifestSources.js';
import { EventLog } from '../../src/eventLog.js';
import { createBotThreads, memoryThreadStore } from '../../src/v2/botThreads.js';
import nl from '../../src/locales/circle.nl.json';

const manifestsByOrigin = Object.fromEntries(catalogueManifests().filter((m) => m?.app).map((m) => [m.app, m]));
const t = (k, v = {}) => {
  const node = k.replace(/^circle\./, '').split('.').reduce((o, p) => o?.[p], nl);
  const s = typeof node === 'string' ? node : node?.text;
  return typeof s === 'string' ? s.replace(/{{(\w+)}}/g, (_, n) => String(v[n] ?? '')) : k;
};
const shopping = { name: 'boodschappen', kind: 'list', defaultChild: null, aliases: [] };
const thuis = { id: 'k1', name: 'Thuis', manifestsByOrigin, lists: [] };
const door = (circles = [thuis], lists = [shopping]) => createPlusDoor({
  llm: null, t, lang: 'nl', threads: createBotThreads({ eventLog: new EventLog({ initial: [], muted: [] }), store: memoryThreadStore() }),
  threadId: 'own:me', circles: async () => circles, ownListsOf: async () => lists, runInCircle: async () => ({ done: 'ok' }),
});

describe('the nearest example', () => {
  it('the readable line that shares the most words with what was typed; none shares a word: none', () => {
    const pool = ['zet melk op boodschappen', 'onthoud dat de sleutel bij de buren ligt', 'wat heb ik morgen gepland?'];
    expect(plusNearest('melk erbij op de lijst', pool)).toBe('zet melk op boodschappen');
    expect(plusNearest('wat moet ik morgen doen', pool)).toBe('wat heb ik morgen gepland?');
    expect(plusNearest('qwerty zxcv', pool)).toBeNull();
    expect(plusNearest('', pool)).toBeNull();
  });
});

describe('a line the "+" could not read', () => {
  const TRY = /\sProbeer bijvoorbeeld: (.+)$/;
  it('no model: the no-model answer, then one example that fits its words, which the "+" reads', async () => {
    const r = await door().read('melk erbij graag');
    expect(r.done.startsWith(t('circle.vandaag.plus_no_model', { path: '' }).slice(0, 25))).toBe(true);
    const ex = TRY.exec(r.done)?.[1];
    expect(ex, r.done).toMatch(/melk/);
    const again = await door().read(ex);
    expect(again.error ?? '', `"${ex}" is read`).not.toMatch(/niet lezen/);
    expect(String(again.done ?? ''), `"${ex}" is read`).not.toMatch(/geen eigen model/);
  });
  it('a model that found nothing: the plain line, then the example', async () => {
    const d = createPlusDoor({
      llm: { invoke: async () => null }, interpret: async () => null, t, lang: 'nl',
      threads: createBotThreads({ eventLog: new EventLog({ initial: [], muted: [] }), store: memoryThreadStore() }),
      threadId: 'own:me', circles: async () => [thuis], ownListsOf: async () => [shopping],
    });
    const r = await d.read('melk erbij graag');
    expect(r.error).toMatch(/^Dat begreep ik niet\. Probeer bijvoorbeeld: .*melk/);
    // none fits: today's line
    expect((await d.read('qwerty zxcv')).error).toBe(t('circle.vandaag.plus_line_unread'));
  });
  it('with no example that fits, the line alone', async () => {
    const r = await door().read('qwerty zxcv');
    expect(r.done).not.toMatch(TRY);
  });
});

describe('a line about one of the person\'s circles that the "+" cannot place', () => {
  it('says it does not read circles and what to do instead (not "I could not read that")', async () => {
    const r = await door().read('wat is er gebeurd in Thuis vandaag');
    expect(r.error).toBe('Ik lees niet mee in Thuis. Open de kring, of zeg wat ik erin moet zetten.');
  });
  it('a line the "+" CAN place in that circle is never refused for it', async () => {
    const r = await door().read('Thuis: maak een lijst Boodschappen');
    expect(r.error ?? null).toBeNull();
  });
});

describe('a circle\'s name is no help topic', async () => {
  const { plusLineOutcome } = await import('../../src/v2/vandaagPlus.js');
  it('a line about a circle does not get the help card its NAME matches ("Thuis" is not the personas card)', () => {
    const o = plusLineOutcome('wat is er gebeurd in Thuis vandaag', { circles: [thuis], lang: 'nl' });
    expect(o?.card?.cardId ?? null).toBeNull();
  });
  it('a real how-to question that names a circle still gets its card', () => {
    const o = plusLineOutcome('hoe nodig ik iemand uit in Thuis?', { circles: [thuis], lang: 'nl' });
    expect(o?.kind).toBe('help');
    expect(o?.card?.cardId).toBeTruthy();
  });
});

describe('both stay no_act in the person\'s own record', () => {
  it('a circle\'s line placed nowhere, and a line not understood: each one no_act, never the words', async () => {
    const out = [];
    const d = createPlusDoor({
      llm: null, t, lang: 'nl', threads: createBotThreads({ eventLog: new EventLog({ initial: [], muted: [] }), store: memoryThreadStore() }),
      threadId: 'own:me', circles: async () => [thuis], ownListsOf: async () => [shopping], noteOwn: (e) => { out.push(e); },
    });
    await d.read('wat is er gebeurd in Thuis vandaag');
    await d.read('melk erbij graag');
    expect(out.map((e) => `${e.outcome}:${e.door}:${e.op}`)).toEqual(['no_act:phrase:null', 'no_act:phrase:null']);
    expect(JSON.stringify(out)).not.toMatch(/Thuis|melk/);
  });
});
