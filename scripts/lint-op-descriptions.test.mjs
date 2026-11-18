import { describe, it, expect } from 'vitest';
import { auditDescriptions, shrunkBaseline, unreadFiles, auditGeneric, auditHelpPhrases, helpPhraseKeys, unreadBesideFiles } from './lint-op-descriptions.mjs';

// one app, two ops; `params` per op
const declared = { lists: { addToList: ['list', 'text'], listLists: [] }, tasks: { addTask: ['title'] } };
const good = {
  addToList: { what: 'Zet iets op een lijst.', params: { list: 'welke lijst', text: 'wat erop komt' } },
  listLists: { what: 'Laat je lijsten zien.', params: {} },
};
const goodEn = {
  addToList: { what: 'Put something on a list.', params: { list: 'which list', text: 'what goes on it' } },
  listLists: { what: 'Show your lists.', params: {} },
};

describe('lint-op-descriptions', () => {
  it('is green when a described app covers every op and param in both languages, and the rest are owed', () => {
    expect(auditDescriptions({ declared, files: { lists: { nl: good, en: goodEn } }, baseline: ['tasks'] })).toEqual([]);
  });

  it('is red for a missing op, a missing param, a missing language, an orphan op or param', () => {
    const nl = { addToList: { what: 'Zet iets op een lijst.', params: { list: 'welke lijst', gone: 'x' } }, ghostOp: { what: 'Niets.' } };
    const p = auditDescriptions({ declared, files: { lists: { nl, en: goodEn } }, baseline: ['tasks'] });
    expect(p.some((x) => /lists\.listLists has no `what` \(nl\)/.test(x))).toBe(true);
    expect(p.some((x) => /lists\.addToList param `text` has no phrase \(nl\)/.test(x))).toBe(true);
    expect(p.some((x) => /lists\.ghostOp \(nl\) describes an op no manifest declares/.test(x))).toBe(true);
    expect(p.some((x) => /lists\.addToList param `gone` \(nl\) describes a param the op does not declare/.test(x))).toBe(true);
    expect(auditDescriptions({ declared, files: { lists: { nl: good } }, baseline: ['tasks'] }).some((x) => /lists has no descriptions\.en\.json/.test(x))).toBe(true);
  });

  it('is red for a sentence too long, a phrase too long, and a dash', () => {
    const long = 'een twee drie vier vijf zes zeven acht negen tien elf twaalf dertien veertien vijftien zestien zeventien achttien negentien twintig eenentwintig';
    const nl = { ...good, listLists: { what: long, params: {} }, addToList: { what: 'Zet iets op een lijst — nu.', params: { list: 'een twee drie vier vijf zes zeven acht negen', text: 'x' } } };
    const p = auditDescriptions({ declared, files: { lists: { nl, en: goodEn } }, baseline: ['tasks'] });
    expect(p.some((x) => /lists\.listLists `what` \(nl\) is 21 words/.test(x))).toBe(true);
    expect(p.some((x) => /lists\.addToList param `list` \(nl\) is 9 words/.test(x))).toBe(true);
    expect(p.some((x) => /lists\.addToList `what` \(nl\) has a dash/.test(x))).toBe(true);
  });

  it('is red for an app with no file that is not owed, and for a baseline app that now has its file or no manifest', () => {
    const p = auditDescriptions({ declared, files: { lists: { nl: good, en: goodEn } }, baseline: ['lists', 'gone'] });
    expect(p.some((x) => /tasks has no descriptions and is not in the baseline/.test(x))).toBe(true);
    expect(p.some((x) => /baseline lists lists, which now has its descriptions/.test(x))).toBe(true);
    expect(p.some((x) => /baseline lists gone, which no manifest declares/.test(x))).toBe(true);
  });

  it('--update only SHRINKS the baseline: described or gone apps leave, a new undescribed app is never added', () => {
    const declared2 = { ...declared, brandNew: { x: [] } };
    expect(shrunkBaseline({ declared: declared2, files: { lists: { nl: good, en: goodEn } }, baseline: ['lists', 'tasks', 'gone'] })).toEqual(['tasks']);
  });

  it('a descriptions file on disk that the reader does not import is red: words nobody reads', () => {
    const onDisk = ['apps/lists/descriptions.en.json', 'apps/lists/descriptions.nl.json', 'apps/calendar/descriptions.nl.json'];
    expect(unreadFiles(onDisk, { lists: { en: {}, nl: {} } })).toEqual(['apps/calendar/descriptions.nl.json']);
    expect(unreadFiles(onDisk.slice(0, 2), { lists: { en: {}, nl: {} } })).toEqual([]);
  });

  it('generic ops: every verb a described noun uses has its sentence in both languages; every such noun its two names', () => {
    const generic = [{ app: 'household', noun: 'note', atoms: ['add', 'list'] }, { app: 'pinboard', noun: 'lend', atoms: ['complete'] }];
    const atomWords = { en: { add: { what: 'Make {{a_noun}}.' }, list: { what: 'Show your {{nouns}}.' } }, nl: { add: { what: 'Maak {{a_noun}}.' } } };
    const names = { 'household.note': { en: { one: 'note', other: 'notes' }, nl: { one: 'notitie', other: 'notities' } } };
    const p = auditGeneric({ generic, atomWords, names, owed: ['pinboard.lend'] });
    expect(p).toEqual(['the generic verb `list` has no sentence (nl), and household.note uses it']);
    const p2 = auditGeneric({ generic, atomWords: { ...atomWords, nl: { ...atomWords.nl, list: { what: 'Laat je {{nouns}} zien.' } } }, names: {}, owed: [] });
    expect(p2.some((x) => /household\.note has no names \(en\)/.test(x))).toBe(true);
    expect(p2.some((x) => /pinboard\.lend has no names \(nl\)/.test(x))).toBe(true);
    expect(p2.some((x) => /the generic verb `complete` has no sentence \(en\), and pinboard\.lend uses it/.test(x))).toBe(true);
  });
  it('an owed noun that is now named, or no longer generic, is a stale baseline entry', () => {
    const generic = [{ app: 'household', noun: 'note', atoms: ['add'] }];
    const atomWords = { en: { add: { what: 'Make {{a_noun}}.' } }, nl: { add: { what: 'Maak {{a_noun}}.' } } };
    const names = { 'household.note': { en: { one: 'note', other: 'notes' }, nl: { one: 'notitie', other: 'notities' } } };
    const p = auditGeneric({ generic, atomWords, names, owed: ['household.note', 'gone.thing'] });
    expect(p.some((x) => /baseline owes household\.note, which now has its words/.test(x))).toBe(true);
    expect(p.some((x) => /baseline owes gone\.thing, which is no generic noun/.test(x))).toBe(true);
  });
});

describe('the bot help phrases are a frozen second home (L1033)', () => {
  const describe_ = (app, op) => (app === 'lists' && op === 'listLists' ? { what: 'x' } : null);
  it('a frozen key whose op is described: clean', () => {
    expect(auditHelpPhrases({ keys: ['lists.listLists'], frozen: ['lists.listLists'], describe: describe_ })).toEqual([]);
  });
  it('a NEW key is red, and so is a key whose op has no description', () => {
    const p = auditHelpPhrases({ keys: ['lists.listLists', 'lists.addToList'], frozen: ['lists.listLists'], describe: describe_ });
    expect(p.some((x) => /lists\.addToList is a NEW help phrase/.test(x))).toBe(true);
    expect(p.some((x) => /lists\.addToList names an op with no description/.test(x))).toBe(true);
  });
  it('a frozen key no locale has any more asks for --update (the list only shrinks)', () => {
    const p = auditHelpPhrases({ keys: [], frozen: ['lists.listLists'], describe: describe_ });
    expect(p.some((x) => /no locale has any more/.test(x))).toBe(true);
  });
  it('reads the keys off a bundle', () => {
    expect(helpPhraseKeys({ bot: { help: { ops: { lists: { listLists: {}, shopVisit: {} } } } } })).toEqual(['lists.listLists', 'lists.shopVisit']);
  });
});

describe('a words file beside a manifest in basis counts only when the reader imports it', () => {
  it('imported: clean; not imported: red', () => {
    const reader = "import aEn from './assistantManifest.descriptions.en.json' with { type: 'json' };";
    expect(unreadBesideFiles(['apps/basis/src/v2/assistantManifest.descriptions.en.json'], reader)).toEqual([]);
    expect(unreadBesideFiles(['apps/basis/src/v2/keyManifest.descriptions.nl.json'], reader)).toEqual(['apps/basis/src/v2/keyManifest.descriptions.nl.json']);
  });
});
