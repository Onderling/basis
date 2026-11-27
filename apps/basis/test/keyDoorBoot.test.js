/**
 * THE KEY DOOR AT A START: the web shell asks the door before it builds the agent, and a locked door is opened with
 * the person's secret first (the browser lock). The decision is shared (`openKeyDoorAtBoot`): the shell only paints
 * the question and passes what was typed; the door refuses a wrong secret.
 */
import 'fake-indexeddb/auto';
import { describe, it, expect, afterEach } from 'vitest';
import { RootKeyStoreWebCrypto, RootKeyStoreMemory } from '@onderling/vault';
import { derivePassphraseKey } from '@onderling/core';
import { VaultMemory } from '@onderling/vault';
import { pickRootKeyStore, openKeyDoorAtBoot } from '../src/core/agent/ownerRootCustody.js';

const CHEAP = { name: 'argon2id', params: { m: 8, t: 1, p: 1 }, derive: derivePassphraseKey };
const seedOf = () => crypto.getRandomValues(new Uint8Array(32));
let n = 0;
const lockedDoor = async (secret) => {
  const dbName = `boot-door-${process.pid}-${(n += 1)}`;
  const d = new RootKeyStoreWebCrypto({ dbName, kdf: CHEAP });
  await d.setSeed(seedOf()); await d.setLock(secret);
  return new RootKeyStoreWebCrypto({ dbName, kdf: CHEAP });
};

describe('openKeyDoorAtBoot', () => {
  it('a door without a lock (or an empty one) is ready at once: nothing is asked', async () => {
    const asked = [];
    const m = new RootKeyStoreMemory();
    expect(await openKeyDoorAtBoot(m, { askSecret: async (o) => { asked.push(o); return 'x'; } })).toBe(m);
    await m.setSeed(seedOf());
    expect(await openKeyDoorAtBoot(m, { askSecret: async (o) => { asked.push(o); return 'x'; } })).toBe(m);
    expect(asked).toEqual([]);
  });
  it('a locked door is asked until the secret opens it; a wrong one is told as wrong; the same door comes back open', async () => {
    const door = await lockedDoor('1234');
    const typed = ['0000', '9999', '1234'];
    const asked = [];
    const r = await openKeyDoorAtBoot(door, { askSecret: async (o) => { asked.push(o); return typed.shift(); } });
    expect(r).toBe(door);
    expect(await door.status()).toBe('unlocked');
    expect(asked).toEqual([{ wrong: false }, { wrong: true }, { wrong: true }]);
  });
});

describe('the web door picked at a start can be locked', () => {
  const had = globalThis.window;
  afterEach(() => { if (had === undefined) delete globalThis.window; else globalThis.window = had; });
  it('pickRootKeyStore hands the browser door the slow derivation (a lock can be set and opened)', async () => {
    globalThis.window = {};
    const door = pickRootKeyStore({ fallbackVault: new VaultMemory() });
    expect(door).toBeInstanceOf(RootKeyStoreWebCrypto);
    await door.setSeed(seedOf());
    await door.setLock('1234');
    door.lock();
    expect(await door.unlock('1234')).toBe(true);
  }, 30_000);
});
