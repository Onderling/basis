/**
 * Self-test for lint-storage-register: it sees a storage name written by hand (a literal, a template starting with
 * literal text, an UPPER_CASE const) at each kind of storage call, and it does not see a name taken from the register,
 * a name passed through, or a `scope:` that is not storage. And the repo itself is clean.
 */
import { describe, it, expect } from 'vitest';
import { handNamesIn, check, OPENED_ELSEWHERE, sealProblems, WRITES_FOR_ITS_CALLER } from './lint-storage-register.mjs';
import { STORAGE } from '../apps/basis/src/v2/storageRegister.js';

const names = (t) => handNamesIn(t).map((h) => h.name);

describe('lint-storage-register', () => {
  it('sees a literal at getItem / setItem / removeItem', () => {
    expect(names("localStorage.getItem('basis.lastTab');\nAsyncStorage.setItem('cc.x', v);\ns.removeItem(\"cc.y\");")).toEqual(['basis.lastTab', 'cc.x', 'cc.y']);
  });
  it('sees a template that starts with literal text, and an UPPER_CASE const', () => {
    expect(names("const KEY = 'basis.availability';\nkv.getItem(KEY);\nAsyncStorage.getItem(`basis.circlePolicy.${id}`);")).toEqual(['basis.availability', 'basis.circlePolicy.${id}']);
  });
  it('sees the backend and vault builders, and dbName', () => {
    expect(names("pickWebBackend('basis.agent-registry');\nmakeBrowserVault('basis.chat-id:');\nsealedLocalBackend(createAsBackend({ AsyncStorage, scope: 'basis.device-log' }));\nbuild({ dbName: 'basis.outbox' });"))
      .toEqual(['basis.agent-registry', 'basis.chat-id:', 'basis.device-log', 'basis.outbox']);
  });
  it('does not see a register call, a name passed through, or a scope that is not storage', () => {
    expect(names("kv.getItem(storageName('lastTab'));\ns.getItem(`${prefix}${id}`);\nconst control = { scope: 'circle' };\nstore.getItem(key);")).toEqual([]);
  });
  it('sees a key built by hand from a prefix row (a key helper), through check()', async () => {
    const { mkdirSync, writeFileSync, rmSync } = await import('node:fs');
    const dir = new URL('../apps/basis/src/guard-fixture-storage-tmp/', import.meta.url);
    mkdirSync(dir, { recursive: true });
    writeFileSync(new URL('keyHelper.js', dir), 'export const key = (id) => `basis.circlePolicy.${id}`;\n');
    try {
      expect((await check()).some((p) => p.includes("builds a 'basis.circlePolicy.' key by hand"))).toBe(true);
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });
  describe('rule 3: the seal ruled on the row', () => {
    const REG = {
      secret: { name: 'cc.secret', seal: 'sealed' },
      flag:   { name: 'cc.flag', seal: 'not content: a first-run flag' },
    };
    const run = (texts, reg = REG) => sealProblems(reg, texts).filter((p) => !p.startsWith('WRITES_FOR_ITS_CALLER'));
    it('a raw write to a sealed row is red, named or through a const', () => {
      expect(run({ 'a.js': "localStorage.setItem(storageName('secret'), v);" })).toHaveLength(1);
      expect(run({ 'a.js': "const K = storageName('secret');\nAsyncStorage.setItem(K, v);" })).toHaveLength(1);
    });
    it('multiSet and mergeItem are raw writes too (none exists today; a later one is seen)', () => {
      expect(run({ 'a.js': "AsyncStorage.multiSet([[storageName('secret'), v]]);" })).toHaveLength(1);
      expect(run({ 'a.js': "AsyncStorage.mergeItem(storageName('secret'), v);" })).toHaveLength(1);
      expect(run({ 'a.js': "const kv = sealedKeyValue(s, {});\nkv.mergeItem(storageName('secret'), v);" })).toEqual([]);
    });
    it('a raw write to a plain row, or a sealed write to a sealed row, is green', () => {
      expect(run({ 'a.js': "localStorage.setItem(storageName('flag'), '1');\nconst kv = sealedKeyValue(localStorage, {});\nkv.setItem(storageName('secret'), v);" })).toEqual([]);
    });
    it('a store is judged by its definition, never its name', () => {
      // jsonKv over raw storage is the plain twin: named kv, still raw
      expect(run({ 'a.js': "const kv = jsonKv(localStorage, {});\nkv.setItem(storageName('secret'), v);" })).toHaveLength(1);
      // jsonKv over a sealed store is sealed
      expect(run({ 'a.js': "const sealed = sealedKeyValue(localStorage, {});\nconst kv = jsonKv(sealed, {});\nkv.setItem(storageName('secret'), v);" })).toEqual([]);
      // a kv with no definition in the file (a parameter) is not trusted
      expect(run({ 'a.js': "function f(kv) {\n  kv.setItem(storageName('secret'), v);\n}" })).toHaveLength(1);
      // the NEAREST definition above the line decides (names repeat per function)
      expect(run({ 'a.js': "const kv = sealedKeyValue(s, {});\nkv.setItem(storageName('secret'), v);\nconst kv = jsonKv(localStorage, {});\nkv.setItem(storageName('secret'), v);" })).toHaveLength(1);
    });
    it('a key helper resolves to the nearest definition above the write', () => {
      const t = "const key = (id) => `${storageName('flag')}${id}`;\nlocalStorage.setItem(key(1), v);\nconst key = (id) => `${storageName('secret')}${id}`;";
      expect(run({ 'a.js': t })).toEqual([]);
    });
    it('a const exported by another file resolves only where it is imported', () => {
      const lib = "export const K = storageName('secret');";
      expect(run({ 'lib.js': lib, 'a.js': "import { K } from './lib.js';\nlocalStorage.setItem(K, v);" })).toHaveLength(1);
      expect(run({ 'lib.js': lib, 'a.js': "const K = 'x';\nlocalStorage.setItem(K, v);" })[0]).toMatch(/names no register row/);
    });
    it('a raw write under a key that names no row is red', () => {
      expect(run({ 'a.js': 'localStorage.setItem(`cc.other.${id}`, v);' })[0]).toMatch(/names no register row/);
    });
    it('a row without a seal ruling, or debt without its ledger row, is red', () => {
      expect(run({}, { x: { name: 'cc.x' } })[0]).toMatch(/no seal ruling/);
      expect(run({}, { x: { name: 'cc.x', seal: 'debt: written plain today' } })[0]).toMatch(/without its ledger row/);
    });
    it('every WRITES_FOR_ITS_CALLER entry says which row and who seals', () => {
      for (const [f, why] of Object.entries(WRITES_FOR_ITS_CALLER)) expect(why.length, f).toBeGreaterThan(20);
    });
  });
  it('every OPENED_ELSEWHERE entry is a register row', () => {
    for (const id of Object.keys(OPENED_ELSEWHERE)) expect(STORAGE[id], id).toBeTruthy();
  });
  it('the repo itself is clean', async () => {
    expect(await check()).toEqual([]);
  });
});
