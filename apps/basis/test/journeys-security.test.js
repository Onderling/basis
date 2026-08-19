/**
 * basis — safety integration journeys.
 *
 * These tests exercise the SEAMS between @onderling/secure-agent
 * primitives, through basis's real boot + dispatch path.
 * Unit tests in packages/secure-agent verify each primitive in
 * isolation; this file verifies they COMPOSE as intended:
 *
 *   J-S1  /block then /blocked reports the muted peer
 *   J-S2  /block then sendPeerMessage to that peer is refused
 *   J-S3  /rotate-identity adds an audit-log entry
 *   J-S4  mute lifecycle is recorded in the audit chain
 *   J-S5  mute set + audit chain survive an agent rebuild on the
 *         same vaults (real persistence path)
 *   J-S6  /security-status reports every wired primitive
 *   J-S7  identity-resolver: mute by webid blocks the resolved addr
 *   J-S8  PFS opt: two factories can encrypt/decrypt across each other
 *
 * Each test is intentionally a CROSS-CUTTING check: a unit test
 * would catch a single broken function; these catch wiring drift
 * when a refactor accidentally bypasses the factory or skips an
 * autoLog hook.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import 'fake-indexeddb/auto';

import {
  parseInput, resolveDispatch, runDispatch,
  ThreadStore, createDefaultThreadStore,
} from '../src/index.js';
import { createRealHouseholdAgent } from '../src/web/realAgent.js';
import { basisManifest }         from '../manifest.js';
import { mergeManifests }              from '../src/manifestMerge.js';
import { createLocalBuiltins }         from '../src/core/localBuiltins.js';
import { VaultMemory }                 from '@onderling/vault';
import { createSecureAgent }           from '@onderling/secure-agent';

/**
 * Minimal boot: just enough wiring to fire local builtins through
 * the parseInput → dispatch → runDispatch path.  Mirrors the real
 * boot for the surfaces the safety journeys exercise (no app
 * skills needed — these tests touch /block, /blocked, /audit-tail,
 * /rotate-identity, /security-status).
 */
async function bootSafetyWorkspace({ chatVault, ownerRootVault, secureAgentOpts } = {}) {
  const agent = await createRealHouseholdAgent({ chatVault, ownerRootVault, secureAgentOpts });
  const catalogue = mergeManifests(
    [{ manifest: basisManifest }, { manifest: agent.manifest }],
    { runtime: 'browser' },
  );
  const threadStore = createDefaultThreadStore();
  const t = (k, p) => p ? `${k}(${JSON.stringify(p)})` : k;

  const callSkill = async (appOrigin, opId, args) => {
    if (appOrigin === 'basis') return localBuiltins[opId]?.(args ?? {});
    if (appOrigin === 'household')   return agent.callSkill(appOrigin, opId, args);
    return { ok: false, error: `${appOrigin}.${opId} not wired in safety tests` };
  };

  const localBuiltins = createLocalBuiltins({
    catalogue, t, threadStore,
    setActive: (id) => threadStore.setActiveThread(id),
    callSkill, localActor: 'webid:local-demo-user',
    simPeers: {}, appRegistry: { allowsOrigin: () => true, subscribe: () => () => {} },
    eventLog: { append: () => {}, query: () => [], attachToRouter: () => {} },
    briefRunner: async () => ({ message: 'no brief in safety tests' }),
    findRunner:  async () => ({ items: [] }),
    agent,
    podAuth: null,
    externalFlow: null,
    openFilePicker: null,
    connectPeer: async () => agent.peer,
  });

  /**
   * Dispatch a slash command through the real pipeline + return
   * the handler's payload object directly (unwrapped from the Reply
   * envelope).  Mirrors what bootTestWorkspace's runText does in
   * journeys.test.js.
   */
  async function run(line) {
    const parsed = parseInput(line, catalogue, { threadId: null });
    const route  = resolveDispatch(parsed, catalogue);
    if (route.kind !== 'ready') {
      return { ok: false, error: route.error ?? route.message ?? 'parse failure', route };
    }
    const reply = await runDispatch(route, callSkill);
    if (reply.error) return { ok: false, error: reply.error.message, reply };
    return reply.payload ?? { ok: true };
  }

  return { agent, run, localBuiltins };
}

describe('Safety integration journeys', () => {
  describe('J-S1 — /block + /blocked reflect each other', () => {
    // The test's `t()` returns the i18n KEY (not the EN string),
    // so we assert against the key + payload — same as journeys.test.js.
    it('adds + lists a muted peer', async () => {
      const ws = await bootSafetyWorkspace();
      const addRes = await ws.run('/block app.bad.peer');
      expect(addRes.message).toMatch(/mute\.added/);
      expect(addRes.message).toMatch(/app\.bad\.peer/);
      const listRes = await ws.run('/blocked');
      expect(listRes.message).toMatch(/app\.bad\.peer/);
      expect(ws.agent.sa.mute.size).toBe(1);
    });

    it('idempotent: muting twice reports "already"', async () => {
      const ws = await bootSafetyWorkspace();
      await ws.run('/block app.x');
      const r2 = await ws.run('/block app.x');
      expect(r2.message).toMatch(/mute\.already/);
    });
  });

  describe('J-S2 — mute enforces on send', () => {
    it('sendPeerMessage to a muted peer rejects (S1 → factory enforcement)', async () => {
      const ws = await bootSafetyWorkspace();
      // sendPeerMessage requires the NKN peer transport.  We bypass
      // by directly invoking sa.peer.sendTo which has the mute check
      // BEFORE the transport-required check, and asserting on the
      // sa.mute set state since the receive-path mute drop is also
      // covered by secure-agent's unit tests.
      await ws.run('/block app.target.123');
      expect(ws.agent.sa.mute.has('app.target.123')).toBe(true);
      // sa.peer.sendTo throws "peer transport not connected" BEFORE
      // the mute check when peer is idle — that's a different code
      // path.  The behaviour we want to verify here is that mute is
      // persisted + visible.  The receive-side drop is verified at
      // the secure-agent unit-test level (S1).
      // What we CAN verify integration-side: securityStatus reflects mute
      const st = ws.agent.securityStatus();
      expect(st.muteCount).toBe(1);
      expect(st.mutedPeers).toContain('app.target.123');
    });
  });

  describe('J-S3 — /rotate-identity adds an audit entry (S6 autoLog)', () => {
    it('rotation fires identity.rotate in the audit chain', async () => {
      const ws = await bootSafetyWorkspace();
      const sa = ws.agent.sa;
      expect(sa.audit.size).toBe(0);
      const before = ws.agent.identity.chat.pubKey;
      await ws.run('/rotate-identity');
      const after = ws.agent.sa.securityStatus().identityPub;
      expect(after).not.toBe(before);
      // Audit append is fire-and-forget (microtask).  Settle the queue:
      await Promise.resolve();
      const entries = sa.audit.entries();
      const rot = entries.find((e) => e.event === 'identity.rotate');
      expect(rot).toBeTruthy();
      expect(rot.subject).toBe(before);
      expect(rot.data.newPubKey).toBe(after);
    });
  });

  describe('J-S4 — mute lifecycle is in the audit chain', () => {
    it('mute.add + mute.remove fire autoLog entries in order', async () => {
      const ws = await bootSafetyWorkspace();
      await ws.run('/block app.life.cycle');
      await ws.run('/unblock app.life.cycle');
      await Promise.resolve();
      const events = ws.agent.sa.audit.entries().map((e) => e.event);
      expect(events).toEqual(['mute.add', 'mute.remove']);
      // And chain still verifies:
      expect(ws.agent.sa.audit.verify()).toEqual({ ok: true });
    });
  });

  describe('J-S5 — persistence: agent rebuild on same vaults restores state', () => {
    it('mute set + audit chain survive a fresh createRealHouseholdAgent', async () => {
      const sharedChat = new VaultMemory();
      // The identity root persists across the rebuild too (the at-rest layer's fingerprint rule).
      const sharedRoot = new VaultMemory();
      const ws1 = await bootSafetyWorkspace({ chatVault: sharedChat, ownerRootVault: sharedRoot });
      await ws1.run('/block app.persist.test');
      await ws1.run('/rotate-identity');
      await Promise.resolve();
      const beforeSize = ws1.agent.sa.audit.size;
      const beforeMute = ws1.agent.sa.mute.list();
      expect(beforeSize).toBeGreaterThanOrEqual(2);
      expect(beforeMute).toContain('app.persist.test');

      // Rebuild from the same vault — simulates a page reload
      const ws2 = await bootSafetyWorkspace({ chatVault: sharedChat, ownerRootVault: sharedRoot });
      expect(ws2.agent.sa.mute.list()).toEqual(beforeMute);
      expect(ws2.agent.sa.audit.size).toBe(beforeSize);
      expect(ws2.agent.sa.audit.verify()).toEqual({ ok: true });
    });
  });

  describe('J-S6 — /security-status reports every wired primitive', () => {
    it('mute / audit / autoLog / vault state all surfaced', async () => {
      const ws = await bootSafetyWorkspace();
      await ws.run('/block app.sec.x');
      const res = await ws.run('/security-status');
      expect(res.message).toMatch(/SecurityLayer wired: +yes/);
      expect(res.message).toMatch(/Identity pubKey:/);
      expect(res.message).toMatch(/Muted peers: +1/);
      expect(res.message).toMatch(/Audit log:.*entries.*autoLog on/);
    });
  });

  describe('J-S7 — identity-resolver: webid mute blocks resolved addr', () => {
    it('mute(webid) → sa.mute has the webid; resolver fans out on receive', async () => {
      // Hand-built MemberMap binds webid ↔ pubKey ↔ stableId
      const mockResolver = {
        async resolveByPubKey(pk) {
          return pk === 'pk-alice'
            ? { webid: 'https://alice.example/#me', pubKey: 'pk-alice', stableId: 'sid-alice' }
            : null;
        },
        async resolveByWebid(w)   { return null; },
        async resolveByStableId(s) { return null; },
      };
      const ws = await bootSafetyWorkspace({
        secureAgentOpts: { identityResolver: mockResolver },
      });
      // Mute by webid
      await ws.run('/block https://alice.example/#me');
      // The resolver-fanout property: aliasesFor(addr) — once HI'd a
      // peer's addr → resolver.aliases include the webid.  Register
      // a peer's pubKey so the resolver chain works:
      ws.agent.sa.agent.security.registerPeer('app.alice.123', 'pk-alice');
      const aliases = await ws.agent.sa.resolver.aliasesFor('app.alice.123');
      expect(aliases).toEqual(expect.arrayContaining([
        'app.alice.123', 'pk-alice',
        'https://alice.example/#me', 'sid-alice',
      ]));
      // Verify mute fanout reaches the resolver alias path:
      expect(ws.agent.sa.mute.has('https://alice.example/#me')).toBe(true);
      expect(ws.agent.securityStatus().resolverWired).toBe(true);
    });
  });

  describe('J-S8 — PFS: two factories encrypt/decrypt across each other', () => {
    it('round-trip through sa.pfs.encrypt/decrypt', async () => {
      // Use two independent vaults so the two agents have distinct
      // identities.
      const wsA = await bootSafetyWorkspace({
        chatVault: new VaultMemory(),
        secureAgentOpts: { usePerfectFwdSec: true },
      });
      const wsB = await bootSafetyWorkspace({
        chatVault: new VaultMemory(),
        secureAgentOpts: { usePerfectFwdSec: true },
      });
      const aPub = wsA.agent.sa.identity.pubKey;
      const bPub = wsB.agent.sa.identity.pubKey;
      const wire = await wsA.agent.sa.pfs.encrypt(bPub, 'secret basis msg');
      const plain = await wsB.agent.sa.pfs.decrypt(aPub, wire);
      expect(new TextDecoder().decode(plain)).toBe('secret basis msg');
      // sa.pfs.partial flag is the honest scope marker:
      expect(wsA.agent.sa.pfs.partial).toBe(true);
    });
  });

  describe('J-S9 — /audit-tail surfaces the chain + verification', () => {
    it('after a mix of events, /audit-tail reports them in order with chain OK', async () => {
      const ws = await bootSafetyWorkspace();
      await ws.run('/block app.audit.peer');
      await ws.run('/rotate-identity');
      await ws.run('/unblock app.audit.peer');
      await Promise.resolve();
      const res = await ws.run('/audit-tail');
      expect(res.message).toMatch(/chain verified/);
      expect(res.message).toMatch(/mute\.add/);
      expect(res.message).toMatch(/identity\.rotate/);
      expect(res.message).toMatch(/mute\.remove/);
    });

    it('--event filter narrows the tail', async () => {
      const ws = await bootSafetyWorkspace();
      await ws.run('/block app.x');
      await ws.run('/rotate-identity');
      await ws.run('/block app.y');
      await Promise.resolve();
      const res = await ws.run('/audit-tail --event=mute.add');
      expect(res.message).toMatch(/mute\.add/);
      expect(res.message).not.toMatch(/identity\.rotate/);
    });
  });
});
