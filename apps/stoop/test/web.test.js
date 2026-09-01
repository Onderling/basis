/**
 * Stoop local-UI smoke — the HTTP contract the app actually serves.
 *
 * Boots a real cluster (alice + bob with paint skill), mounts the local UI on a
 * free port via `mountLocalUi({staticDir, a2aTLSLayer: new LocalUiAuth({localActor:
 * ALICE})})`, then verifies:
 *   1. The agent card is reachable at `/.well-known/agent.json`.
 *   2. `POST /tasks/send` calls a skill (`postRequest`) end-to-end and returns the
 *      result shape — exercising LocalUiAuth's tier-1 authentication for the
 *      configured actor.
 *   3. The REST surface behind it: intent filtering, mute/report, handle + profile.
 *   4. Path traversal is blocked and an unknown path 404s.
 *
 * The STATIC half is deliberately gone. The stoop web shell was retired with the
 * stoop dissolution, so `web/` no longer exists, and the assertions that served
 * index.html / mine.html / app.js / style.css / profile.html were retired with it
 * rather than left permanently red. The mount still takes a `staticDir`; it simply
 * has nothing to serve — which is exactly why the traversal and 404 cases below
 * still earn their place.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { AgentIdentity, InternalBus, InternalTransport } from '@onderling/core';
import { VaultMemory } from '@onderling/vault';
import { mountLocalUi, LocalUiAuth } from '@onderling/agent-ui';

import { createNeighbourhoodAgent } from '../src/index.js';

const ALICE   = 'https://id.example/alice';
const BOB     = 'https://id.example/bob';
const WEB_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', 'web');

let bundles, ui, baseUrl;

beforeAll(async () => {
  // Two-agent cluster, alice (requester) + bob (paint responder).
  const bus = new InternalBus();
  const aliceId = await AgentIdentity.generate(new VaultMemory());
  const bobId   = await AgentIdentity.generate(new VaultMemory());

  const alice = await createNeighbourhoodAgent({
    identity:  aliceId,
    transport: new InternalTransport(bus, aliceId.pubKey),
    label:     'H5-alice',
    members:   [{ webid: ALICE, displayName: 'Alice' }, { webid: BOB, displayName: 'Bob' }],
    offeringMatch: {
      group:      'block-42',
      localActor: ALICE,
      peers:      [{ pubKey: bobId.pubKey }],
    },
  });
  const bob = await createNeighbourhoodAgent({
    identity:  bobId,
    transport: new InternalTransport(bus, bobId.pubKey),
    label:     'H5-bob',
    offeringMatch: {
      group:      'block-42',
      localActor: BOB,
      peers:      [{ pubKey: aliceId.pubKey }],
      skills:     ['paint'],
      posture:    { paint: 'always' },
    },
  });
  bundles = { alice, bob };

  alice.agent.addPeer(bobId.pubKey,   bobId.pubKey);
  bob.agent.addPeer(aliceId.pubKey,   aliceId.pubKey);
  await alice.offeringMatch.start();
  await bob.offeringMatch.start();
  bob.offeringMatch.subscribe(async () => {});

  ui = await mountLocalUi(alice.agent, {
    port:        0,
    staticDir:   WEB_DIR,
    a2aTLSLayer: new LocalUiAuth({ localActor: ALICE }),
  });
  baseUrl = ui.url;
});

afterAll(async () => {
  await ui?.stop();
});

describe('H5 V0 web UI smoke', () => {
  it('exposes the agent card at /.well-known/agent.json', async () => {
    const res = await fetch(`${baseUrl}/.well-known/agent.json`);
    expect(res.status).toBe(200);
    const card = await res.json();
    expect(card).toHaveProperty('skills');
  });

  it('blocks path traversal', async () => {
    // Try to escape the staticDir root via ../
    const res = await fetch(`${baseUrl}/../package.json`);
    // Either 403 (caught by traversal hardening) or 404 (Node URL-normalises
    // away from staticDir before reaching us). Both are acceptable.
    expect([403, 404]).toContain(res.status);
  });

  it('returns 404 for unknown paths', async () => {
    const res = await fetch(`${baseUrl}/does-not-exist`);
    expect(res.status).toBe(404);
  });

  it('POST /tasks/send invokes postRequest end-to-end via LocalUiAuth', async () => {
    const body = {
      skillId: 'postRequest',
      message: { parts: [{ type: 'DataPart', data: {
        text:           'Paint my fence',
        requiredSkills: ['paint'],
        timeoutMs:      300,
        expectClaims:   1,           // legacy V0: caller wants to wait for the claim
      } }] },
    };
    const res = await fetch(`${baseUrl}/tasks/send`, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify(body),
    });
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.status).toBe('completed');
    const dp = (json.artifacts?.[0]?.parts ?? []).find(p => p?.type === 'DataPart');
    expect(dp).toBeTruthy();
    expect(dp.data).toHaveProperty('requestId');
    expect(dp.data.claims).toHaveLength(1);
    expect(dp.data.claims[0].actor).toBe(BOB);
  });

  it('listMyRequests filters by the LocalUiAuth-configured actor (ALICE)', async () => {
    // The previous test posted as ALICE — ALICE should see her own item.
    const body = {
      skillId: 'listMyRequests',
      message: { parts: [{ type: 'DataPart', data: {} }] },
    };
    const res = await fetch(`${baseUrl}/tasks/send`, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify(body),
    });
    expect(res.status).toBe(200);
    const json = await res.json();
    const dp = (json.artifacts?.[0]?.parts ?? []).find(p => p?.type === 'DataPart');
    expect(dp.data.items.length).toBeGreaterThanOrEqual(1);
    expect(dp.data.items[0].addedBy).toBe(ALICE);
  });
});

// ── Stoop V1 Phase 5 — kind tabs + moderation skills via REST ─────────────

async function callRest(skillId, data) {
  const res = await fetch(`${baseUrl}/tasks/send`, {
    method:  'POST',
    headers: { 'Content-Type': 'application/json' },
    body:    JSON.stringify({ skillId, message: { parts: [{ type: 'DataPart', data }] } }),
  });
  expect(res.status).toBe(200);
  const json = await res.json();
  expect(json.status).toBe('completed');
  return (json.artifacts?.[0]?.parts ?? []).find(p => p?.type === 'DataPart')?.data ?? {};
}

describe('Stoop V1 web UI — Phase 5 (intent tabs + moderation)', () => {
  it('listOpen({intent: "lend"}) returns only lends', async () => {
    // Phase 52.7.2 cut-over (2026-05-14): API + stored shape both
    // canonical. `lend` intent → type:offer + kind:lend.
    await callRest('postRequest', { text: 'aanhanger', intent: 'lend',  expectClaims: 0, timeoutMs: 1 });
    await callRest('postRequest', { text: 'tax help',  intent: 'offer', expectClaims: 0, timeoutMs: 1 });

    const lends = await callRest('listOpen', { intent: 'lend' });
    expect(lends.items.every(i => i.type === 'offer' && i.kind === 'lend')).toBe(true);
    expect(lends.items.some(i => i.text === 'aanhanger')).toBe(true);

    const offers = await callRest('listOpen', { intent: 'offer' });
    expect(offers.items.every(i => i.type === 'offer' && i.kind === 'give')).toBe(true);
  });

  it('reportPost via REST creates a type:"report" item', async () => {
    const post = await callRest('postRequest', {
      text: 'something problematic',
      intent: 'ask',
      expectClaims: 0,
      timeoutMs: 1,
    });
    const r = await callRest('reportPost', { itemId: post.requestId, reason: 'irrelevant' });
    expect(r.reportId).toBeTruthy();

    const reports = await callRest('listOpen', { intent: 'report' });
    expect(reports.items.some(it => it.id === r.reportId)).toBe(true);
  });
});

describe('Stoop V1 web UI — Phase 6 (profile)', () => {
  it('setMyHandle + getMyProfile via REST', async () => {
    const set = await callRest('setMyHandle', { handle: '@Alice-Test' });
    expect(set.handle).toBe('alice-test');

    const profile = await callRest('getMyProfile', {});
    expect(profile.entry.handle).toBe('alice-test');
    expect(profile.renderForCurrentGroup.render).toBe('@alice-test');
  });

  it('setMyHandle rejects invalid input over REST', async () => {
    const r = await callRest('setMyHandle', { handle: 'an' });
    expect(r.error).toBe('invalid-handle');
    expect(r.reason).toBe('too-short');
  });
});
