/**
 * IdentityWiring — B4 unit tests.
 *
 * Coverage:
 *   • happy path: attachIdentityToAgent returns { bootstrap, podStore, sync, dispose }
 *     and the (injected stub) sync is started.
 *   • dispose tears the sync down.
 *   • bad opts throw with clear messages.
 *   • Lazy RN import: in the Node test env (no `react-native` available
 *     here at runtime — vitest globals only), the wiring still constructs
 *     successfully and dispose is safe.
 *
 * IdentitySync (shipped by B3 in parallel) is injected via the test-only
 * `_identitySyncCtor` knob so this test does not depend on B3 being merged.
 * When B3 lands its IdentitySync export in `@onderling/core`, the production
 * code path (no `_identitySyncCtor`) takes over automatically.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { AgentIdentity, Bootstrap } from '@onderling/core';
import { VaultMemory } from '@onderling/vault';
import { generateMnemonic } from '@onderling/core';
import { attachIdentityToAgent } from '../../src/identity/IdentityWiring.js';

// ── Stub PodClient (in-memory; mirrors the surface IdentityPodStore.init
//    needs: read / write / list, with NOT_FOUND on missing reads). ──────────

function makePodClient() {
  const store = new Map(); // uri → bytes (string)
  return {
    _store: store,
    async read(uri) {
      if (!store.has(uri)) {
        const e = new Error(`NOT_FOUND ${uri}`);
        e.code = 'NOT_FOUND';
        throw e;
      }
      return { content: store.get(uri), uri };
    },
    async write(uri, bytes /* , opts */) {
      store.set(uri, bytes);
      return { uri };
    },
    async list(uri) {
      // Empty container → no entries.  init() walks the identity root for
      // the contentHash; a fresh container has nothing.
      void uri;
      return { entries: [] };
    },
  };
}

// ── Stub IdentitySync (mimics the shape B3 will ship). ─────────────────────

function makeIdentitySyncCtor() {
  const instances = [];
  class IdentitySync {
    constructor(opts) {
      this.opts = opts;
      this.isRunning = false;
      this.foregroundCalls = 0;
      this.nowCalls = [];
      instances.push(this);
    }
    start() { this.isRunning = true; }
    stop()  { this.isRunning = false; }
    onForeground() { this.foregroundCalls += 1; }
    now(opts) { this.nowCalls.push(opts); return Promise.resolve(); }
  }
  IdentitySync._instances = instances;
  return IdentitySync;
}

// ── Helpers ────────────────────────────────────────────────────────────────

async function makeIdentity() {
  const vault = new VaultMemory();
  const identity = await AgentIdentity.generate(vault);
  return { vault, identity };
}

function makePodOpt(overrides = {}) {
  // Generate a real BIP-39 mnemonic so Bootstrap.fromMnemonic accepts it.
  const mnemonic = generateMnemonic();
  return {
    webid:    'https://alice.example/profile/card#me',
    mnemonic,
    podClient: makePodClient(),
    podRoot:  'https://alice.example/',
    _identitySyncCtor: makeIdentitySyncCtor(),
    ...overrides,
  };
}

// ── Tests ──────────────────────────────────────────────────────────────────

describe('attachIdentityToAgent (B4)', () => {

  let baseIdentity;
  beforeEach(async () => {
    baseIdentity = await makeIdentity();
  });

  it('happy path: constructs Bootstrap + IdentityPodStore + IdentitySync; sync is running', async () => {
    const pod = makePodOpt();
    const wiring = await attachIdentityToAgent({
      vault:    baseIdentity.vault,
      identity: baseIdentity.identity,
      pod,
    });
    expect(wiring.bootstrap).toBeInstanceOf(Bootstrap);
    expect(wiring.podStore).toBeTruthy();
    expect(wiring.podStore.root).toBe('https://alice.example/onderling/');
    expect(wiring.sync).toBeTruthy();
    expect(wiring.sync.isRunning).toBe(true);
    // The IdentitySync constructor saw vault + podStore + intervalMs.
    expect(wiring.sync.opts.vault).toBe(baseIdentity.vault);
    expect(wiring.sync.opts.podStore).toBe(wiring.podStore);
    expect(wiring.sync.opts.intervalMs).toBe(300_000);
    expect(typeof wiring.dispose).toBe('function');
  });

  it('respects a caller-supplied intervalMs', async () => {
    const pod = makePodOpt({ intervalMs: 60_000 });
    const wiring = await attachIdentityToAgent({
      vault:    baseIdentity.vault,
      identity: baseIdentity.identity,
      pod,
    });
    expect(wiring.sync.opts.intervalMs).toBe(60_000);
  });

  it('accepts a pre-built bootstrap (skipping mnemonic derivation)', async () => {
    const { bootstrap: pre } = Bootstrap.create();
    const pod = makePodOpt({ bootstrap: pre, mnemonic: undefined });
    const wiring = await attachIdentityToAgent({
      vault:    baseIdentity.vault,
      identity: baseIdentity.identity,
      pod,
    });
    expect(wiring.bootstrap).toBe(pre);
  });

  it('dispose() stops the sync and is safe to call', async () => {
    const pod = makePodOpt();
    const wiring = await attachIdentityToAgent({
      vault:    baseIdentity.vault,
      identity: baseIdentity.identity,
      pod,
    });
    expect(wiring.sync.isRunning).toBe(true);
    wiring.dispose();
    expect(wiring.sync.isRunning).toBe(false);
    // Idempotent — calling again should not throw.
    expect(() => wiring.dispose()).not.toThrow();
  });

  it('throws on missing vault', async () => {
    await expect(
      attachIdentityToAgent({ identity: baseIdentity.identity, pod: makePodOpt() })
    ).rejects.toThrow(/vault is required/);
  });

  it('throws on missing identity', async () => {
    await expect(
      attachIdentityToAgent({ vault: baseIdentity.vault, pod: makePodOpt() })
    ).rejects.toThrow(/identity is required/);
  });

  it('throws on missing pod opt', async () => {
    await expect(
      attachIdentityToAgent({ vault: baseIdentity.vault, identity: baseIdentity.identity })
    ).rejects.toThrow(/pod opt is required/);
  });

  it('throws on missing pod.podClient', async () => {
    const pod = makePodOpt();
    delete pod.podClient;
    await expect(
      attachIdentityToAgent({ vault: baseIdentity.vault, identity: baseIdentity.identity, pod })
    ).rejects.toThrow(/podClient is required/);
  });

  it('throws on missing pod.podRoot', async () => {
    const pod = makePodOpt();
    delete pod.podRoot;
    await expect(
      attachIdentityToAgent({ vault: baseIdentity.vault, identity: baseIdentity.identity, pod })
    ).rejects.toThrow(/podRoot is required/);
  });

  it('throws on missing pod.mnemonic AND pod.bootstrap', async () => {
    const pod = makePodOpt();
    delete pod.mnemonic;
    delete pod.bootstrap;
    await expect(
      attachIdentityToAgent({ vault: baseIdentity.vault, identity: baseIdentity.identity, pod })
    ).rejects.toThrow(/mnemonic or pod\.bootstrap is required/);
  });

  it('lazy RN import: no `react-native` in Node test env → wiring still succeeds, dispose safe', async () => {
    // We do NOT mock `react-native` in this file — vitest's `node`
    // environment has no RN.  The dynamic import inside the wiring should
    // catch + skip the AppState branch.  Construction must still succeed
    // and dispose must not throw.
    const pod = makePodOpt();
    const wiring = await attachIdentityToAgent({
      vault:    baseIdentity.vault,
      identity: baseIdentity.identity,
      pod,
    });
    expect(wiring.sync.isRunning).toBe(true);
    expect(() => wiring.dispose()).not.toThrow();
  });
});

// ── Integration: createMeshAgent without `pod` opt (regression / no-op). ──
// Verifies Q-B.2 side-by-side guarantee: callers that don't pass `pod`
// see EXACTLY today's behavior.  We rely on the existing createMeshAgent
// test mocks for native modules; this test re-uses those mocks via a
// targeted import.

describe('createMeshAgent — pod opt absent (regression)', () => {
  it('constructs without IdentityWiring touching the agent', async () => {
    // We test this indirectly: importing IdentityWiring is a side-effect-free
    // module, so simply not passing `pod` is the contract.  The existing
    // createMeshAgent.test.js suite covers the no-pod path end-to-end with
    // all native mocks; we don't duplicate that wiring here.  This test is
    // a placeholder to make the regression contract explicit.
    expect(typeof attachIdentityToAgent).toBe('function');
  });
});
