/**
 * Self-test for lint-storage-register: it sees a storage name written by hand (a literal, a template starting with
 * literal text, an UPPER_CASE const) at each kind of storage call, and it does not see a name taken from the register,
 * a name passed through, or a `scope:` that is not storage. And the repo itself is clean.
 */
import { describe, it, expect } from 'vitest';
import { handNamesIn, check, OPENED_ELSEWHERE } from './lint-storage-register.mjs';
import { STORAGE } from '../apps/basis/src/v2/storageRegister.js';

const names = (t) => handNamesIn(t).map((h) => h.name);

describe('lint-storage-register', () => {
  it('sees a literal at getItem / setItem / removeItem', () => {
    expect(names("localStorage.getItem('cc.lastTab');\nAsyncStorage.setItem('cc.x', v);\ns.removeItem(\"cc.y\");")).toEqual(['cc.lastTab', 'cc.x', 'cc.y']);
  });
  it('sees a template that starts with literal text, and an UPPER_CASE const', () => {
    expect(names("const KEY = 'cc.availability';\nkv.getItem(KEY);\nAsyncStorage.getItem(`cc.circlePolicy.${id}`);")).toEqual(['cc.availability', 'cc.circlePolicy.${id}']);
  });
  it('sees the backend and vault builders, and dbName', () => {
    expect(names("pickWebBackend('cc-agent-registry');\nmakeBrowserVault('cc-chat-id:');\nsealedLocalBackend(createAsBackend({ AsyncStorage, scope: 'cc-device-log' }));\nbuild({ dbName: 'cc-outbox-cache' });"))
      .toEqual(['cc-agent-registry', 'cc-chat-id:', 'cc-device-log', 'cc-outbox-cache']);
  });
  it('does not see a register call, a name passed through, or a scope that is not storage', () => {
    expect(names("kv.getItem(storageName('lastTab'));\ns.getItem(`${prefix}${id}`);\nconst control = { scope: 'circle' };\nstore.getItem(key);")).toEqual([]);
  });
  it('sees a key built by hand from a prefix row (a key helper), through check()', async () => {
    const { mkdirSync, writeFileSync, rmSync } = await import('node:fs');
    const dir = new URL('../apps/basis/src/guard-fixture-storage-tmp/', import.meta.url);
    mkdirSync(dir, { recursive: true });
    writeFileSync(new URL('keyHelper.js', dir), 'export const key = (id) => `cc.circlePolicy.${id}`;\n');
    try {
      expect((await check()).some((p) => p.includes("builds a 'cc.circlePolicy.' key by hand"))).toBe(true);
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });
  it('every OPENED_ELSEWHERE entry is a register row', () => {
    for (const id of Object.keys(OPENED_ELSEWHERE)) expect(STORAGE[id], id).toBeTruthy();
  });
  it('the repo itself is clean', async () => {
    expect(await check()).toEqual([]);
  });
});
