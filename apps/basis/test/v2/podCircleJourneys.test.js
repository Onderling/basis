/**
 * S4 §2 — the pod-backed circle journeys (J-NP1 … J-NP6), walked headlessly against REAL components.
 *
 * How this was walked (2026-07-30): a real Community Solid Server was running on
 * `http://localhost:3000` and a real pod was provisioned on it (`http://localhost:3000/anna/`, real
 * WebID, real client credentials, root container 401s to an unauthenticated PUT — it is a genuine,
 * access-controlled pod). Two REAL basis agents (`bootRealAgentNode`) were paired over a real
 * `InternalTransport` on a shared bus, and the circle was created + joined through the production op
 * path (`createGroupState.finalSubmit` → `stoop.createGroupV2`, then `buildCircleInviteUri` →
 * `joinCircleFromInvite` → `joinGroupState.finalSubmit` → the real group-redeem peer bridge).
 *
 * The assertions below are network-free so they run in CI, but every one of them was first observed on
 * that live setup. Where a journey FAILS, the test asserts the CURRENT behaviour and the comment says
 * what is wrong — this file walks, it does not fix.
 *
 * Not pinned here because they are not walkable at all (see plans/DRAFT-S4-pod-results.md):
 *   - J-NP4 (last admin leaves → caretaker can still grant pod access): `governanceCaretaker.js` has
 *     NO production call site. `stoop.leaveGroup` does not appoint anyone.
 *   - J-NP5 (no internet ⇒ reads local + says it is not syncing): there is no "not syncing" surface for
 *     a pod-backed circle anywhere in the locale bundle or the renderers.
 */
import { describe, it, expect } from 'vitest';
import 'fake-indexeddb/auto';

import {
  bootRealAgentNode, connectAgentsOverBus, teardown, goOffline, goOnline,
} from '../support/pairRealAgents.js';
import {
  initialState as createGroupInitialState,
  finalSubmit as createGroupFinalSubmit,
} from '../../src/core/wizards/createGroupState.js';
import { initialState, decodeInvite, finalSubmit } from '../../src/core/wizards/joinGroupState.js';
import { buildCircleInviteUri, joinCircleFromInvite } from '../../src/v2/circleInvite.js';
import { loadCircleStoragePod, pushCircleStoragePolicy } from '../../src/v2/circleStoragePolicy.js';
import { createConnectionPoints, recordJoinedCirclePoints } from '../../src/v2/connectionPoints.js';
import { registerCircleAddresses } from '../../src/v2/circleAddressRegistration.js';

/** The pod that was actually running for this walk. Plain http — a local CSS has no TLS. */
const LIVE_POD = 'http://localhost:3000/anna/circles/podcircle';
/** The same pod, hypothetically behind TLS — the only shape the code accepts. */
const TLS_POD = 'https://pod.example.org/anna/circles/podcircle';

/** Create a pod-backed circle through the real create-wizard op path. */
async function createPodCircle(admin, { groupId, groupPodUri }) {
  const callSkill = (app, op, args) => admin.agent.callSkill(app, op, args);
  const state = createGroupInitialState();
  state.groupId = groupId;
  state.name = groupId;
  state.purpose = 'pod-backed circle walk';
  state.storagePolicy = 'centralised';   // = the `shared` pod axis = podBacked
  state.groupPodUri = groupPodUri;
  const { result, state: out } = await createGroupFinalSubmit({ state, callSkill });
  if (!result) throw new Error(`createGroupV2 failed: ${out?.submitError ?? 'unknown'}`);
  return result;
}

/** Build the invite exactly as both shells do: read the storage policy, derive podBacked from it. */
async function inviteAsShellsBuildIt(admin, circleId) {
  const callSkill = (app, op, args) => admin.agent.callSkill(app, op, args);
  const storage = await loadCircleStoragePod({ callSkill, circleId });
  const podBacked = storage?.pod === 'shared' || storage?.pod === 'hybrid';
  const built = await buildCircleInviteUri({
    callSkill, circleId, adminPeerAddr: admin.pubKey,
    podBacked, podUrl: podBacked ? (storage?.groupPodUri ?? null) : null,
  });
  if (built?.error) throw new Error(`buildCircleInviteUri failed: ${built.error}`);
  // …and what the JOINER actually gets: the decoded wire payload, not the object the admin held.
  const decoded = initialState();
  decodeInvite(built.uri, decoded);
  return { storage, built, invite: decoded.invite };
}

// ── J-NP1 — the ordinary join: the pod must land in the joiner's connection points ──────────────────

describe('J-NP1 — the pod as this circle’s connection point', () => {
  it('the whole chain works — but ONLY for an https pod url', async () => {
    const anna = await bootRealAgentNode('anna');
    const bo = await bootRealAgentNode('bo');
    try {
      await connectAgentsOverBus(anna, bo);
      await createPodCircle(anna, { groupId: 'tlscircle', groupPodUri: TLS_POD });

      const { storage, invite } = await inviteAsShellsBuildIt(anna, 'tlscircle');
      expect(storage).toEqual({ pod: 'shared', groupPodUri: TLS_POD });
      // The disclosure AND the place both survive the wire (both were silently dropped by the URI
      // encoder until 2026-07-28 — the object-path tests passed while the real pasted invite did not).
      expect(invite.podBacked).toBe(true);
      expect(invite.podUrl).toBe(TLS_POD);

      // A REAL join over the real peer bridge.
      const joined = await joinCircleFromInvite({
        inviteUri: invite,
      rulesAccepted: true,   // task #80 — these tests simulate a joiner who ticked the rules
        callSkill: (app, op, args) => bo.agent.callSkill(app, op, args),
        sendPeerRedeem: bo.sendPeerRedeem,
        handle: 'bobbie',
      });
      expect(joined).toMatchObject({ ok: true, circleId: 'tlscircle' });

      // Rule 1, on Bo's device: the joined circle's points come from what the invite carried.
      const points = createConnectionPoints({});
      expect(recordJoinedCirclePoints({ store: points, invite, circleId: 'tlscircle' }).recorded)
        .toEqual(['pod']);
      // …and the list shows the POD — not a relay url, not nothing. This is J-NP1's actual claim.
      expect(points.list()).toEqual([expect.objectContaining({
        url: TLS_POD, kind: 'pod', source: 'join', circles: ['tlscircle'],
        adopted: true,
        // A pod has no socket, so it is never "active" — the renderers show a pod line instead of
        // active/standby. Claiming a pod was standby would be the same lie in the other direction.
        active: false,
      })]);
    } finally {
      await teardown(anna, bo);
    }
  }, 60_000);

  it('FIXED — against the real (http) local pod, the point lands and the invite names it', async () => {
    const anna = await bootRealAgentNode('anna-http');
    try {
      await createPodCircle(anna, { groupId: 'podcircle', groupPodUri: LIVE_POD });
      const { storage, invite } = await inviteAsShellsBuildIt(anna, 'podcircle');

      expect(storage).toEqual({ pod: 'shared', groupPodUri: LIVE_POD });

      // Was the defect: `buildCircleInviteUri` gated `podUrl` on /^https:\/\// and dropped it while
      // KEEPING `podBacked: true` — so the joiner was told a pod host could see them and never told
      // which pod. A disclosure you cannot act on reads as informed consent and is not.
      //
      // One rule now (`isPodUrl`): https anywhere, or http on loopback — the line browsers draw for
      // secure contexts, and the one this product already draws a layer down, where a relay point
      // accepts plaintext ws://. And the two fields travel together: no podUrl, no podBacked claim.
      expect(invite.podBacked).toBe(true);
      expect(invite.podUrl).toBe(LIVE_POD);

      // …so rule 1 records the pod, and "if I remove this, what breaks?" is answerable for a circle
      // with no relay to point at — which is what J-NP1 exists to check.
      const points = createConnectionPoints({});
      expect(recordJoinedCirclePoints({ store: points, invite, circleId: 'podcircle' }).recorded)
        .toEqual(['pod']);
      expect(points.list().map((p) => p.url)).toEqual([LIVE_POD]);
    } finally {
      await teardown(anna);
    }
  }, 60_000);

  it('a pod reached in cleartext ACROSS a network is still refused — loopback is the exception', () => {
    // The rule is not "http is fine now". A LAN address crosses a wire someone else can read, and being
    // local to you is not a property the pod's contents care about.
    const invite = { podBacked: true, podUrl: 'http://192.168.2.20:3000/anna/' };
    const points = createConnectionPoints({});
    expect(recordJoinedCirclePoints({ store: points, invite, circleId: 'x' }).recorded).toEqual([]);
  });
});

// ── J-NP2 — the admin is asleep: a NOTICE, not a failure verdict ────────────────────────────────────

describe('J-NP2 — no admin online is a notice, and the invite survives it', () => {
  it('a redeem that reaches nobody is typed admin-unreachable, and the SAME invite works later', async () => {
    const anna = await bootRealAgentNode('anna');
    // A short redeem budget: this journey is about the shape of the failure, not about waiting for it.
    const bo = await bootRealAgentNode('bo', { redeemTimeoutMs: 1500 });
    try {
      await connectAgentsOverBus(anna, bo);
      await createPodCircle(anna, { groupId: 'nachtcircle', groupPodUri: TLS_POD });
      const { invite } = await inviteAsShellsBuildIt(anna, 'nachtcircle');
      const boCallSkill = (app, op, args) => bo.agent.callSkill(app, op, args);

      // 3am: Anna's phone is off.
      await goOffline(anna);
      const asleep = await joinCircleFromInvite({
        inviteUri: invite, callSkill: boCallSkill, sendPeerRedeem: bo.sendPeerRedeem, handle: 'bobbie',
      rulesAccepted: true,   // task #80 — these tests simulate a joiner who ticked the rules
      });
      // The distinction that matters: not "join-failed", not "invalid-or-expired-code".
      expect(asleep).toMatchObject({
        reason: 'admin-unreachable',
        errorKey: 'circle.nearbyScreen.join_no_admin',
      });

      // …and the invitation stays valid: the same code, redeemed once Anna is back.
      await goOnline(anna, { announceTo: bo });
      const awake = await joinCircleFromInvite({
        inviteUri: invite, callSkill: boCallSkill, sendPeerRedeem: bo.sendPeerRedeem, handle: 'bobbie',
      rulesAccepted: true,   // task #80 — these tests simulate a joiner who ticked the rules
      });
      expect(awake).toMatchObject({ ok: true, circleId: 'nachtcircle' });
    } finally {
      await teardown(anna, bo);
    }
  }, 60_000);

  it('DEFECT — the notice exists in the state and NO shell renders it', async () => {
    const anna = await bootRealAgentNode('anna');
    try {
      await createPodCircle(anna, { groupId: 'stillecircle', groupPodUri: TLS_POD });
      const { invite } = await inviteAsShellsBuildIt(anna, 'stillecircle');

      // Drive `joinGroupState.finalSubmit` exactly as both wizards do, with a peer redeem that reaches
      // nobody (the throw an offline admin produces).
      const state = initialState();
      decodeInvite(invite, state);
      state.handle = 'bobbie';
      const { result, state: after } = await finalSubmit({
        state,
        callSkill: async (app, op) => (op === 'setMyHandle'
          ? { ok: true }
          : (op === 'redeemMembershipCode' ? { error: 'invalid-or-expired-code' } : {})),
        sendPeerRedeem: async () => { throw new Error('offline'); },
      });
      expect(result).toBeUndefined();
      expect(after.submitErrorReason).toBe('admin-unreachable');
      expect(after.submitErrorKey).toBe('circle.nearbyScreen.join_no_admin');

      // WRONG, pinned as-is. `submitError` is the ONLY field either join wizard renders
      // (`joinGroupWizard.js` "if (state.submitError)"; `joinGroupWizardModal.js`
      // "<ErrorBanner message={state.submitError} />", which returns null on a falsy message), and the
      // admin-unreachable branch deliberately does not set it. `submitErrorKey` and `handleRejected`
      // have ZERO consumers anywhere in either shell. So on screen this journey is a wizard that
      // re-renders with nothing on it — the failure J-NP2 was written to catch, one layer above where
      // the typed reason was added. The same silence swallows the handle-taken prompt.
      expect(after.submitError).toBeNull();
    } finally {
      await teardown(anna);
    }
  }, 60_000);
});

// ── J-NP3 — the disclosure, before the decision ─────────────────────────────────────────────────────

describe('J-NP3 — the pod-host disclosure reaches the JOINER before they redeem', () => {
  it('podBacked is on the decoded invite before any skill call happens', async () => {
    const anna = await bootRealAgentNode('anna');
    try {
      await createPodCircle(anna, { groupId: 'opencircle', groupPodUri: TLS_POD });
      const { invite } = await inviteAsShellsBuildIt(anna, 'opencircle');

      // The sequence property, stated where it is actually decided: decoding is what the join wizard
      // does on mount, and the wizard's step 1 (Rules) renders the disclosure off `state.invite
      // .podBacked` — three steps before `finalSubmit` runs. So a joiner who reads it and stops has
      // committed nothing. A true statement shown after the decision would not be a disclosure.
      const state = initialState();
      decodeInvite(invite, state);
      expect(state.invite.podBacked).toBe(true);
      expect(state.step).toBe(1);          // …and the joiner is on Rules, where the line renders

      // The commitment is the redeem, and it happens only inside `finalSubmit` — which the wizards
      // reach from step 3. Nothing was asked of the substrate to LEARN the disclosure.
      const calls = [];
      await joinCircleFromInvite({
        inviteUri: invite,
      rulesAccepted: true,   // task #80 — these tests simulate a joiner who ticked the rules
        callSkill: async (app, op) => { calls.push(op); return op === 'setMyHandle' ? { ok: true } : {}; },
        handle: 'bobbie',
      });
      expect(calls).toContain('redeemMembershipCode');
    } finally {
      await teardown(anna);
    }
  }, 60_000);

  it('the connection-point row keeps the same fact visible — the store hands the renderer kind:pod', () => {
    // Both renderers (`web/v2/circleConnectionPoints.js`, `CircleLauncherScreen`) key the
    // point_pod_host_sees line off `point.kind === 'pod'`, so this is the input that decides it.
    const points = createConnectionPoints({});
    points.addPodPoint(TLS_POD, 'opencircle');
    expect(points.list()[0].kind).toBe('pod');
  });
});

// ── J-NP6 — removing the pod point cuts a pod-only circle off ───────────────────────────────────────

describe('J-NP6 — a pod-only circle reads as CUT OFF, not merely inconvenienced', () => {
  it('the impact report names this circle, and does not claim a socket was dropped', () => {
    const points = createConnectionPoints({ activeUrl: 'wss://relay.example:8787' });
    points.addFromJoin('wss://relay.example:8787', 'relaycircle');
    points.addPodPoint(TLS_POD, 'podonly');

    const impact = points.impactOfRemoving(TLS_POD);
    expect(impact.losesReachability).toEqual(['podonly']);   // no relay to fall back to
    expect(impact.stillReachable).toEqual([]);
    // A pod is never the ACTIVE point (no socket), so the "you are dropping your live connection"
    // line must not fire here — that would be a second, untrue alarm on top of a true one.
    expect(impact.wasActive).toBe(false);

    // The other circle is untouched by the removal — the report is per-circle, not per-device.
    expect(points.impactOfRemoving('wss://relay.example:8787')).toMatchObject({
      losesReachability: ['relaycircle'], wasActive: true,
    });
  });

  it('DEFECT — walked against the real http pod there is nothing to remove at all', () => {
    // The J-NP1 defect makes J-NP6 unreachable on the live pod: no point was ever recorded, so the
    // impact report cannot warn about a circle it has never heard of. It answers `known:false` —
    // indistinguishable, from the outside, from a circle that is fine.
    const points = createConnectionPoints({});
    recordJoinedCirclePoints({ store: points, invite: { podBacked: true }, circleId: 'podcircle' });
    expect(points.impactOfRemoving(LIVE_POD)).toMatchObject({ known: false, losesReachability: [] });
  });
});

// ── Two things found while walking ──────────────────────────────────────────────────────────────────

describe('found while walking the pod journeys', () => {
  it('FIXED — the circle-settings pod axis refuses honestly when nothing can write it', async () => {
    const anna = await bootRealAgentNode('anna');
    try {
      const callSkill = (app, op, args) => anna.agent.callSkill(app, op, args);
      const state = createGroupInitialState();
      state.groupId = 'plaincircle'; state.name = 'plaincircle'; state.purpose = 'no pod at create';
      await createGroupFinalSubmit({ state, callSkill });

      const pushed = await pushCircleStoragePolicy({
        callSkill, circleId: 'plaincircle', pod: 'shared', groupPodUri: TLS_POD,
      });

      // Was: `ok: true` with the requested policy echoed back, while `podRouting` — a tasks-* concept
      // basis never wires — meant nothing was written at all. The optional chain swallowed the missing
      // writer and the caller had no way to tell. `?.()` is right for a genuinely optional collaborator
      // and wrong when its absence means the operation did not happen.
      expect(pushed.ok).toBe(false);
      expect(pushed.error).toBe('storage-policy-writer-unavailable');

      // The circle is unchanged either way — but now the caller was TOLD, so a surface can say
      // "this cannot be changed here" instead of showing a toggle that lies.
      expect(await loadCircleStoragePod({ callSkill, circleId: 'plaincircle' }))
        .toEqual({ pod: 'none', groupPodUri: null });
    } finally {
      await teardown(anna);
    }
  }, 60_000);

  it('FIXED — a pod point is not a relay, so a pod-only circle still registers on the default', async () => {
    // `circleMappedAnywhere` did not filter by kind, so recording a circle's POD made the scoping rule
    // believe the circle rode some OTHER relay, and it was skipped even on the default. Nothing took
    // over — a pod is not a transport and no code registers per-circle addresses on one — so J-NP1
    // SUCCEEDING is what stopped a pod-only circle's address from being registered anywhere. The pass
    // and the regression came from the same line.
    const points = createConnectionPoints({});
    points.addPodPoint(TLS_POD, 'podonly');

    const added = [];
    const transport = {
      supportsAliases: true,
      addAddress: async (a) => { added.push(a); return { ok: true }; },
    };
    const circlesForPoint = (url) => points.circlesFor(url);
    circlesForPoint.pointsFor = (cid) => points.pointsFor(cid);   // the reverse view both shells pass

    const out = await registerCircleAddresses({
      transport,
      relayUrl: 'wss://default.example:8787',
      defaultRelayUrl: 'wss://default.example:8787',
      circleIds: ['podonly'],
      circleAddressFor: () => 'addr-podonly',
      circlesForPoint,
    });
    expect(out.skippedOffRelay).toEqual([]);
    expect(added).toEqual(['addr-podonly']);
  });
});
