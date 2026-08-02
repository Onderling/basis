/**
 * B1 — identity recovery, proven by something that RUNS.
 *
 * The property a tester's whole account hangs on:
 *
 *     recovery phrase  →  reinstall  →  restore  →  the SAME identity  AND  the SAME per-circle addresses.
 *
 * All three halves matter. "Same identity" alone is not enough: per-circle addressing (G13) derives a
 * DIFFERENT address per circle from the profile seed, so a restore that recovers the identity but not the
 * seed lineage leaves you reachable at your canonical address and unreachable in every circle you are in.
 * On the phone that does not read as "my restore failed", it reads as "my messages stopped arriving" — the
 * exact mis-diagnosis that cost a day on 2026-07-30 (see ownerRootDurability.test.js for that story).
 *
 * These tests drive the REAL mobile boot path — `bootAgentBundle({ asyncStorage })` → `agentBundle.js` →
 * `createRealHouseholdAgent` (apps/basis/src/core/agent/realAgent.js) → `ensureOwnerRoot` → the real
 * `Bootstrap` / `deriveCircleAddress` — against a Map-backed AsyncStorage that survives a "reboot" the way
 * the device's does. Nothing is re-implemented here: a test that built the happy path itself would have
 * passed all through the days the phrase recovered nothing, which is the whole lesson.
 *
 * A "fresh install" is modelled as a NEW, EMPTY storage map. That is precisely the state a reinstalled app
 * is in: AsyncStorage is app-private and is wiped with the app.
 */
import { describe, it, expect } from 'vitest';
import { AgentIdentity, Bootstrap, mnemonicToSeed } from '@onderling/core';
import { VaultAsyncStorage } from '@onderling/react-native/identity/VaultAsyncStorage';

import { bootAgentBundle } from '../src/core/agentBundle.js';
import { restoreFromMnemonic } from '../src/core/restoreFromMnemonic.js';

// A real boot stands up the whole household/tasks/stoop/folio chain; generous but bounded.
const BOOT_TIMEOUT = 60000;

// Several circles, because one address proves nothing about per-circle derivation: the failure we are
// guarding against changes ALL of them at once, and a single-circle assertion could pass by luck of a
// shared fallback.
const CIRCLES = ['oosterpoort', 'schildersbuurt', 'werkgroep-tuin'];

/** A mock AsyncStorage that persists across "launches" exactly the way the device's does. */
function fakeAsyncStorage(store = new Map()) {
  return {
    store,
    getItem:     async (k) => (store.has(k) ? store.get(k) : null),
    setItem:     async (k, v) => { store.set(k, v); },
    removeItem:  async (k) => { store.delete(k); },
    getAllKeys:  async () => [...store.keys()],
    multiGet:    async (ks) => ks.map((k) => [k, store.has(k) ? store.get(k) : null]),
    multiSet:    async (pairs) => { for (const [k, v] of pairs) store.set(k, v); },
    multiRemove: async (ks) => { for (const k of ks) store.delete(k); },
  };
}

/** What a device IS, from the outside: its canonical identity plus the address it presents per circle. */
function identitySnapshot(bundle) {
  return {
    pubKey:    bundle.agent.sa.agent.identity.pubKey,
    addresses: Object.fromEntries(CIRCLES.map((c) => [c, bundle.agent.circleAddressFor(c)])),
  };
}

const revealPhrase = async (bundle) =>
  (await bundle.callSkill('household', 'revealOwnerPhrase', {})).mnemonic;

describe('B1 — the recovery phrase brings back the same person, on a fresh install', () => {
  it('phrase → fresh install → restore → SAME identity AND the SAME address in every circle',
    { timeout: BOOT_TIMEOUT }, async () => {
      // ── the phone, before the accident ──────────────────────────────────────────────────────────
      const phone = fakeAsyncStorage();
      const before = identitySnapshot(await bootAgentBundle({ asyncStorage: phone }));
      const phrase = await revealPhrase(await bootAgentBundle({ asyncStorage: phone }));
      expect(phrase.trim().split(/\s+/)).toHaveLength(24);

      // ── the reinstall: a new phone, or the same one wiped. Nothing carries over. ────────────────
      const newPhone = fakeAsyncStorage();
      const fresh = await bootAgentBundle({ asyncStorage: newPhone });
      // Sanity on the assertion itself: an un-restored fresh install really IS a different person, so
      // the equalities below cannot be passing because everything is trivially equal.
      expect(identitySnapshot(fresh).pubKey).not.toBe(before.pubKey);

      // ── the restore, through the skill the in-app wizard actually dispatches ────────────────────
      // `restoreFromMnemonicState.js` → callSkill('household', 'restoreOwnerPhrase', { mnemonic }).
      const res = await fresh.callSkill('household', 'restoreOwnerPhrase', { mnemonic: phrase });
      expect(res).toMatchObject({ ok: true, reloadRequired: true });
      // The skill says `reloadRequired` and means it — the live agent keeps its old identity until the
      // app re-boots. So re-boot, on the same storage, the way the app does after the user restarts it.
      const after = identitySnapshot(await bootAgentBundle({ asyncStorage: newPhone }));

      // (i) the same person …
      expect(after.pubKey).toBe(before.pubKey);
      // (ii) … AND reachable at the same address in every circle they were in. Without this the roster
      // still lists them and nothing they send or receive lands.
      for (const circleId of CIRCLES) {
        expect(after.addresses[circleId], `circle ${circleId} moved`).toBe(before.addresses[circleId]);
      }
      // (iii) and the phrase they can write down afterwards is still the same phrase — a restore that
      // silently re-keys would strand them again on the NEXT reinstall.
      expect(await revealPhrase(await bootAgentBundle({ asyncStorage: newPhone }))).toBe(phrase);
    });

  it('someone else’s phrase is someone else — restore is not a way to arrive as you',
    { timeout: BOOT_TIMEOUT }, async () => {
      const mine = fakeAsyncStorage();
      const before = identitySnapshot(await bootAgentBundle({ asyncStorage: mine }));

      const theirs = fakeAsyncStorage();
      const theirPhrase = await revealPhrase(await bootAgentBundle({ asyncStorage: theirs }));

      const wiped = fakeAsyncStorage();
      const fresh = await bootAgentBundle({ asyncStorage: wiped });
      await fresh.callSkill('household', 'restoreOwnerPhrase', { mnemonic: theirPhrase });
      const after = identitySnapshot(await bootAgentBundle({ asyncStorage: wiped }));

      expect(after.pubKey).not.toBe(before.pubKey);
      for (const circleId of CIRCLES) {
        expect(after.addresses[circleId]).not.toBe(before.addresses[circleId]);
      }
    });

  it('an invalid phrase is refused and leaves the existing identity untouched',
    { timeout: BOOT_TIMEOUT }, async () => {
      const phone = fakeAsyncStorage();
      const before = identitySnapshot(await bootAgentBundle({ asyncStorage: phone }));
      const b = await bootAgentBundle({ asyncStorage: phone });
      expect(await b.callSkill('household', 'restoreOwnerPhrase', { mnemonic: 'niet echt een zin' }))
        .toMatchObject({ ok: false, error: 'invalid-phrase' });
      // A rejected restore must not be a way to LOSE your identity either.
      const after = identitySnapshot(await bootAgentBundle({ asyncStorage: phone }));
      expect(after).toEqual(before);
    });

  it('the restored addresses stay UNLINKABLE across circles — recovery does not collapse G13',
    { timeout: BOOT_TIMEOUT }, async () => {
      const phone = fakeAsyncStorage();
      const phrase = await revealPhrase(await bootAgentBundle({ asyncStorage: phone }));
      const wiped = fakeAsyncStorage();
      const fresh = await bootAgentBundle({ asyncStorage: wiped });
      await fresh.callSkill('household', 'restoreOwnerPhrase', { mnemonic: phrase });
      const { pubKey, addresses } = identitySnapshot(await bootAgentBundle({ asyncStorage: wiped }));

      const distinct = new Set(Object.values(addresses));
      expect(distinct.size).toBe(CIRCLES.length);          // a different key in every circle …
      for (const a of distinct) expect(a).not.toBe(pubKey); // … and none of them is the canonical one
    });
});

/* ─────────────────────────────────────────────────────────────────────────────────────────────────
 * KNOWN DEFECT — the FIRST-RUN restore entrance does not restore.
 *
 * There are two doors into restore on mobile and only one of them works:
 *
 *   ✔ in-app  — CircleMyDataScreen → restoreFromMnemonicWizardModal → restoreFromMnemonicState.js
 *               → callSkill('household', 'restoreOwnerPhrase') → writes cc-owner-root:owner-phrase
 *               and re-derives the default profile. Covered by the passing tests above.
 *
 *   ✘ first-run — FirstRunWelcomeScreen "I have a recovery phrase" → MnemonicEntryScreen
 *               → App.js `submitMnemonic` (App.js:355) → src/core/restoreFromMnemonic.js.
 *               That helper predates the owner root (it is the "legacy direct-seed" path realAgent.js:952
 *               names). It writes ONLY `cc-chat-id:agent-privkey`, seeded from the mnemonic's raw entropy
 *               — not from `Bootstrap.deriveAgentSeed('default')` — and never writes the owner root at all.
 *
 * That is the door a reinstalling tester walks through: it is the only one reachable BEFORE an identity
 * exists. The two tests below pin the defect. When it is fixed, `it.fails` will start failing ("expected
 * to fail but passed") and the key-shape test will go red — both by design. Fix them, don't silence them.
 * Reported, not fixed: the tree is frozen for review (plans/REVIEW-R0-R1-boundary-build.md).
 * ────────────────────────────────────────────────────────────────────────────────────────────── */
describe('B1 — first-run "I have a recovery phrase" restores properly (FIXED 2026-08-02)', () => {
  it('gives back the same identity and the same per-circle addresses',
    { timeout: BOOT_TIMEOUT }, async () => {
      const phone = fakeAsyncStorage();
      const before = identitySnapshot(await bootAgentBundle({ asyncStorage: phone }));
      const phrase = await revealPhrase(await bootAgentBundle({ asyncStorage: phone }));

      // The reinstall, then exactly what App.js does with the typed phrase before it lets boot proceed.
      const newPhone = fakeAsyncStorage();
      expect(await restoreFromMnemonic({ mnemonic: phrase, asyncStorage: newPhone })).toEqual({ ok: true });
      const after = identitySnapshot(await bootAgentBundle({ asyncStorage: newPhone }));

      expect(after.pubKey).toBe(before.pubKey);
      for (const circleId of CIRCLES) {
        expect(after.addresses[circleId]).toBe(before.addresses[circleId]);
      }
    });

  it('…writes the owner root, and derives the chat key from it rather than from raw entropy',
    { timeout: BOOT_TIMEOUT }, async () => {
      const phone = fakeAsyncStorage();
      await bootAgentBundle({ asyncStorage: phone });
      const phrase = await revealPhrase(await bootAgentBundle({ asyncStorage: phone }));

      const newPhone = fakeAsyncStorage();
      await restoreFromMnemonic({ mnemonic: phrase, asyncStorage: newPhone });

      // Each assertion below was the DEFECT, inverted on 2026-08-02. Kept in this shape because the
      // failure modes are what the fix has to keep away, and an inverted defect test says that better
      // than a fresh happy-path one.

      // (a) the owner root IS written — it used to be absent entirely, so the next boot's
      //     `ensureOwnerRoot` found an empty vault and minted a brand-new RANDOM root, taking every
      //     per-circle address with it.
      const keys = await newPhone.getAllKeys();
      expect(keys.some((k) => k.startsWith('cc-owner-root:'))).toBe(true);

      // (b) the chat key is the owner-root DEFAULT PROFILE, not the mnemonic's raw entropy. Those are
      //     different keys, and writing the second one produced an install whose identity did not match
      //     its own root.
      const restored = await AgentIdentity.restore(
        new VaultAsyncStorage({ prefix: 'cc-chat-id:', asyncStorage: newPhone }),
      );
      expect(restored.pubKey).not.toBe(AgentIdentity.pubKeyFromSeed(mnemonicToSeed(phrase)));

      // (c) the install is COHERENT: the phrase it will show is the phrase that was typed.
      const booted = await bootAgentBundle({ asyncStorage: newPhone });
      expect(await revealPhrase(booted)).toBe(phrase);
    });
});

/* ─────────────────────────────────────────────────────────────────────────────────────────────────
 * KNOWN DEFECT — the 24 words shown at onboarding are not the recovery phrase.
 *
 * App.js:497, inside the first-run probe:
 *
 *     const phrase = await b.agent?.sa?.agent?.identity?.getMnemonic?.();
 *
 * `identity` there is the CHAT AgentIdentity, and `getMnemonic()` (AgentIdentity.js:349) re-encodes
 * whatever 32-byte seed sits in that vault. The chat seed is `Bootstrap.deriveAgentSeed('default')` —
 * a CHILD of the owner root, not the root. Re-encoding a child seed as BIP-39 produces a perfectly
 * valid, perfectly useless 24-word phrase: it is not the phrase `revealOwnerPhrase` hands out, and
 * feeding it back to `restoreOwnerPhrase` installs it as a NEW root, one level down from where the
 * user's actual account lives.
 *
 * So MnemonicCreateScreen shows the user 24 words under a heading that tells them they cannot get back
 * to their things without these — and they cannot get back to their things WITH them either. This is
 * independent of the App.js restore defect above: they are the write-down half and the type-back half
 * of the same broken loop, and each is enough on its own to end a trial.
 *
 * (`revealOwnerPhrase` — the in-app "show my recovery phrase" in CircleMyDataScreen — is correct. The
 * defect is specifically the FIRST-RUN screen, which is the only one most testers will ever see.)
 * ────────────────────────────────────────────────────────────────────────────────────────────── */
describe('B1 — the CHAT identity\'s mnemonic is not, and never was, the recovery phrase', () => {
  it('the chat identity re-encodes a CHILD seed — reading it for the word grid is the bug',
    { timeout: BOOT_TIMEOUT }, async () => {
      const phone = fakeAsyncStorage();
      const bundle = await bootAgentBundle({ asyncStorage: phone });
      // Exactly the expression App.js evaluates to fill MnemonicCreateScreen's word grid.
      // NOT what App.js evaluates any more — kept as the standing FACT that makes the old wiring wrong.
      // This is a property of the derivation and will never change: the chat seed is a child of the root,
      // so its mnemonic can never equal the owner phrase. Anything that shows a recovery phrase must go
      // through `revealOwnerPhrase`.
      const shown = await bundle.agent?.sa?.agent?.identity?.getMnemonic?.();
      expect(shown).not.toBe(await revealPhrase(bundle));
    });

  it('…they are the CHILD seed re-encoded, and restoring from them lands you somewhere else entirely',
    { timeout: BOOT_TIMEOUT }, async () => {
      const phone = fakeAsyncStorage();
      const bundle = await bootAgentBundle({ asyncStorage: phone });
      const before = identitySnapshot(bundle);
      const shown = await bundle.agent.sa.agent.identity.getMnemonic();
      const real = await revealPhrase(bundle);

      // Both are valid 24-word phrases — nothing about the screen looks wrong.
      expect(shown.trim().split(/\s+/)).toHaveLength(24);
      expect(shown).not.toBe(real);
      // What it actually encodes: the default profile's seed, one derivation BELOW the root.
      expect(mnemonicToSeed(shown))
        .toEqual(Bootstrap.fromMnemonic(real).deriveAgentSeed('default'));

      // And the cost of that: the user writes down `shown`, reinstalls, types it into the restore
      // wizard — and arrives as a stranger, at addresses nobody in their circles has ever seen.
      const newPhone = fakeAsyncStorage();
      const fresh = await bootAgentBundle({ asyncStorage: newPhone });
      expect(await fresh.callSkill('household', 'restoreOwnerPhrase', { mnemonic: shown }))
        .toMatchObject({ ok: true });
      const after = identitySnapshot(await bootAgentBundle({ asyncStorage: newPhone }));
      expect(after.pubKey).not.toBe(before.pubKey);
      for (const circleId of CIRCLES) {
        expect(after.addresses[circleId]).not.toBe(before.addresses[circleId]);
      }
    });
});
