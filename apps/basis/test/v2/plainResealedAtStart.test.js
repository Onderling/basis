/**
 * AN OLD PLAIN VALUE IS RESEALED AT THE START, NOT ONLY WHEN SOMETHING HAPPENS TO READ IT (the upgrade walk, 2026-11-20,
 * check 6). A strict sealed store reseals a plain value from before sealing at its first read. The walk found two
 * policy heads and the availability still plain after the first start of the new build: nothing had read them, so
 * nothing resealed them. A store now names the keys it owns (`resealAtStart`), and once the content key is there the
 * shared wrapper reads each of them once: a plain one is written back sealed, a sealed one writes nothing.
 */
import { describe, it, expect, afterEach } from 'vitest';
import { groupKeyStrategy } from '@onderling/pod-client';
import { setShellContentSeal } from '../../src/v2/localStoreSeal.js';
import { sealedPolicyHeadStore, POLICY_HEAD_KEY } from '../../src/v2/policyUpdateLane.js';
import { localStorageAvailabilityIo } from '../../src/v2/memberAvailability.js';
import { boxStores } from '../../src/v2/boxStorage.js';
import { actionFrequencyIo, ACTION_FREQ_KEY } from '../../src/v2/actionFrequency.js';
import { sealedAskMatchSkipsIo } from '../../src/v2/askMatches.js';
import { localStorageOverrideIo } from '../../src/v2/circlePolicyStore.js';
import { localStoragePinIo } from '../../src/v2/circlePinStore.js';
import { localStorageSharedWithMeIo } from '../../src/v2/sharedWithMeStore.js';
import { localStorageScreenIo } from '../../src/v2/userScreens.js';
import { sealedContactNameStore, CONTACT_NAMES_KEY } from '../../src/v2/contactsSource.js';
import { sealedContactSeenStore, CONTACT_SEEN_KEY } from '../../src/v2/contactUnread.js';
import { mkdtempSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

const KEY = Buffer.from(new Uint8Array(32).fill(7)).toString('base64url');
const seal = () => setShellContentSeal(groupKeyStrategy({ groupKey: KEY }));
afterEach(() => setShellContentSeal(null));
const tick = (ms = 30) => new Promise((r) => { setTimeout(r, ms); });

/** localStorage-shaped (the web): sync, listed by key(i)/length. */
function webStorage(entries = {}) {
  const m = new Map(Object.entries(entries));
  return {
    getItem: (k) => (m.has(k) ? m.get(k) : null),
    setItem: (k, v) => { m.set(k, String(v)); },
    removeItem: (k) => { m.delete(k); },
    key: (i) => [...m.keys()][i] ?? null,
    get length() { return m.size; },
    _m: m,
  };
}
/** AsyncStorage-shaped (the phone): async, listed by getAllKeys. */
function phoneStorage(entries = {}) {
  const m = new Map(Object.entries(entries));
  return {
    getItem: async (k) => (m.has(k) ? m.get(k) : null),
    setItem: async (k, v) => { m.set(k, String(v)); },
    removeItem: async (k) => { m.delete(k); },
    getAllKeys: async () => [...m.keys()],
    _m: m,
  };
}
const isPlainJson = (v) => { try { JSON.parse(v); return true; } catch { return false; } };
const HEAD = JSON.stringify({ version: 3, statement: { by: 'admin', note: 'Oma-Truus' } });
const AWAY = JSON.stringify({ holiday: { from: '2026-12-01', to: '2026-12-08' } });

describe('an old plain value is resealed at the start', () => {
  for (const [label, make] of [['web storage', webStorage], ['phone storage', phoneStorage]]) {
    it(`the policy heads, when the key arrives after the store is made (${label})`, async () => {
      const s = make({ [POLICY_HEAD_KEY('c1')]: HEAD, [POLICY_HEAD_KEY('c2')]: HEAD, 'lastTab': 'vandaag' });
      const store = sealedPolicyHeadStore(s);
      seal();
      await tick();
      expect(isPlainJson(s._m.get(POLICY_HEAD_KEY('c1'))), 'c1 sealed').toBe(false);
      expect(isPlainJson(s._m.get(POLICY_HEAD_KEY('c2'))), 'c2 sealed').toBe(false);
      expect(s._m.get('lastTab'), 'a key the store does not own is not touched').toBe('vandaag');
      expect((await store.read('c1')).version).toBe(3);
    });

    it(`the availability, when the key is already there (${label})`, async () => {
      seal();
      const s = make({ 'cc.availability': AWAY });
      const io = localStorageAvailabilityIo(s);
      await tick();
      expect(isPlainJson(s._m.get('cc.availability'))).toBe(false);
      expect((await io.load()).holiday.from).toBe('2026-12-01');
    });
  }

  it('a sealed value is not written again', async () => {
    seal();
    const s = phoneStorage({});
    const store = sealedPolicyHeadStore(s);
    await store.write('c1', { version: 1 });
    const before = s._m.get(POLICY_HEAD_KEY('c1'));
    let writes = 0; const set = s.setItem; s.setItem = async (k, v) => { writes += 1; return set(k, v); };
    sealedPolicyHeadStore(s);
    await tick();
    expect(writes).toBe(0);
    expect(s._m.get(POLICY_HEAD_KEY('c1'))).toBe(before);
  });

  it('the box: its policy heads go through the same store, and are resealed at the start too', async () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'reseal-box-'));
    const file = path.join(dir, 'circle-policy.json');
    writeFileSync(file, JSON.stringify({ [POLICY_HEAD_KEY('c1')]: HEAD }));
    const stores = boxStores(dir);
    seal();
    await tick(100);
    const raw = JSON.parse(readFileSync(file, 'utf8'))[POLICY_HEAD_KEY('c1')];
    expect(isPlainJson(raw), 'the head in the box file is sealed').toBe(false);
    expect((await stores.policyHeadStore.read('c1')).version).toBe(3);
  });

  // the sweep: every strict store of a person's content declares the keys it owns
  for (const [label, make, key] of [
    ['the action frequency', actionFrequencyIo, ACTION_FREQ_KEY],
    ['the ask-match skips', sealedAskMatchSkipsIo, 'cc.askMatchSkips'],
    ['the member overrides', localStorageOverrideIo, 'cc.circleOverride.c1'],
    ['the circle pins', localStoragePinIo, 'cc.circlePinned'],
    ['shared with me', localStorageSharedWithMeIo, 'cc.sharedWithMe'],
    ['the page book', localStorageScreenIo, 'cc.userScreens'],
    ['contact names', sealedContactNameStore, CONTACT_NAMES_KEY],
    ['contact seen-marks', sealedContactSeenStore, CONTACT_SEEN_KEY],
  ]) {
    it(`${label}: an old plain value is resealed at the start`, async () => {
      const s = phoneStorage({ [key]: JSON.stringify({ old: 'plain' }) });
      make(s);
      seal();
      await tick(60);
      expect(isPlainJson(s._m.get(key)), `${key} sealed`).toBe(false);
    });
  }
});
