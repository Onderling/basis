/**
 * basis — user safety journeys.
 *
 * Where journeys-security.test.js tests "the wiring is correct"
 * (primitive composition through the factory), THIS file tests
 * "the user actually gets the safety property they expect" — from
 * a user's perspective, not a substrate's.
 *
 * Each US-* journey is named for the user-facing scenario it
 * verifies, in plain language.  These are the tests you'd point
 * to when someone asks "but does this actually KEEP HARASSERS AWAY
 * from me?" or "if someone breaks into my audit log, will I know?".
 *
 *   US-1  Harassment workflow: Alice mutes Bob; her client refuses
 *         to talk to him + drops his inbound; her mute survives
 *         restart
 *   US-2  Impersonation defence: Carol can't sign a claim as Alice
 *         (only Alice's private key produces a valid sig)
 *   US-3  Audit tamper-evidence: if Alice's audit log is modified,
 *         /audit-tail reports BROKEN at the modified entry
 *   US-4  PFS cross-isolation: a third-party who captures Alice→Bob
 *         wire bytes can't decrypt them with their own identity
 *   US-5  Block-by-identity persistence: muting Bob's webid blocks
 *         him across every device + key rotation he has (alias fanout)
 *   US-6  Rate-limit dampens a flooder: 50 incoming requests in a
 *         tight loop → at most BURST get through; the rest are
 *         silently dropped; legitimate slow-pace senders unaffected
 *   US-7  Identity stability across reload: Alice's pubKey + stableId
 *         are the SAME after a "page reload" (vault rebuild) — peers
 *         can keep finding her at the same address
 */
import { describe, it, expect } from 'vitest';
import 'fake-indexeddb/auto';

import { createSecureAgent } from '@onderling/secure-agent';
import {
  signClaim, verifyClaim,
} from '@onderling/secure-agent';
import { VaultMemory }      from '@onderling/vault';
import { AgentIdentity }    from '@onderling/core';
import { createRealHouseholdAgent } from '../src/web/realAgent.js';
import {
  parseInput, resolveDispatch, runDispatch,
  createDefaultThreadStore,
} from '../src/index.js';
import { basisManifest }   from '../manifest.js';
import { mergeManifests }       from '../src/manifestMerge.js';
import { createLocalBuiltins }  from '../src/core/localBuiltins.js';

/* ─── helpers ────────────────────────────────────────── */

async function makeFactory(opts = {}) {
  return createSecureAgent({
    vault: new VaultMemory(),
    auditLog: true,
    muteListVaultKey: 'mute',
    ...opts,
  });
}

/* ─── US-1 — Harassment workflow ─────────────────────── */

describe('US-1 — Alice mutes a harasser', () => {
  it('refuses to send to Bob after Alice mutes him', async () => {
    const alice = await makeFactory();
    // (We don't need a connected transport to verify the SEND-side
    // refusal — the factory exposes `sa.mute` as the source of truth.)
    await alice.mute.add('app.bob.harasser');
    // The next sendTo to a muted peer must throw — apps can rely
    // on this for the "are you sure?" UX path being unnecessary.
    // We assert via mute.has + the documented contract.
    expect(alice.mute.has('app.bob.harasser')).toBe(true);

    // Wire up a real connect to verify the throw end-to-end:
    const fakeNkn = makeFakeNknSelf('app.alice.test');
    const a2 = await createSecureAgent({
      vault:  new VaultMemory(),
      nknLib: fakeNkn,
    });
    await a2.peer.connect();
    await a2.mute.add('app.bob.harasser');
    await expect(
      a2.peer.sendTo('app.bob.harasser', { body: 'please stop' })
    ).rejects.toThrow(/muted/);
  });

  it('audit log records the mute event Alice can later prove she made', async () => {
    const alice = await makeFactory();
    await alice.mute.add('app.bob.harasser');
    await Promise.resolve();   // settle autoLog microtask
    const entries = alice.audit.entries();
    const muteEntry = entries.find((e) => e.event === 'mute.add');
    expect(muteEntry).toBeTruthy();
    expect(muteEntry.subject).toBe('app.bob.harasser');
    expect(muteEntry.actor).toBe(alice.identity.pubKey);
    // Chain is verifiable — third-party can confirm Alice took this
    // action (if she shares her chain).
    expect(alice.audit.verify()).toEqual({ ok: true });
  });

  it('Alice\'s mute survives a "page reload" — sendTo still refuses', async () => {
    const sharedVault = new VaultMemory();
    const fakeNkn1    = makeFakeNknSelf('app.alice.test');
    const a1 = await createSecureAgent({
      vault: sharedVault, muteListVaultKey: 'mute', nknLib: fakeNkn1,
    });
    await a1.peer.connect();
    await a1.mute.add('app.bob.harasser');
    await a1.shutdown();

    // Page reload simulation — fresh factory on same vault.
    const fakeNkn2 = makeFakeNknSelf('app.alice.test');
    const a2 = await createSecureAgent({
      vault: sharedVault, muteListVaultKey: 'mute', nknLib: fakeNkn2,
    });
    await a2.peer.connect();
    // Precondition: mute set restored.
    expect(a2.mute.has('app.bob.harasser')).toBe(true);
    // The user-experience claim — sendTo still throws — verified
    // directly through the post-reload factory, not inferred.
    await expect(
      a2.peer.sendTo('app.bob.harasser', { body: 'across the reload' })
    ).rejects.toThrow(/muted/);
  });
});

/* ─── US-2 — Impersonation defence ───────────────────── */

describe('US-2 — Carol cannot impersonate Alice', () => {
  it('Carol cannot produce a claim that verifies as bound to Alice\'s pubKey', async () => {
    const va = new VaultMemory();
    const vc = new VaultMemory();
    const alice = await AgentIdentity.generate(va);
    const carol = await AgentIdentity.generate(vc);

    // Alice signs her own claim.  Normal case.
    const aliceClaim = signClaim(alice, {
      webid: 'https://alice.example/profile/card#me',
    });
    expect(verifyClaim(aliceClaim).ok).toBe(true);
    expect(aliceClaim.pubKey).toBe(alice.pubKey);

    // The impersonation attempt: Carol writes a claim with Alice's
    // pubKey in the body (she wants apps to think "this is bound
    // to Alice's pubKey, so it must be Alice").  She can construct
    // the body, but she'd need Alice's private key to sign over it.
    // We simulate the attempt by SWAPPING in Alice's pubKey on
    // Carol's signed body — which is the strongest attack a forger
    // can mount without Alice's key.
    const carolBody = signClaim(carol, {
      webid: 'https://alice.example/profile/card#me',
    });
    const forgedAsAlice = { ...carolBody, pubKey: alice.pubKey };
    // The defence: verification recomputes the sig over the body
    // (which now contains Alice's pubKey).  Carol's sig was over a
    // DIFFERENT body (with her own pubKey).  Verifier checks
    // sig against (canonicalized body, alice.pubKey) — fails.
    const v = verifyClaim(forgedAsAlice);
    expect(v.ok).toBe(false);
    expect(v.reason).toBe('bad-sig');
  });

  it('Carol\'s own claim is bound to Carol — apps comparing identifier reject it', async () => {
    // This is the "app-layer defence" companion to the cryptographic
    // test above: even when Carol picks Alice's webid string, the
    // bound pubKey in her own (valid) claim is Carol's — so an app
    // comparing "claim.pubKey === expected.pubKey for this webid"
    // catches the mismatch.
    const va = new VaultMemory();
    const vc = new VaultMemory();
    const alice = await AgentIdentity.generate(va);
    const carol = await AgentIdentity.generate(vc);
    const carolClaimingAlicesWebid = signClaim(carol, {
      webid: 'https://alice.example/profile/card#me',
    });
    expect(verifyClaim(carolClaimingAlicesWebid).ok).toBe(true);
    // App's check after verification: does the bound pubKey match
    // who we EXPECT to own this webid?
    expect(carolClaimingAlicesWebid.pubKey).not.toBe(alice.pubKey);
    expect(carolClaimingAlicesWebid.pubKey).toBe(carol.pubKey);
  });

  it('tampering with Alice\'s claim invalidates verification', async () => {
    const va = new VaultMemory();
    const alice = await AgentIdentity.generate(va);
    const claim = signClaim(alice, {
      webid: 'https://alice.example/profile/card#me',
      peerAddr: 'app.alice.real',
    });
    // Attacker pulls the claim off Alice's pod, swaps in their own
    // NKN address (trying to redirect messages to themselves).  Sig
    // is over the original — verification fails.
    const redirected = { ...claim, peerAddr: 'app.attacker.evil' };
    expect(verifyClaim(redirected)).toEqual({ ok: false, reason: 'bad-sig' });
  });
});

/* ─── US-3 — Audit tamper-evidence ────────────────────── */

describe('US-3 — Alice can prove her audit log is intact', () => {
  it('after some activity, the chain verifies cleanly', async () => {
    const alice = await makeFactory();
    await alice.mute.add('app.x');
    await alice.rotateIdentity();
    await alice.mute.add('app.y');
    await Promise.resolve();
    expect(alice.audit.size).toBeGreaterThanOrEqual(3);
    expect(alice.audit.verify()).toEqual({ ok: true });
  });

  it('flipping one bit in any entry breaks the chain at that index', async () => {
    const alice = await makeFactory();
    await alice.mute.add('app.a');
    await alice.mute.add('app.b');
    await alice.mute.add('app.c');
    await Promise.resolve();
    const allEntries = alice.audit.entries();
    expect(allEntries.length).toBe(3);

    // Simulate someone tampering with the persisted chain: load,
    // mutate, restore.  Use the serialize/restore round-trip.
    const tampered = allEntries.map((e, i) =>
      i === 1 ? { ...e, subject: 'app.NOT-the-original' } : e,
    );
    const tamperedJson = JSON.stringify(tampered);
    // Re-load into a fresh AuditLog + verify.  (Use a fresh factory
    // so we're testing the load path the user would hit on next boot.)
    await alice.audit.loadSerialized(tamperedJson);
    const result = alice.audit.verify();
    expect(result.ok).toBe(false);
    expect(result.brokenAt).toBe(1);
    expect(['bad-sig', 'bad-prev']).toContain(result.reason);
  });

  it('basis /audit-tail surfaces the broken state in the user\'s view', async () => {
    // End-to-end through realAgent + slash-dispatch: a broken chain
    // shows up in the message a real user would see.
    const vault = new VaultMemory();
    const agent = await createRealHouseholdAgent({ chatVault: vault });
    await agent.sa.mute.add('app.user.x');
    await agent.sa.mute.add('app.user.y');
    await Promise.resolve();
    // Tamper a persisted entry.
    const tampered = agent.sa.audit.entries().map((e, i) =>
      i === 0 ? { ...e, subject: 'tampered!' } : e,
    );
    await agent.sa.audit.loadSerialized(JSON.stringify(tampered));

    // Dispatch /audit-tail through the same pipeline a user hits.
    // Reuse the helper from the security journeys: parseInput →
    // resolveDispatch → runDispatch → handler payload.
    const { run } = await bootSafetyHelpers(agent);
    const res = await run('/audit-tail');
    expect(typeof res.message).toBe('string');
    expect(res.message).toMatch(/BROKEN/);
    expect(res.message).toMatch(/bad-(sig|prev)/);
  });
});

/* ─── US-4 — PFS cross-isolation ──────────────────────── */

describe('US-4 — Carol cannot decrypt Alice ↔ Bob PFS traffic', () => {
  it('three identities; only the addressed peer decrypts', async () => {
    const alice = await makeFactory({ usePerfectFwdSec: true });
    const bob   = await makeFactory({ usePerfectFwdSec: true });
    const carol = await makeFactory({ usePerfectFwdSec: true });

    // Alice encrypts to Bob.
    const wire = await alice.pfs.encrypt(bob.identity.pubKey, 'secret to bob');

    // Bob decrypts fine.
    const decoded = await bob.pfs.decrypt(alice.identity.pubKey, wire);
    expect(new TextDecoder().decode(decoded)).toBe('secret to bob');

    // Carol intercepts the same wire bytes.  She tries to decrypt
    // either as if from Alice or as if to Bob — neither works
    // because her identity ≠ Bob's, so her chain key ≠ Bob's.
    await expect(carol.pfs.decrypt(alice.identity.pubKey, wire))
      .rejects.toThrow(/auth failed|secretbox|bad-prev|stale/);
  });
});

/* ─── US-5 — Block-by-identity (alias fanout) ─────────── */

describe('US-5 — Muting Bob by webid blocks him across devices', () => {
  it('after a key rotation, the same webid still resolves + the mute still applies', async () => {
    // MemberMap binds webid to a pubKey today.  After Bob rotates,
    // the MemberMap entry updates to the new pubKey but the webid
    // stays the same.  Alice's mute keyed on the webid still hits.
    const bobNewPubKey = 'pk-bob-after-rotation';
    const memberMap = {
      async resolveByPubKey(pk) {
        return pk === bobNewPubKey
          ? {
              webid: 'https://bob.example/#me',
              pubKey: bobNewPubKey,
              stableId: 'sid-bob',
            }
          : null;
      },
      async resolveByWebid()    { return null; },
      async resolveByStableId() { return null; },
    };
    const alice = await makeFactory({ identityResolver: memberMap });
    await alice.mute.add('https://bob.example/#me');

    // Bob (post-rotation) sends from a new NKN address derived from
    // his new pubKey.  Alice's SecurityLayer has registered the new
    // (addr, pubKey).
    alice.agent.security.registerPeer('app.bob.rotated', bobNewPubKey);

    // Aliases for that addr include the original webid → mute hits.
    const aliases = await alice.resolver.aliasesFor('app.bob.rotated');
    expect(aliases).toContain('https://bob.example/#me');
    // sendTo to the new addr refuses because the alias matches mute:
    const fakeNkn = makeFakeNknSelf('app.alice');
    const aliceWithPeerAddr = await createSecureAgent({
      vault:            new VaultMemory(),
      nknLib:           fakeNkn,
      identityResolver: memberMap,
    });
    await aliceWithPeerAddr.peer.connect();
    aliceWithPeerAddr.agent.security.registerPeer('app.bob.rotated', bobNewPubKey);
    await aliceWithPeerAddr.mute.add('https://bob.example/#me');
    await expect(
      aliceWithPeerAddr.peer.sendTo('app.bob.rotated', { body: 'no' })
    ).rejects.toThrow(/muted/);
  });
});

/* ─── US-6 — Rate-limit dampens a flooder ─────────────── */

describe('US-6 — Rate limit caps a flooder', () => {
  it('after BURST sends from one peer, further sends are dropped', async () => {
    const alice = await makeFactory({
      rateLimit: { perPeer: { burst: 5, refillPerSec: 0 }, global: false },
    });
    // Simulate Bob hammering Alice with check() calls (which the
    // factory's receive path does for every inbound envelope).  After
    // 5 the bucket is empty; further hits are denied.
    let allowed = 0;
    for (let i = 0; i < 50; i++) {
      if (alice.rateLimit.check('app.bob.flooder')) allowed++;
    }
    expect(allowed).toBe(5);

    // A different peer at slower pace is unaffected — bucket is per-peer.
    expect(alice.rateLimit.check('app.charlie.normal')).toBe(true);
    expect(alice.rateLimit.check('app.charlie.normal')).toBe(true);
  });

  it('snapshot lets the user inspect who is being throttled', async () => {
    const alice = await makeFactory({
      rateLimit: { perPeer: { burst: 3, refillPerSec: 0 }, global: false },
    });
    for (let i = 0; i < 10; i++) alice.rateLimit.check('app.bob.flooder');
    const snap = alice.rateLimit.snapshot();
    expect(snap.peers['app.bob.flooder'].tokens).toBe(0);
  });
});

/* ─── US-7 — Identity stability across reload ─────────── */

describe('US-7 — Alice keeps the same pubKey + stableId after a page reload', () => {
  it('createRealHouseholdAgent twice on the same vault → same identity', async () => {
    const sharedVault = new VaultMemory();
    // The identity root persists across the reload too (the at-rest layer's fingerprint rule).
    const sharedRoot = new VaultMemory();
    const a1 = await createRealHouseholdAgent({ chatVault: sharedVault, ownerRootVault: sharedRoot });
    const pub1 = a1.identity.chat.pubKey;
    const stable1 = a1.identity.chat.stableId;

    // Simulate reload — factory rebuilds, vault is the same.
    const a2 = await createRealHouseholdAgent({ chatVault: sharedVault, ownerRootVault: sharedRoot });
    expect(a2.identity.chat.pubKey).toBe(pub1);
    expect(a2.identity.chat.stableId).toBe(stable1);
  });

  it('after /rotate-identity the new pubKey replaces the old + persists too', async () => {
    const sharedVault = new VaultMemory();
    // The identity root persists across the reload too (the at-rest layer's fingerprint rule).
    const sharedRoot = new VaultMemory();
    const a1 = await createRealHouseholdAgent({ chatVault: sharedVault, ownerRootVault: sharedRoot });
    const orig = a1.identity.chat.pubKey;
    const r = await a1.rotateChatIdentity();
    expect(r.oldPubKey).toBe(orig);
    expect(r.newPubKey).not.toBe(orig);
    const newPub = r.newPubKey;

    // Reload — the NEW key should be what's restored, not the old one.
    const a2 = await createRealHouseholdAgent({ chatVault: sharedVault, ownerRootVault: sharedRoot });
    expect(a2.identity.chat.pubKey).toBe(newPub);
  });
});

/* ─── slash-pipeline helper (real dispatch) ───────────── */

async function bootSafetyHelpers(agent) {
  const catalogue = mergeManifests(
    [{ manifest: basisManifest }, { manifest: agent.manifest }],
    { runtime: 'browser' },
  );
  const threadStore = createDefaultThreadStore();
  const t = (k, p) => p ? `${k}(${JSON.stringify(p)})` : k;

  const callSkill = async (appOrigin, opId, args) => {
    if (appOrigin === 'basis') return localBuiltins[opId]?.(args ?? {});
    if (appOrigin === 'household')   return agent.callSkill(appOrigin, opId, args);
    return { ok: false, error: `${appOrigin}.${opId} not wired` };
  };
  const localBuiltins = createLocalBuiltins({
    catalogue, t, threadStore,
    setActive: (id) => threadStore.setActiveThread(id),
    callSkill, localActor: 'webid:local-demo-user',
    simPeers: {}, appRegistry: { allowsOrigin: () => true, subscribe: () => () => {} },
    eventLog: { append: () => {}, query: () => [], attachToRouter: () => {} },
    briefRunner: async () => ({}),
    findRunner:  async () => ({ items: [] }),
    agent, podAuth: null, externalFlow: null, openFilePicker: null,
    connectPeer: async () => agent.peer,
  });

  async function run(line) {
    const parsed = parseInput(line, catalogue, { threadId: null });
    const route  = resolveDispatch(parsed, catalogue);
    if (route.kind !== 'ready') return { ok: false, error: route.error ?? 'parse fail' };
    const reply = await runDispatch(route, callSkill);
    if (reply.error) return { ok: false, error: reply.error.message };
    return reply.payload ?? { ok: true };
  }
  return { run, catalogue, callSkill };
}

/* ─── Minimal fake NKN — single-client (no loopback) ──── */

function makeFakeNknSelf(address) {
  const instance = {
    addr: address,
    sends: [],
    handlers: { connect: [], message: [], error: [] },
    on(event, cb) { (this.handlers[event] ??= []).push(cb); },
    async send(to, payload) { this.sends.push({ to, payload }); },
    close() {},
  };
  // Client must be a constructor (NknTransport uses `new`).  A plain
  // function that returns an explicit object satisfies this.
  return {
    Client: function (_opts) {
      queueMicrotask(() => {
        for (const cb of instance.handlers.connect) cb();
      });
      return instance;
    },
    _instance: instance,
  };
}
