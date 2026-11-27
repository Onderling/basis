import { describe, it, expect } from 'vitest';
import { auditDescriptions, shrunkBaseline, unreadFiles, auditGeneric, auditHelpPhrases, helpPhraseKeys, unreadBesideFiles, descriptionsFile, unreadMessage } from './lint-op-descriptions.mjs';

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
    expect(p).toEqual(['apps/basis/src/locales/circle.nl.json: the generic verb `list` has no sentence (nl), and household.note uses it.\n    Fix: add settings.verb_what.list in apps/basis/src/locales/circle.nl.json.']);
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

describe('a red line names the file to open and says what to do', () => {
  const manifestFiles = { lists: 'apps/lists/manifest.js', tasks: 'apps/tasks-v0/manifest.js', keys: 'apps/basis/src/v2/keyManifest.js' };
  const fixed = (x) => /\n {4}Fix: \S/.test(x);
  it('the descriptions file sits beside the manifest that declares the app', () => {
    expect(descriptionsFile('apps/tasks-v0/manifest.js', 'nl')).toBe('apps/tasks-v0/descriptions.nl.json');
    expect(descriptionsFile('apps/basis/src/v2/keyManifest.js', 'en')).toBe('apps/basis/src/v2/keyManifest.descriptions.en.json');
  });
  it('every description problem names the descriptions file (or the baseline) and has a Fix line', () => {
    const nl = { addToList: { what: 'Zet iets op een lijst — nu.', params: { list: 'welke lijst', gone: 'x' } }, ghostOp: { what: 'Niets.' } };
    const p = auditDescriptions({ declared, files: { lists: { nl, en: goodEn } }, baseline: ['gone'], manifestFiles });
    expect(p.find((x) => /lists\.listLists has no `what` \(nl\)/.test(x))).toMatch(/^apps\/lists\/descriptions\.nl\.json: /);
    expect(p.find((x) => /ghostOp/.test(x))).toMatch(/^apps\/lists\/descriptions\.nl\.json: .*\n {4}Fix: .*apps\/lists\/manifest\.js/);
    expect(p.find((x) => /tasks has no descriptions/.test(x))).toMatch(/apps\/tasks-v0\/descriptions\.en\.json/);
    expect(p.find((x) => /baseline lists gone/.test(x))).toMatch(/^scripts\/op-descriptions-baseline\.json: .*\n {4}Fix: run node scripts\/lint-op-descriptions\.mjs --update/);
    expect(p.length).toBeGreaterThan(4);
    expect(p.every(fixed)).toBe(true);
  });
  it('a generic-ops problem names the manifest, the locale or the baseline, with a Fix line', () => {
    const generic = [{ app: 'lists', noun: 'note', atoms: ['add'] }];
    const p = auditGeneric({ generic, atomWords: { en: {}, nl: {} }, names: {}, owed: ['gone.thing'], manifestFiles });
    expect(p.find((x) => /lists\.note has no names \(en\)/.test(x))).toMatch(/^apps\/lists\/manifest\.js: /);
    expect(p.find((x) => /generic verb `add` has no sentence \(nl\)/.test(x))).toMatch(/^apps\/basis\/src\/locales\/circle\.nl\.json: /);
    expect(p.find((x) => /baseline owes gone\.thing/.test(x))).toMatch(/^scripts\/op-descriptions-baseline\.json: /);
    expect(p.every(fixed)).toBe(true);
  });
  it('a help-phrase problem names the shared locale or the baseline, with a Fix line', () => {
    const p = auditHelpPhrases({ keys: ['lists.addToList'], frozen: ['lists.gone'], describe: () => null, manifestFiles });
    expect(p.find((x) => /NEW help phrase/.test(x))).toMatch(/^apps\/basis\/src\/locales\/circle\.\{en,nl\}\.json: .*\n {4}Fix: .*apps\/lists\/descriptions\.en\.json/);
    expect(p.find((x) => /no locale has any more/.test(x))).toMatch(/^scripts\/op-descriptions-baseline\.json: /);
    expect(p.every(fixed)).toBe(true);
  });
  it('an unread words file names itself and the reader to import it in', () => {
    expect(unreadMessage('apps/calendar/descriptions.nl.json')).toMatch(/^apps\/calendar\/descriptions\.nl\.json: .*\n {4}Fix: import it in apps\/basis\/src\/v2\/opDescriptions\.js/);
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
