/**
 * The owner root has to SURVIVE A RESTART on mobile.
 *
 * Found on hardware 2026-07-30, running the first real message round-trip. `agentBundle` synthesised two
 * AsyncStorage vaults from `opts.asyncStorage` — `cc-chat-id:` and `cc-host-id:` — and not a third for the
 * owner root. `realAgent` therefore fell back to its own `makeBrowserVault('cc-owner-root:')`, which looks
 * for `localStorage`, finds none on React Native, and quietly returns a VaultMemory. A fresh owner root was
 * minted on every launch.
 *
 * Two things hung off that root, and both broke in ways that pointed elsewhere:
 *
 *   • **Per-circle addresses.** `circleAddressFor` derives from `ownerRoot.deriveAgentSeed('default')`, so
 *     all four of the phone's circle addresses changed on every app start. The roster kept the address from
 *     the day of the join, the phone registered different ones, and a peer sending to the recorded address
 *     waited 5s for an HI from nobody. It read exactly like the peer being offline — which is why it cost a
 *     relay rebuild and a boot-path fix before anyone suspected storage.
 *   • **The recovery phrase.** Same root. Onboarding shows 24 words and says you cannot get back to your
 *     things without them; they were written to a vault that does not outlive the process.
 *
 * The chat identity hid the problem: it has an explicit AsyncStorage vault, so the pubKey was stable across
 * launches while everything derived from the owner root was not. A partly-stable identity is worse than a
 * wholly unstable one — it looks like it works.
 *
 * These tests assert the wiring rather than the crypto: a vault that is simply ABSENT is invisible, because
 * the fallback is a working object. Nothing here needs a device.
 */
import { describe, it, expect } from 'vitest';
import { VaultAsyncStorage } from '@onderling/react-native/identity/VaultAsyncStorage';

/** A mock AsyncStorage that persists across "launches" the way the device's does. */
function fakeAsyncStorage(store = new Map()) {
  return {
    store,
    getItem: async (k) => (store.has(k) ? store.get(k) : null),
    setItem: async (k, v) => { store.set(k, v); },
    removeItem: async (k) => { store.delete(k); },
    getAllKeys: async () => [...store.keys()],
  };
}

describe('the mobile bundle gives the owner root a durable home', () => {
  it('synthesises an owner-root vault from asyncStorage, alongside chat and host', async () => {
    // Asserted against the SOURCE, not by importing the module: the synthesis happens inside the real-boot
    // path, and importing it pulls in the whole agent — slow enough to blow the 5s timeout under parallel
    // suite load, while proving nothing extra. The three prefixes must all be there; the bug was the third
    // one missing.
    const fs = await import('node:fs/promises');
    const url = await import('node:url');
    const text = await fs.readFile(
      url.fileURLToPath(new URL('../src/core/agentBundle.js', import.meta.url)), 'utf8',
    );
    for (const prefix of ['cc-chat-id:', 'cc-host-id:', 'cc-owner-root:']) {
      expect(text, `no vault synthesised for ${prefix}`).toContain(prefix);
    }
    // …and it must be HANDED to the agent, not merely constructed. The distinction is the whole bug: an
    // unused local would leave realAgent on its memory fallback.
    expect(text).toMatch(/ownerRootVault,/);
  });

  it('the vault it builds actually persists across a fresh instance — the restart', async () => {
    const asyncStorage = fakeAsyncStorage();
    const first = new VaultAsyncStorage({ prefix: 'cc-owner-root:', asyncStorage });
    await first.set('owner-phrase', 'twenty four words go here');

    // A new process, the same storage.
    const second = new VaultAsyncStorage({ prefix: 'cc-owner-root:', asyncStorage });
    expect(await second.get('owner-phrase')).toBe('twenty four words go here');
  });

  it('and it does not collide with the chat identity’s keys', async () => {
    const asyncStorage = fakeAsyncStorage();
    const owner = new VaultAsyncStorage({ prefix: 'cc-owner-root:', asyncStorage });
    const chat  = new VaultAsyncStorage({ prefix: 'cc-chat-id:',    asyncStorage });
    await owner.set('owner-phrase', 'owner');
    await chat.set('owner-phrase', 'chat');
    expect(await owner.get('owner-phrase')).toBe('owner');
    expect(await chat.get('owner-phrase')).toBe('chat');
  });
});

describe('a memory fallback for the owner root is at least AUDIBLE', () => {
  it('realAgent warns when it has to fall back for something whose durability matters', async () => {
    const fs = await import('node:fs/promises');
    const url = await import('node:url');
    const text = await fs.readFile(
      url.fileURLToPath(new URL('../../basis/src/core/agent/realAgent.js', import.meta.url)), 'utf8',
    );
    // The owner root asks for the loud variant. Without this flag the fallback is silent, and silence is
    // what let a regenerated identity root pass for a network fault for a full day.
    expect(text).toMatch(/makeBrowserVault\('cc-owner-root:',\s*\{\s*durabilityMatters:\s*true\s*\}\)/);
    expect(text).toMatch(/durabilityMatters/);
  });
});

/* ─────────────────────────────────────────────────────────────────────────────────────────────────
 * The behavioural twins of the wiring asserts above.
 *
 * Everything so far checks the SHAPE — that the prefix appears in agentBundle.js, that VaultAsyncStorage
 * round-trips. None of it boots. The 2026-07-30 bug lived in the seam BETWEEN those two facts: the vault
 * class worked, the prefix could have been anywhere, and the agent quietly used neither. So run the boot.
 *
 * Slow imports (the whole household/tasks/stoop chain) — hence the explicit timeouts the rest of this file
 * deliberately avoids needing. The phrase→restore journey built on the same seam lives next door in
 * identityRecoveryJourney.test.js; this file keeps the DURABILITY half.
 * ────────────────────────────────────────────────────────────────────────────────────────────── */
const BOOT_TIMEOUT = 60000;
const DURABILITY_CIRCLES = ['oosterpoort', 'werkgroep-tuin'];

/**
 * Capture console.warn for the duration of `fn`.
 * Deliberately NOT `vi.spyOn(console, 'warn')`: vitest installs its own console wrapper, so a spy placed
 * on `console` never sees what the app code actually calls, and the assertion silently reads zero.
 */
async function withCapturedWarnings(fn) {
  const lines = [];
  const original = console.warn;
  console.warn = (...args) => { lines.push(args.map(String).join(' ')); };
  try { return { result: await fn(), lines }; }
  finally { console.warn = original; }
}

/** Boot the real mobile bundle; returns { pubKey, addresses, phrase }. */
async function bootAndDescribe(opts) {
  const { bootAgentBundle } = await import('../src/core/agentBundle.js');
  const bundle = await bootAgentBundle(opts);
  return {
    pubKey:    bundle.agent.sa.agent.identity.pubKey,
    addresses: DURABILITY_CIRCLES.map((c) => bundle.agent.circleAddressFor(c)),
    phrase:    (await bundle.callSkill('household', 'revealOwnerPhrase', {})).mnemonic,
  };
}

describe('the boot path itself keeps the owner root across a restart', () => {
  it('a second boot on the SAME AsyncStorage is the same person, at the same per-circle addresses',
    { timeout: BOOT_TIMEOUT }, async () => {
      const asyncStorage = fakeAsyncStorage();
      const first  = await bootAndDescribe({ asyncStorage });
      const second = await bootAndDescribe({ asyncStorage });        // the app relaunch

      expect(second.phrase).toBe(first.phrase);                      // the words you were told to write down
      expect(second.pubKey).toBe(first.pubKey);
      expect(second.addresses).toEqual(first.addresses);             // …and still reachable where the roster says
      // The phrase really is on disk under the owner-root prefix — not merely stable within one process.
      expect(await asyncStorage.getItem('cc-owner-root:owner-phrase')).toBe(first.phrase);
    });
});

describe('a memory fallback for the owner root is reachable only when storage is genuinely absent', () => {
  it('with no durable vault at all: it WARNS, and the root is different on every boot',
    { timeout: BOOT_TIMEOUT }, async () => {
      const { VaultMemory } = await import('@onderling/vault');
      // No asyncStorage and no ownerRootVault → agentBundle passes undefined → realAgent's
      // makeBrowserVault('cc-owner-root:', { durabilityMatters: true }) finds no localStorage in node,
      // exactly as it finds none on Hermes.
      const memoryBoot = () => bootAndDescribe({ chatVault: new VaultMemory(), hostVault: new VaultMemory() });
      const { result: first, lines } = await withCapturedWarnings(memoryBoot);
      const { result: second } = await withCapturedWarnings(memoryBoot);

      const spoke = lines.filter((l) => l.includes('cc-owner-root:'));
      expect(spoke.length, 'the memory fallback for the owner root was SILENT').toBeGreaterThan(0);
      expect(spoke[0]).toMatch(/MEMORY/);
      expect(spoke[0]).toMatch(/recovery phrase/);   // it names what is actually at stake, not just the prefix

      // And the warning is telling the truth: this really is the broken state. Two boots, two identities,
      // two sets of per-circle addresses — the failure that read as "the peer is offline" for a day.
      expect(second.phrase).not.toBe(first.phrase);
      expect(second.addresses).not.toEqual(first.addresses);
    });

  it('stays silent when the bundle hands it a durable owner-root vault',
    { timeout: BOOT_TIMEOUT }, async () => {
      const { lines } = await withCapturedWarnings(
        () => bootAndDescribe({ asyncStorage: fakeAsyncStorage() }),
      );
      expect(lines.filter((l) => l.includes('cc-owner-root:')), 'warned about a fallback it never took')
        .toEqual([]);
    });
});
