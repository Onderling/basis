/**
 * THE GRANTS-LANE WALK — the nine journeys (Anna: phone P, laptop L, new tablet N + the view V),
 * over real agents and a genuine transport seam.
 *
 * Cast, exactly as the journeys name it: P is Anna's FIRST device (root custody — its grants-lane
 * statements sign with the profile key, the binding floor); L and N ENROLL with Anna's phrase (the
 * add-a-device ceremony → delegation custody — their statements sign with per-device delegation
 * keys and carry the root-signed record the ingest verifies). B is a circle member: the circle is
 * what gives Anna's devices each other's PROVEN addresses (L announces its per-circle address; P's
 * own roster row grows into the set; the grants fan targets exactly that set).
 *
 * What is production here: the ceremony + enrolled boot (the real factory on the same vaults) ·
 * the grant/revoke ops → the grants LANE (signed statements on the device log) · the live fan to
 * sibling addresses (hold-forward) · verify-on-ingest with the device-set binding · the catch-up
 * serve · the acting door (`PolicyEngine.checkInbound` with the presented token — the exact A2A
 * gate, via actAsConnection). Hand-offs the harness makes, as the enroll walk before it: a fresh
 * enrolled device learns the circle id/addresses directly (production: the registry or the QR
 * offer), and where a story needs a deterministic merge the lane statements are hand-carried
 * through the SAME receiver the fan uses.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { VaultMemory } from '@onderling/vault';
import { AgentIdentity, CIRCLE_ADDRESS_ANNOUNCE_KIND, signSpine } from '@onderling/core';
import { InternalTransport } from '@onderling/core';
import {
  bootRealAgentNode, connectNodesOverBus, pairCircle, bindCircleAddresses, goOffline, goOnline,
  until, teardown,
} from './support/pairRealAgents.js';
import { ownAnnouncementFor } from '../src/v2/circleAddressAnnounce.js';
import { actAsConnection, trustForGrant } from './support/actAsConnection.js';
import { CONNECTION_MANIFESTS } from '../src/v2/connectionManifests.js';
import { GRANTS_BROADCAST, GRANTS_CATCHUP_SUBTYPES, OWN_DEVICES_SCOPE } from '../src/v2/grantsRail.js';
import { EventLog } from '../src/eventLog.js';

const GROUP = 'grants-lane-circle';
const SEND = { hold: true, firstSendTimeoutMs: 4000, retryDelays: [] };

describe('the grants lane — a connection belongs to the person (J-GL1…J-GL9)', () => {
  let bus; let P; let L; let B; let N;
  let V;                    // the paired view's identity
  let vaultsL;              // L's vaults — the restart story reboots on them
  let logL;                 // L's device log — the restart story re-hydrates from its snapshot
  let addrP; let addrL;

  /** Connect one more node onto the SHARED bus (the N-agent helper mints a new bus per call). */
  async function joinBus(node) {
    const tx = new InternalTransport(bus, node.pubKey);
    await node.agent.sa.addSecureTransport('relay', tx);
    node._busTransport = tx;
  }

  /** Enroll a fresh install with Anna's phrase (the ceremony), then boot it as the enrolled device. */
  async function enrollNewDevice(label, deviceLog) {
    const vaults = { ownerRootVault: new VaultMemory(), chatVault: new VaultMemory() };
    const pre = await bootRealAgentNode(`${label}-pre`, { agentOpts: vaults });
    const phrase = (await P.agent.callSkill('household', 'revealOwnerPhrase', {}))?.mnemonic;
    expect(typeof phrase).toBe('string');
    const enrolled = await pre.agent.callSkill('household', 'enrollDevice', { mnemonic: phrase, label });
    expect(enrolled.ok).toBe(true);
    await teardown(pre);
    const node = await bootRealAgentNode(label, {
      agentOpts: { ...vaults, a2aManifests: CONNECTION_MANIFESTS, deviceLog },
    });
    expect(node.pubKey).toBe(P.pubKey);   // one member, per-device keys underneath
    return { node, vaults };
  }

  /** Announce a device's per-circle address to a peer — the enrolled boot's re-announce, hand-aimed. */
  async function announce(fromNode, toAddr) {
    const mine = ownAnnouncementFor({ agent: fromNode.agent, circleId: GROUP });
    await fromNode.agent.sendPeerMessage(toAddr, {
      type: 'p2p-chat', subtype: CIRCLE_ADDRESS_ANNOUNCE_KIND, circleId: GROUP,
      msgId: `announce-${fromNode.label}-${Date.now()}`, ts: Date.now(), announcements: [mine],
    }, SEND);
  }

  /** V presents a token at a device's door — the REAL A2A gate. */
  async function act(node, token, opId = 'params.set-param', args = { key: 'display.theme', value: 'dark' }) {
    await trustForGrant(node.agent, V.pubKey);
    return actAsConnection(node.agent, { callerPubKey: V.pubKey, opId, args, token: token?.toJSON?.() ?? token });
  }

  /** Hand-carry one device's grants lane through another's PRODUCTION receiver (the fan's gate). */
  async function carryLane(from, to) {
    for (const stmt of from.agent.grantsRail.storedStatements(OWN_DEVICES_SCOPE)) {
      await to.agent.grantsPeerHandler('sibling', { subtype: GRANTS_BROADCAST, event: stmt });
    }
  }

  const listGrants = async (node) => (await node.agent.callSkill('household', 'listSurfaceGrants', {})).surfaces;

  beforeAll(async () => {
    V = await AgentIdentity.generate(new VaultMemory());
    vaultsL = { ownerRootVault: new VaultMemory(), chatVault: new VaultMemory() };
    P = await bootRealAgentNode('P', {
      agentOpts: {
        ownerRootVault: new VaultMemory(), chatVault: new VaultMemory(),
        a2aManifests: CONNECTION_MANIFESTS, deviceLog: new EventLog({ initial: [], muted: [] }),
      },
    });
    B = await bootRealAgentNode('B');
    bus = await connectNodesOverBus([P, B]);
    await pairCircle(P, B, { groupId: GROUP, name: 'Grants walk', handle: 'bea' });

    // The ceremony: L enrolls with Anna's phrase and boots as her second device.
    logL = new EventLog({ initial: [], muted: [] });
    ({ node: L } = await (async () => {
      const vaults = vaultsL;
      const pre = await bootRealAgentNode('L-pre', { agentOpts: vaults });
      const phrase = (await P.agent.callSkill('household', 'revealOwnerPhrase', {}))?.mnemonic;
      const enrolled = await pre.agent.callSkill('household', 'enrollDevice', { mnemonic: phrase, label: 'laptop' });
      expect(enrolled.ok).toBe(true);
      await teardown(pre);
      const node = await bootRealAgentNode('L', { agentOpts: { ...vaults, a2aManifests: CONNECTION_MANIFESTS, deviceLog: logL } });
      expect(node.pubKey).toBe(P.pubKey);
      return { node };
    })());
    await joinBus(L);
    await bindCircleAddresses([L], GROUP);

    addrP = P.agent.circleAddressFor(GROUP);
    addrL = L.agent.circleAddressFor(GROUP);
    expect(addrL).not.toBe(addrP);   // per-DEVICE circle addresses under one member

    // L's re-announce reaches P (and its own row grows on B's side in production the same way);
    // P's OWN roster row becoming the SET is what gives the grants fan its sibling target.
    await announce(L, P.pubKey);
    const row = await until(async () => {
      const res = await P.agent.callSkill('stoop', 'listGroupMembers', { groupId: GROUP });
      const r = (res?.members ?? []).find((m) => m.webid === P.pubKey);
      return (r?.circleAddresses?.includes(addrL)) ? r : null;
    }, { timeout: 15000, step: 50 });
    expect(row, 'P never learned L\'s proven address').toBeTruthy();
  }, 120_000);

  afterAll(async () => {
    await teardown(P, L, B, N);
  });

  let firstTokens;   // the first grant's tokens (V holds these blobs)

  it('J-GL1 — a grant is Anna\'s, not her phone\'s: paired on P, V acts through L\'s door', async () => {
    const grant = await P.agent.callSkill('household', 'grantSurface', {
      viewPubKey: V.pubKey, ops: ['params.set-param'], label: 'hallway screen',
    });
    expect(grant.ok).toBe(true);
    firstTokens = grant.tokens;

    // The lane travelled: L's projection holds the grant (the fan, over the real bus).
    const onL = await until(async () => ((await listGrants(L)).length === 1 ? true : null), { timeout: 10000, step: 50 });
    expect(onL, 'the grant never reached L\'s fold').toBe(true);

    expect((await act(P, firstTokens[0])).ok, 'the grant does not act at its own device').toBe(true);
    expect((await act(L, firstTokens[0])).ok, 'the grant did not act at the OTHER device — the lane exists for this').toBe(true);
  }, 60_000);

  it('J-GL4 — a stranger cannot revoke (or grant): forged statements are ignored at ingest', async () => {
    const stranger = await AgentIdentity.generate(new VaultMemory());
    const forgedRevoke = signSpine(stranger, {
      kind: 'grant-revoke', circleId: OWN_DEVICES_SCOPE, subject: V.pubKey,
      payload: { authorRef: P.pubKey, viewPubKey: V.pubKey, tokenIds: firstTokens.map((t) => t.id) },
    });
    const strangerView = await AgentIdentity.generate(new VaultMemory());
    const forgedGrant = signSpine(stranger, {
      kind: 'grant', circleId: OWN_DEVICES_SCOPE, subject: strangerView.pubKey,
      payload: { authorRef: P.pubKey, viewPubKey: strangerView.pubKey, ops: ['params.set-param'], tokens: [] },
    });
    await L.agent.grantsPeerHandler('stranger', { subtype: GRANTS_BROADCAST, event: forgedRevoke });
    await L.agent.grantsPeerHandler('stranger', { subtype: GRANTS_BROADCAST, event: forgedGrant });

    // V's real grant is untouched; no forged grant admits anyone.
    expect((await act(L, firstTokens[0])).ok, 'a forged revoke took the real grant down').toBe(true);
    const grants = await listGrants(L);
    expect(grants).toHaveLength(1);
    expect(grants[0].viewPubKey).toBe(V.pubKey);
  }, 60_000);

  it('J-GL2 + J-GL7 — a revoke on P refuses V at L\'s door live; a modified V that keeps sending is refused everywhere', async () => {
    const rev = await P.agent.callSkill('household', 'revokeSurface', { viewPubKey: V.pubKey });
    expect(rev).toMatchObject({ ok: true, revoked: true });

    // No reboot, no manual sync: the fan lands, the fold flips, the door refuses — typed.
    const refused = await until(async () => {
      const r = await act(L, firstTokens[0]);
      return r.ok === false && r.code === 'INVALID_TOKEN' ? r : null;
    }, { timeout: 10000, step: 50 });
    expect(refused, 'L\'s door kept admitting after the revoke').toBeTruthy();

    // The gate never depends on the view's cooperation: V "ignores the drop" and keeps
    // sending; every device's door refuses regardless.
    expect((await act(P, firstTokens[0])).code).toBe('INVALID_TOKEN');
    expect((await act(L, firstTokens[0])).code).toBe('INVALID_TOKEN');
  }, 60_000);

  it('J-GL3 — the revoke survives L\'s restart: the set is refolded from the log, not a file', async () => {
    const snapshot = logL.query({});
    await teardown(L);
    logL = new EventLog({ initial: snapshot, muted: [] });
    L = await bootRealAgentNode('L', { agentOpts: { ...vaultsL, a2aManifests: CONNECTION_MANIFESTS, deviceLog: logL } });
    await joinBus(L);
    await bindCircleAddresses([L], GROUP);
    await L.agent.surfaceGrantsReady();   // the door refuses until the lane's first fold lands

    expect((await act(L, firstTokens[0])).code, 'a revoked view acted after the restart').toBe('INVALID_TOKEN');
  }, 60_000);

  let narrowTokens;

  it('J-GL8 — re-granting rotates everywhere: the old tokens die on every device, the new picks bind at L untouched', async () => {
    // The deliberate re-pair after a revoke (the concurrent-fork story's coda shape): a NEW grant made after the
    // revoke stands — revoke-wins is causal, not terminal.
    const broad = await P.agent.callSkill('household', 'grantSurface', {
      viewPubKey: V.pubKey, ops: ['params.set-param', 'params.get-param'], label: 'hallway screen',
    });
    expect(broad.ok).toBe(true);
    await until(async () => {
      const r = await act(L, broad.tokens.find((t) => t.skill === 'params.set-param'));
      return r.ok === true ? r : null;
    }, { timeout: 10000, step: 50 });

    // Anna re-pairs with NARROWER picks on P. The old tokens die on every device.
    const narrow = await P.agent.callSkill('household', 'grantSurface', {
      viewPubKey: V.pubKey, ops: ['params.get-param'], label: 'hallway screen',
    });
    expect(narrow.ok).toBe(true);
    narrowTokens = narrow.tokens;

    const rotated = await until(async () => {
      const old = await act(L, broad.tokens.find((t) => t.skill === 'params.set-param'));
      return old.ok === false && old.code === 'INVALID_TOKEN' ? old : null;
    }, { timeout: 10000, step: 50 });
    expect(rotated, 'the superseded grant\'s token kept acting at L').toBeTruthy();
    expect((await act(L, narrowTokens[0], 'params.get-param', { key: 'display.theme' })).ok,
      'the new picks did not bind at L').toBe(true);
  }, 60_000);

  it('J-GL6 — an offline device catches up before it serves: the revoke applies on reconnect', async () => {
    await goOffline(L);
    const rev = await P.agent.callSkill('household', 'revokeSurface', { viewPubKey: V.pubKey });
    expect(rev).toMatchObject({ ok: true, revoked: true });

    // L returns. The fan to L was HELD (hold-forward); the catch-up pull is the belt to that
    // suspender — drive it explicitly, as the shells do on every reconnect.
    await goOnline(L, { announceTo: P });
    await carryLane(P, L);   // deterministic merge through the production ingest gate
    const refused = await until(async () => {
      const r = await act(L, narrowTokens[0], 'params.get-param', { key: 'display.theme' });
      return r.ok === false && r.code === 'INVALID_TOKEN' ? r : null;
    }, { timeout: 10000, step: 50 });
    expect(refused, 'L served a revoked view after reconnecting').toBeTruthy();
  }, 60_000);

  it('J-GL9 — concurrent grant vs revoke → revoke wins on every device; the re-grant is a deliberate new act', async () => {
    // Establish a standing grant both devices hold.
    const standing = await P.agent.callSkill('household', 'grantSurface', {
      viewPubKey: V.pubKey, ops: ['params.set-param'], label: 'hallway screen',
    });
    await until(async () => ((await act(L, standing.tokens[0])).ok ? true : null), { timeout: 10000, step: 50 });

    // The fork: L goes offline; Anna revokes V on P while (offline-parallel) re-granting V on L.
    await goOffline(L);
    expect(await P.agent.callSkill('household', 'revokeSurface', { viewPubKey: V.pubKey }))
      .toMatchObject({ ok: true, revoked: true });
    const offlineGrant = await L.agent.callSkill('household', 'grantSurface', {
      viewPubKey: V.pubKey, ops: ['params.set-param'], label: 'hallway screen',
    });
    expect(offlineGrant.ok).toBe(true);

    // The merge: both lanes land on both devices, through the production ingest gate.
    await goOnline(L, { announceTo: P });
    await carryLane(P, L);
    await carryLane(L, P);

    // Deny wins: the offline re-grant never causally saw the revoke, so V is REVOKED everywhere —
    // including the token L itself just minted.
    for (const [node, name] of [[P, 'P'], [L, 'L']]) {
      const r = await until(async () => {
        const a = await act(node, offlineGrant.tokens[0]);
        return a.ok === false && a.code === 'INVALID_TOKEN' ? a : null;
      }, { timeout: 10000, step: 50 });
      expect(r, `${name} admitted the concurrent re-grant over the revoke`).toBeTruthy();
      expect((await act(node, standing.tokens[0])).code).toBe('INVALID_TOKEN');
    }

    // The coda: re-admitting V is a deliberate NEW act made after the merge — and it stands.
    const anew = await P.agent.callSkill('household', 'grantSurface', {
      viewPubKey: V.pubKey, ops: ['params.set-param'], label: 'hallway screen',
    });
    expect(anew.ok).toBe(true);
    firstTokens = anew.tokens;
    const admitted = await until(async () => ((await act(L, anew.tokens[0])).ok ? true : null), { timeout: 10000, step: 50 });
    expect(admitted, 'the deliberate post-merge re-grant did not stand').toBe(true);
  }, 60_000);

  it('J-GL5 — a new device inherits the standing truth by catch-up: grants AND revokes, no re-pairing', async () => {
    ({ node: N } = await enrollNewDevice('tablet', new EventLog({ initial: [], muted: [] })));
    await joinBus(N);
    await N.agent.surfaceGrantsReady();
    expect(await listGrants(N)).toHaveLength(0);   // fresh device, empty lane

    // The pull: N asks a sibling for the grants lane (the shells kick this on connect; the fresh
    // device learns the sibling address the way it learns the circle — the registry/QR hand-off).
    await N.agent.sendPeerMessage(addrP, { subtype: GRANTS_CATCHUP_SUBTYPES.request, circleId: OWN_DEVICES_SCOPE }, SEND);

    const inherited = await until(async () => {
      const g = await listGrants(N);
      return g.length === 1 && g[0].viewPubKey === V.pubKey ? g : null;
    }, { timeout: 15000, step: 50 });
    expect(inherited, 'the new device did not inherit the standing grant set').toBeTruthy();

    // V acts at N\'s door iff currently granted — with no re-pairing ceremony…
    expect((await act(N, firstTokens[0])).ok, 'the standing grant did not act at the new device').toBe(true);
    // …and every historical revoke came along: a token from a revoked era stays dead here too.
    expect((await act(N, narrowTokens[0], 'params.get-param', { key: 'display.theme' })).code).toBe('INVALID_TOKEN');
  }, 120_000);
});
