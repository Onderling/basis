/**
 * The storage register is the one list of stored names; the lists that must know every name are derived from it.
 * @guard — the forget list of a freshly enrolled device and the start-over's names are read from the storage register, and every registered name is one the start-over removes (or a kept screen grant)
 */
import { describe, it, expect } from 'vitest';
import { STORAGE, storageName, storageNames } from '../../src/v2/storageRegister.js';
import { THROWAWAY_CONTENT } from '../../src/v2/enrolForgets.js';
import { isBasisStorageKey, isBasisDatabase, BASIS_DB_NAMES, BASIS_PREFIX } from '../../src/v2/basisStorageNames.js';

const sorted = (a) => [...a].sort();

describe('the storage register', () => {
  it('names each stored name once', () => {
    const names = Object.values(STORAGE).map((r) => r.name);
    expect(names.length).toBe(new Set(names).size);
  });

  it('refuses an id it does not hold', () => {
    expect(storageName('deviceLog')).toBe('basis.device-log');
    expect(() => storageName('noSuchStore')).toThrow(/not in the storage register/);
  });

  it('is where the forget list of a freshly enrolled device comes from', () => {
    const throwaway = (kinds) => storageNames((r) => r.forget === 'throwaway' && kinds.includes(r.kind));
    expect(sorted(THROWAWAY_CONTENT.stores)).toEqual(sorted(throwaway(['store'])));
    expect(sorted(THROWAWAY_CONTENT.keys)).toEqual(sorted(throwaway(['key'])));
    expect(sorted(THROWAWAY_CONTENT.keyPrefixes)).toEqual(sorted(throwaway(['prefix'])));
    expect(sorted(THROWAWAY_CONTENT.keep)).toEqual(sorted(storageNames((r) => r.forget === 'keep')));
  });

  it('holds only names a start-over removes on the web, except a toolbox screen page\'s own grant', () => {
    const web = Object.values(STORAGE).filter((r) => r.shells.includes('web') && !r.name.startsWith('vault:'));
    const missed = web
      .filter((r) => r.name !== 'onderling-screen:')
      .filter((r) => !(r.kind === 'store' ? isBasisDatabase(r.name) : isBasisStorageKey(r.name)))
      .map((r) => r.name);
    expect(missed).toEqual([]);
    expect(isBasisStorageKey('onderling-screen:x')).toBe(false);
  });

  it('holds every name under the one prefix, on every shell, but the two declared kinds outside it', () => {
    // the vault's own keys (`vault:…`, the vault adds its prefix) and a toolbox screen page's grant (the page's)
    const outside = Object.values(STORAGE)
      .filter((r) => !r.name.startsWith(BASIS_PREFIX))
      .filter((r) => !(r.kind === 'vault' && r.name.startsWith('vault:')))
      .filter((r) => r.name !== storageName('screenGrant'))
      .map((r) => r.name);
    expect(outside).toEqual([]);
    expect(BASIS_PREFIX).toBe('basis.');
  });

  it('knows every database the start-over deletes by name', () => {
    const stores = new Set(storageNames((r) => r.kind === 'store'));
    expect(BASIS_DB_NAMES.filter((n) => !stores.has(n))).toEqual([]);
  });

  it('rules every name: a freshly enrolled device forgets it or keeps it', () => {
    expect(Object.values(STORAGE).filter((r) => !['throwaway', 'keep'].includes(r.forget)).map((r) => r.name)).toEqual([]);
  });
});
