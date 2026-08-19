/**
 * basis — real Agent integration test.  v0.1.5 / OQ-1.C.
 *
 * Exercises the actual @onderling/core Agent class (NOT the mock) via
 * the InternalTransport bus.  Proves:
 *   - AgentIdentity.generate works
 *   - VaultMemory works
 *   - Agent.register + Agent.invoke roundtrip works
 *   - basis's callSkill interface still surfaces the right
 *     payload shape to the dispatch pipeline
 *
 * Part G (2026-06-17) — the household surface is now backed by the REAL
 * `apps/household` agent (skillRegistry.js skills over an ItemStore), not the
 * chore-vocab inline mock.  These tests assert the REAL household vocab:
 *   - seed items: Milk (shopping), Post a parcel (errand), Vacuum living
 *     room (task)
 *   - markComplete({match}) (keyword/id), not markComplete({choreId})
 *   - reply text "✓ marked complete: <text>" (the real skill's wording)
 *
 * This test runs in the node env (default vitest); the same code also runs
 * in the browser bundle (verified by `vite build` + the dev-server smoke).
 */
import { describe, it, expect, vi } from 'vitest';
import { VaultMemory } from '@onderling/vault';

import { createRealHouseholdAgent } from '../src/web/realAgent.js';

describe('createRealHouseholdAgent — Agent boot + skill dispatch', () => {
  it("listOpen returns the 3 seed household items via real Agent.invoke roundtrip", async () => {
    const a = await createRealHouseholdAgent();
    const r = await a.callSkill('household', 'listOpen', {});
    expect(r.items.length).toBe(3);
    expect(r.items.map((c) => c.label).sort()).toEqual([
      'Milk', 'Post a parcel', 'Vacuum living room',
    ]);
    // Structured list items carry the renderer fields (id/label/type/state).
    expect(r.items.every((it) => it.id && it.label && it.type && it.state === 'open')).toBe(true);
  });

  it("listOpen({type}) filters to one list-type", async () => {
    const a = await createRealHouseholdAgent();
    const r = await a.callSkill('household', 'listOpen', { type: 'shopping' });
    expect(r.items.map((it) => it.label)).toEqual(['Milk']);
  });

  it("markComplete({match}) flips state + listOpen reflects it", async () => {
    const a = await createRealHouseholdAgent();
    const done = await a.callSkill('household', 'markComplete', { match: 'Milk' });
    expect(done).toMatchObject({
      ok: true, message: '✓ marked complete: Milk', text: 'Milk',
    });
    expect(typeof done.itemId).toBe('string');
    expect(done._sync).toBeTruthy();
    const list = await a.callSkill('household', 'listOpen', {});
    expect(list.items.length).toBe(2);
    expect(list.items.find((c) => c.label === 'Milk')).toBeUndefined();
  });

  it("markComplete with no match returns ok:false with the skill's message", async () => {
    const a = await createRealHouseholdAgent();
    const r = await a.callSkill('household', 'markComplete', { match: 'nope-zzz' });
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/Couldn't find an open item/);
  });

  it("markComplete with >1 candidate surfaces the disambiguation list (acts on NONE)", async () => {
    const a = await createRealHouseholdAgent();
    // 'a' appears in "Post a parcel" + "Vacuum living room" → ambiguous.
    const r = await a.callSkill('household', 'markComplete', { match: 'a' });
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/Multiple matches/);
    // …and NOTHING was completed — both candidates are still open.
    const list = await a.callSkill('household', 'listOpen', {});
    expect(list.items.find((c) => c.label === 'Post a parcel')).toBeTruthy();
    expect(list.items.find((c) => c.label === 'Vacuum living room')).toBeTruthy();
  });

  it("markComplete with exactly ONE candidate resolves + acts", async () => {
    const a = await createRealHouseholdAgent();
    // 'Milk' is unique → completes it (single-match resolve, not a disambiguation prompt).
    const r = await a.callSkill('household', 'markComplete', { match: 'Milk' });
    expect(r).toMatchObject({ ok: true, message: '✓ marked complete: Milk', text: 'Milk' });
    const list = await a.callSkill('household', 'listOpen', {});
    expect(list.items.find((c) => c.label === 'Milk')).toBeUndefined();
  });

  it("claim with >1 candidate surfaces the disambiguation list (acts on NONE)", async () => {
    const a = await createRealHouseholdAgent();
    await a.callSkill('household', 'addTask', { text: 'paint the fence' });
    await a.callSkill('household', 'addTask', { text: 'mend the fence' });
    const r = await a.callSkill('household', 'claim', { match: 'fence' });
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/Multiple matches/);
    // neither task was claimed
    const tasks = (await a.callSkill('household', 'listTasks', {})).items;
    expect(tasks.filter((t) => /fence/.test(t.label)).every((t) => !t.claimedBy)).toBe(true);
  });

  it("addItem + addTask + claim round-trip through the real skills", async () => {
    const a = await createRealHouseholdAgent();
    const add = await a.callSkill('household', 'addItem', { type: 'shopping', text: 'Bread' });
    expect(add).toMatchObject({ ok: true, text: 'Bread' });
    expect(add.message).toMatch(/Bread/);

    const task = await a.callSkill('household', 'addTask', { text: 'Fix the leaky tap' });
    expect(task).toMatchObject({ ok: true, text: 'Fix the leaky tap' });

    const claim = await a.callSkill('household', 'claim', { match: 'leaky' });
    expect(claim).toMatchObject({ ok: true, text: 'Fix the leaky tap' });
    expect(claim.message).toMatch(/claimed/);
  });

  it("exposes a transport-NEUTRAL isPeerReachable() (false when no transport connected)", async () => {
    const a = await createRealHouseholdAgent();
    // Regression for the NKN-only gate bug: the fan-out reachability check must
    // reflect ANY peer transport (NKN or relay), not just `peer.status`. With no
    // transport connected it's false; the point is it's a single neutral check.
    expect(typeof a.isPeerReachable).toBe('function');
    expect(a.isPeerReachable()).toBe(false);
  });

  it("meta exposes host + chat agent addresses + transport name", async () => {
    const a = await createRealHouseholdAgent();
    expect(typeof a.meta.hostAddress).toBe('string');
    expect(a.meta.hostAddress.length).toBeGreaterThan(0);
    expect(a.meta.chatAddress).not.toBe(a.meta.hostAddress);   // distinct identities
    expect(a.meta.transport).toBe('internal');
  });

  it('reset() restores the seed household state', async () => {
    const a = await createRealHouseholdAgent();
    // Part G — state()/reset() are now async (ItemStore-backed).
    await a.callSkill('household', 'markComplete', { match: 'Milk' });
    let open = await a.state();
    expect(open.find((c) => c.text === 'Milk')).toBeUndefined();
    await a.reset();
    open = await a.state();
    expect(open.find((c) => c.text === 'Milk')).toBeTruthy();
  });

  it("rejects unknown appOrigin", async () => {
    const a = await createRealHouseholdAgent();
    // Post-slice-2b: 'stoop' is now a wired branch (real
    // NeighbourhoodAgent).  Use a genuinely unrecognised origin to
    // verify the throw still fires for unknown apps.
    await expect(a.callSkill('not-a-real-app', 'listOpen', {})).rejects.toThrow(
      /unknown appOrigin/,
    );
  });

  it("routes the 'calendar' app-origin to the host's calendar_* skills (shared, not shell-only)", async () => {
    // Regression for the gate-parity gap: calendar used to throw "unknown
    // appOrigin" in the shared agent — routing lived only in the web/main.js
    // shell, so the v2 circle launcher + mobile (both use the bare agent)
    // failed every calendar gate verb.  The lift puts calendar→household/
    // calendar_* routing HERE, so ALL surfaces reach calendar.
    const a = await createRealHouseholdAgent();
    // Use a RELATIVE future date — listEvents filters to [now, now+90d), so a
    // hardcoded absolute `when` becomes a time-bomb the moment real time passes
    // it (mirrors journeys-mobile.test.js:332 "regardless of the test clock").
    const add = await a.callSkill('calendar', 'addEvent', {
      title: 'Lunch', when: new Date(Date.now() + 7 * 86_400_000).toISOString(),
    });
    expect(add).toBeTruthy();
    expect(add.ok).not.toBe(false);                  // did NOT throw / fail-route

    const list = await a.callSkill('calendar', 'listEvents', {});
    const items = list?.items ?? [];
    expect(items.some((e) => (e.label ?? e.title ?? '').includes('Lunch'))).toBe(true);
  });

  it('task-less base: getMyTasks on an unknown circle → empty list, not an error', async () => {
    // A circle with no tasks circle yet: bundleResolver can't resolve the circle,
    // so the real list skill answers {error:'circleId required'}.  For a READ-only
    // list op that's not a failure (there's nothing to list) — the adapter
    // normalises it to {items: []} so the circle screen renders "no tasks"
    // instead of an error bubble.
    const a = await createRealHouseholdAgent();
    const r = await a.callSkill('tasks', 'getMyTasks', { circleId: 'ghost-circle-xyz' });
    expect(r).toBeTruthy();
    expect(r.error).toBeUndefined();
    expect(Array.isArray(r.items)).toBe(true);
    expect(r.items).toHaveLength(0);
  });
});

describe('createRealHouseholdAgent — pipeline integration', () => {
  it("works as a drop-in for mockAgent in the basis pipeline", async () => {
    const {
      parseInput, mergeManifests, resolveDispatch, runDispatch,
      renderReply, Thread,
    } = await import('../src/index.js');

    const a = await createRealHouseholdAgent();
    const catalogue = mergeManifests([{ manifest: a.manifest }]);
    const thread  = new Thread();

    // /list shopping  → the real household list op (type-only body).
    thread.addUserMessage('/list shopping');
    const r1 = resolveDispatch(parseInput('/list shopping', catalogue), catalogue);
    const reply1 = await runDispatch(r1, a.callSkill);
    const rendered1 = renderReply(reply1, {
      appOrigin: r1.appOrigin,
      manifestsByOrigin: { household: a.manifest },
    });
    thread.addShellMessage(rendered1, { opId: r1.opId });
    expect(rendered1.kind).toBe('list');
    expect(rendered1.items.map((i) => i.label)).toEqual(['Milk']);

    // /done Milk  → markComplete({match:'Milk'}) via the real skill.
    thread.addUserMessage('/done Milk');
    const r2 = resolveDispatch(parseInput('/done Milk', catalogue), catalogue);
    const reply2 = await runDispatch(r2, a.callSkill);
    const rendered2 = renderReply(reply2);
    thread.addShellMessage(rendered2);
    expect(rendered2.kind).toBe('text');
    expect(rendered2.text).toBe('✓ marked complete: Milk');
  });
});

// ── T5.2d — secure-mesh seams: rendezvous + runtime transport injection ──────
// The unified secure-mesh factory's surface is forwarded through realAgent so a
// shell can opt into direct WebRTC rendezvous and inject a runtime-built
// transport (basis-mobile's mDNS). Rendezvous ENABLEMENT registering on
// the router is proven at the secure-agent layer (createSecureAgent.test); here
// we prove the realAgent WIRING: the passthroughs exist and connectPeerTransport
// plumbs `rendezvous` without breaking the peer connect.
describe('createRealHouseholdAgent — T5.2d secure-mesh seams', () => {
  function makeFakeNkn({ address = 'app.fake.test' } = {}) {
    const instance = {
      addr: address, sends: [],
      handlers: { connect: [], message: [], error: [] },
      on(event, cb) { (this.handlers[event] ??= []).push(cb); },
      async send(to, payload) { this.sends.push({ to, payload }); },
      close() {},
    };
    return {
      Client: function () {
        queueMicrotask(() => { for (const cb of instance.handlers.connect) cb(); });
        return instance;
      },
      _instance: instance,
    };
  }

  it('forwards the secure-mesh seams onto the returned surface', async () => {
    const a = await createRealHouseholdAgent();
    for (const m of [
      'addSecureTransport', 'removeSecureTransport',
      'enableSecureRendezvous', 'upgradeToRendezvous', 'isRendezvousActive',
    ]) {
      expect(typeof a[m]).toBe('function');
    }
  });

  it('connectPeerTransport({rendezvous:true}) connects the peer and enables rendezvous (best-effort)', async () => {
    const a = await createRealHouseholdAgent();
    await a.connectPeerTransport({ nknLib: makeFakeNkn({ address: 'app.fake.rdv' }), rendezvous: true });
    // peer transport is up …
    expect(a.peer?.address).toBeTruthy();
    // … and the rendezvous probe is wired through (no open DataChannel yet → false, but callable).
    expect(a.isRendezvousActive('some.peer')).toBe(false);
  });

  it('connectPeerTransport without rendezvous still connects (no regression)', async () => {
    const a = await createRealHouseholdAgent();
    await a.connectPeerTransport({ nknLib: makeFakeNkn({ address: 'app.fake.plain' }) });
    expect(a.peer?.address).toBeTruthy();
  });

  it('connectPeerTransport requires nknLib OR relayUrl (nothing to connect → throws)', async () => {
    const a = await createRealHouseholdAgent();
    await expect(a.connectPeerTransport({})).rejects.toThrow(/nknLib and\/or relayUrl/);
  });

  it('connectPeerTransport relay-only (no nknLib) pins transportMode to relay — local-first LAN path', async () => {
    const a = await createRealHouseholdAgent();
    // No nknLib: the NKN peer transport must NOT be required. A bad relay URL fails best-effort
    // (no throw), and since relay was the only transport the mode is pinned to 'relay'.
    await a.connectPeerTransport({ relayUrl: 'ws://127.0.0.1:0' });
    expect(a.transportMode).toBe('relay');
  });
});

// ── OBJ-2 (S1a/S1c) — household no-pod cross-device item sync wiring ──────────
// The keystone adapter + household substrate stack + mirror are unit-tested in
// their own suites; here we prove the realAgent INTEGRATION: the roster hooks
// are exposed and an inbound tagged household-item envelope routes through the
// adapter → notify-envelope → mirror → the household store.
describe('createRealHouseholdAgent — OBJ-2 household no-pod sync (S1a/S1c)', () => {
  it('exposes the sync roster hooks + seam', async () => {
    const a = await createRealHouseholdAgent();
    expect(typeof a.addCirclePeer).toBe('function');
    expect(typeof a.removeHouseholdPeer).toBe('function');
    expect(typeof a.householdSync?.handleInbound).toBe('function');
    expect(typeof a.householdSync?.mirror?.publishItem).toBe('function');
    expect(a.householdSync.circleId).toBe('household');
  });

  it('addCirclePeer / removeHouseholdPeer feed the mirror roster + return it', async () => {
    const a = await createRealHouseholdAgent();
    const after = await a.addCirclePeer('peerB');
    expect(after).toContain('peerB');
    expect(a.listHouseholdPeers()).toContain('peerB');
    await a.removeHouseholdPeer('peerB');
    expect(a.listHouseholdPeers()).not.toContain('peerB');
  });

  it('exposes householdSelfAddr — this device\'s shareable household address', async () => {
    const a = await createRealHouseholdAgent();
    expect(typeof a.householdSelfAddr).toBe('string');
    expect(a.householdSelfAddr.length).toBeGreaterThan(0);
    expect(a.householdSync.selfAddr).toBe(a.householdSelfAddr);
  });

  it('manually-paired peers PERSIST across a reload (same vault → re-fed on boot)', async () => {
    const chatVault = new VaultMemory();
    // The owner-root vault persists across the "reload" too — a device that keeps its chat vault but
    // loses its identity root is not a reboot, it is a different person picking up the storage, and
    // the vault-at-rest layer deliberately starts such a vault clean (the fingerprint-bound sentinel).
    const ownerRootVault = new VaultMemory();
    const a = await createRealHouseholdAgent({ chatVault, ownerRootVault });
    await a.addCirclePeer('peerPersisted');
    expect(a.listHouseholdPeers()).toContain('peerPersisted');
    // "reload": a fresh agent on the SAME vaults re-feeds the saved pairing on boot.
    const a2 = await createRealHouseholdAgent({ chatVault, ownerRootVault });
    expect(a2.listHouseholdPeers()).toContain('peerPersisted');
    // remove persists too.
    await a2.removeHouseholdPeer('peerPersisted');
    const a3 = await createRealHouseholdAgent({ chatVault, ownerRootVault });
    expect(a3.listHouseholdPeers()).not.toContain('peerPersisted');
  });

  it('an inbound household-item envelope mirrors into the household store', async () => {
    const a = await createRealHouseholdAgent();
    const consumed = a.householdSync.handleInbound('peerB', {
      __ntfyEnv: {
        kind:      'household-item',
        ref:       'pseudo-pod://peerB/household/circles/household/items/REMOTE1',
        etag:      'e1',
        _v:        1,
        fromActor: 'peerB',
        payload:   { id: 'REMOTE1', type: 'task', text: 'Synced eggs', addedBy: 'webid:bob' },
      },
    });
    expect(consumed).toBe(true);
    await new Promise((r) => setTimeout(r, 15));
    const open = await a.callSkill('household', 'listOpen', {});
    expect(open.items.some((i) => i.label === 'Synced eggs')).toBe(true);
  });

  it('handleInbound leaves non-envelope peer messages for the shell router', async () => {
    const a = await createRealHouseholdAgent();
    expect(a.householdSync.handleInbound('peerB', { someDM: 'hi' })).toBe(false);
  });

  it('S1d — a local addItem via the skills fans out to the roster (publish-on-write)', async () => {
    const a = await createRealHouseholdAgent();
    a.addCirclePeer('peerB');
    const spy = vi.spyOn(a.householdSync.mirror, 'publishItem');
    await a.callSkill('household', 'addItem', { type: 'shopping', text: 'Buy milk' });
    expect(spy).toHaveBeenCalled();
    expect(spy.mock.calls[0][0]?.text).toBe('Buy milk');   // the RAW item, with its id
    expect(spy.mock.calls[0][0]?.id).toBeTruthy();
  });
});

describe('createRealHouseholdAgent — L3 uniform wired path (default; legacy registry retired)', () => {
  it('household ops route to the dissolved CircleItemStore cores by default', async () => {
    const a = await createRealHouseholdAgent();
    await a.callSkill('household', 'addItem', { type: 'shopping', text: 'milk' });
    const open = await a.callSkill('household', 'listOpen', { type: 'shopping' });
    expect(open.items.map((i) => i.label)).toContain('milk');          // adapted render shape {items:[{label}]}
    const t = await a.callSkill('household', 'addTask', { text: 'fix fence' });
    expect(t.ok).toBe(true);                                            // chat-shell action shape {ok,message,text,itemId}
    expect(t.text).toBe('fix fence');
    expect((await a.callSkill('household', 'listTasks', {})).items.map((i) => i.label)).toContain('fix fence');
  });

  it('listOpen without a type returns every OPEN item across list-types (the legacy no-type call)', async () => {
    const a = await createRealHouseholdAgent();
    const open = await a.callSkill('household', 'listOpen', {});
    // seed: Milk (shopping) + Post a parcel (errand) + Vacuum living room (task) — all three.
    expect(open.items.map((i) => i.label).sort()).toEqual(['Milk', 'Post a parcel', 'Vacuum living room']);
  });

  it('a write PUBLISHES to the per-circle peer mirror (no-pod sync, publish side)', async () => {
    const a = await createRealHouseholdAgent();
    const spy = vi.spyOn(a.householdSync.mirror, 'publishItem');   // the circle 'household' mirror
    await a.callSkill('household', 'addItem', { type: 'shopping', text: 'milk' });
    expect(spy).toHaveBeenCalled();                                // the CircleItemStore write fanned out
    expect(spy.mock.calls[0][0]?.text).toBe('milk');              // …with the stored item
  });
});
