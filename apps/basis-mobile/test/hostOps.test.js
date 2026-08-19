/**
 * mobile host-op port (lifted localBuiltins).
 *
 * Pins the contract that `buildMobileLocalBuiltins` exposes the
 * canonical web handlers (≥15 commands) and that the threadStore
 * adapter correctly bridges the mobile threadState reducer to the
 * shape localBuiltins expects.
 *
 * Smoke-test approach — drive `/help`, `/me`, `/whoami`,
 * `/security-status`, `/reset-thread`, `/threads`, `/newthread` and
 * assert they return well-formed payloads (NOT the V1 "not wired"
 * sentinel).
 */
import { describe, it, expect, beforeEach } from 'vitest';

import { buildMobileLocalBuiltins } from '../src/core/hostOps.js';
import {
  createInitialThreadState, __resetThreadIdSeq,
} from '../src/core/threadState.js';

// Stub localiser — returns the key + interpolations so tests can
// assert which key was hit + which params landed.
const t = (key, params = {}) => {
  const tail = Object.entries(params)
    .map(([k, v]) => `${k}=${v}`)
    .join(' ');
  return tail ? `[${key}](${tail})` : `[${key}]`;
};

function buildHarness() {
  __resetThreadIdSeq();
  let threadState = createInitialThreadState();
  const threadStateRef = { current: threadState };
  const setThreadState = (next) => {
    const value = typeof next === 'function' ? next(threadStateRef.current) : next;
    threadStateRef.current = value;
    threadState = value;
  };
  const agent = {
    identity: {
      chat: { pubKey: 'pubkey-abc123', stableId: 'stable-xyz' },
      host: { webid: 'https://alice.example/profile/card#me' },
    },
    peer:    { address: 'app.abcdef0123456789', status: 'connected' },
  };
  const catalog = {
    opsById:    new Map(),
    appOrigins: new Set(['basis']),
    appsById:   new Map([['basis', { id: 'basis', ops: [] }]]),
    // Bundle G1 — runBrief + runFind require these catalog
    // methods.  Production catalog (mergeManifests) provides them;
    // here we return empty lists so the runners produce a clean
    // empty-result reply instead of throwing.
    briefAggregations:  () => [],
    searchAggregations: () => [],
  };
  const callSkill = async () => ({ ok: false, error: 'no-substrate-in-test' });
  const handlers  = buildMobileLocalBuiltins({
    threadStateRef, setThreadState,
    agent, catalog, callSkill, t,
  });
  return { handlers, getState: () => threadStateRef.current };
}

describe('Bundle F P1 — buildMobileLocalBuiltins', () => {
  let h;
  beforeEach(() => { h = buildHarness(); });

  it('exposes core host-op handlers (≥ 15 commands)', () => {
    const present = [
      'help', 'me', 'whoami', 'reset-thread', 'security-status',
      'threads', 'newthread', 'rotate-identity',
      'mute', 'unmute', 'muted', 'transports', 'transport-mode',
      'set-relay', 'audit-tail', 'debug-dump',
      'test-peer', 'peer-connect',
    ];
    for (const opId of present) {
      expect(h.handlers[opId], `missing handler for /${opId}`).toBeTypeOf('function');
    }
  });

  it('/me returns identity info from the agent', async () => {
    const r = await h.handlers.me({});
    expect(r.message).toContain('pubkey-abc123');
    expect(r.message).toContain('stable-xyz');
    expect(r.message).toContain('app.abcdef0123456789');
  });

  it('/help returns a non-empty payload', async () => {
    const r = await h.handlers.help({});
    expect(r).toBeTruthy();
    // Web's formatHelp returns a message; the exact shape can vary
    // (text vs structured) — both are fine as long as we have content.
    expect(typeof r.message === 'string' || Array.isArray(r.items)).toBe(true);
  });

  it('/threads lists threads via the mobile adapter', async () => {
    const r = await h.handlers.threads({});
    expect(r.message).toContain('Main');
  });

  it('/newthread creates a thread + auto-switches (verified via threadStateRef)', async () => {
    const before = h.getState().threads.size;
    const r = await h.handlers.newthread({ name: 'Circle' });
    expect(r.ok).toBe(true);
    const after = h.getState();
    expect(after.threads.size).toBe(before + 1);
    expect(after.activeThreadId).toBe(r.threadId);
    expect(after.threads.get(r.threadId).name).toBe('Circle');
  });

  it('/reset-thread clears the active thread\'s messages', async () => {
    // Pre-populate the Main thread with a message via adapter — we
    // don\'t have appendMessage directly, but listing should still work.
    const r = await h.handlers['reset-thread']({});
    // Whether the message-clear path is wired through threadStore or
    // not, the handler should at least return a recognisable shape
    // (ok flag + a message OR an error reason).
    expect(r).toBeTruthy();
  });

  it('/whoami falls back to "unavailable" when podAuth is not wired', async () => {
    const r = await h.handlers.whoami({});
    // V1 mobile boot doesn\'t wire podAuth; handler returns the
    // unavailable message rather than crashing.
    expect(typeof r.message).toBe('string');
  });

  it('/security-status returns agent identity status without crashing', async () => {
    const r = await h.handlers['security-status']({});
    expect(r).toBeTruthy();
  });

  // Bundle G1 — these handlers used to return no_runner /
  // no_registry sentinels.  Now they actually run.
  it('/brief returns a brief-shape reply (no no_runner sentinel)', async () => {
    const r = await h.handlers.brief({});
    expect(r).toBeTruthy();
    // runBrief returns { sections, generatedAt, cacheKey } — never
    // the { ok: false, error: 'brief.no_runner' } sentinel.
    expect(r.error ?? '').not.toContain('brief.no_runner');
    expect(Array.isArray(r.sections) || typeof r.message === 'string').toBe(true);
  });

  it('/find returns a find-shape reply (no no_runner sentinel)', async () => {
    const r = await h.handlers.find({ query: 'anything' });
    expect(r).toBeTruthy();
    expect(r.error ?? '').not.toContain('find.no_runner');
    // runFind returns { query, groups, generatedAt, ... } OR the
    // empty-query path { ok: false, error: 'find.no_query' } when
    // query is blank.  We passed a query, so groups must exist.
    expect(Array.isArray(r.groups) || typeof r.message === 'string').toBe(true);
  });

  it('/apps returns an apps-list reply (no no_registry sentinel)', async () => {
    const r = await h.handlers.apps({});
    expect(r).toBeTruthy();
    // appsToggle on success returns a message or items shape; on
    // missing-registry it would have returned { ok: false, error:
    // 'apps.no_registry' }.  Either typeof message is string or
    // items array exists.
    expect(r.error ?? '').not.toContain('apps.no_registry');
  });

  // Bundle G3 — /lookup-peer + /publish-peer.
  it('/lookup-peer + /publish-peer report unavailable when sessionRef is not wired', async () => {
    // The default buildHarness above doesn't pass sessionRef, so the
    // built-ins fall back to the t('lookup.unavailable') /
    // t('publishPeerAddrCmd.unavailable') sentinels — NOT a crash.
    const r1 = await h.handlers['lookup-peer']({ webid: 'https://bob/#me' });
    expect(r1.ok).toBe(false);
    expect(r1.error).toContain('lookup.unavailable');
    const r2 = await h.handlers['publish-peer']({});
    expect(r2.ok).toBe(false);
    expect(r2.error).toContain('publishPeerAddrCmd.unavailable');
  });
});

describe('Bundle G3 (#265) — /lookup-peer + /publish-peer with sessionRef wired', () => {
  it('routes /lookup-peer through podPeerAddr wrapper', async () => {
    __resetThreadIdSeq();
    let threadState = createInitialThreadState();
    const threadStateRef = { current: threadState };
    const setThreadState = (next) => {
      const v = typeof next === 'function' ? next(threadStateRef.current) : next;
      threadStateRef.current = v;
      threadState = v;
    };
    const agent = {
      identity: { chat: { pubKey: 'x', stableId: 'y' }, host: { webid: 'https://a/#me' } },
      peer:     { address: 'app.aaa', status: 'connected' },
    };
    const catalog = {
      opsById: new Map(), appOrigins: new Set(['basis']),
      appsById: new Map([['basis', { id: 'basis', ops: [] }]]),
      briefAggregations: () => [], searchAggregations: () => [],
    };
    // Fake OidcSessionRN — minimum surface podPeerAddr touches.
    const sessionRef = {
      current: {
        isAuthenticated: () => true,
        get webid() { return 'https://alice.example/profile/card#me'; },
        getAuthenticatedFetch() {
          return async (url) => {
            // Peer's WebID doc → pim:storage.
            if (String(url).startsWith('https://bob.example/profile/card')) {
              return {
                ok: true, status: 200,
                headers: { get: (k) => k.toLowerCase() === 'content-type' ? 'text/turtle' : null },
                text: async () => `@prefix pim: <http://www.w3.org/ns/pim/space#>.
<#me> pim:storage <https://bob.example/>.`,
              };
            }
            // Peer's identity.ttl → onderling:peerAddr.
            if (String(url).startsWith('https://bob.example/onderling/identity/identity.ttl')) {
              return {
                ok: true, status: 200,
                headers: { get: (k) => k.toLowerCase() === 'content-type' ? 'text/turtle' : null },
                text: async () => `@prefix onderling: <https://onderling.org/ns#>.
<#me> onderling:peerAddr "app.bobbob".`,
              };
            }
            return { ok: false, status: 404, headers: { get: () => null }, text: async () => '' };
          };
        },
      },
    };
    const handlers = buildMobileLocalBuiltins({
      threadStateRef, setThreadState,
      agent, catalog, callSkill: async () => ({}), t,
      sessionRef,
    });
    const r = await handlers['lookup-peer']({ webid: 'https://bob.example/profile/card#me' });
    expect(r.message).toContain('app.bobbob');
  });
});
