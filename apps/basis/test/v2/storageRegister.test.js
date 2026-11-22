/**
 * The storage register is the one list of stored names; the lists that must know every name are derived from it.
 * @guard — the forget list of a freshly enrolled device and the start-over's names are read from the storage register, and every registered name is one the start-over removes (or a kept screen grant)
 */
import { describe, it, expect } from 'vitest';
import { STORAGE, storageName, storageNames } from '../../src/v2/storageRegister.js';
import { THROWAWAY_CONTENT } from '../../src/v2/enrolForgets.js';
import { isBasisStorageKey, isBasisDatabase, BASIS_DB_NAMES } from '../../src/v2/basisStorageNames.js';

const sorted = (a) => [...a].sort();

describe('the storage register', () => {
  it('names each stored name once', () => {
    const names = Object.values(STORAGE).map((r) => r.name);
    expect(names.length).toBe(new Set(names).size);
  });

  it('refuses an id it does not hold', () => {
    expect(storageName('deviceLog')).toBe('cc-device-log');
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

  it('knows every database the start-over deletes by name', () => {
    const stores = new Set(storageNames((r) => r.kind === 'store'));
    expect(BASIS_DB_NAMES.filter((n) => !stores.has(n))).toEqual([]);
  });

  it('says which names are not yet ruled for a freshly enrolled device, and the list only shrinks', () => {
    expect(sorted(storageNames((r) => r.forget === 'undecided'))).toEqual(sorted([
      'cc-tasks-state', 'cc-attachment-blobs', 'cc-circle-pod', 'cc-peers:', 'basis', 'onderling-pseudo-pod',
      'onderling-pod-client', 'cc.circlePolicyPending.', 'onderling.screen.', 'onderling.mappings:',
      'basis.nearbySelf', 'cc.nearbySelf', 'cc.nearbyRadio', 'cc.askMatchSkips', 'cc.fallbackOffer',
      'cc.firstOpenSeen', 'cc.introCardSeen', 'cc.lastTab', 'cc.nativeCalendar.eventIdMap', 'cc-in-flight-flows',
      'cc-wake-nudges', 'basis.startOverPage',
    ]));
  });
});
