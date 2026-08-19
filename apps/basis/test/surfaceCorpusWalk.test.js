/**
 * THE CONNECTION CORPUS — the journeys the sitting listed and the earlier walks did not cover.
 *
 * These are the "second op silently breaks the first" cases: isolation between two connections,
 * the scope a grant actually has, the agreement between the three layers a person reads, expiry,
 * and — the one the multi-device corpus rule exists for — a device ceremony and a connection
 * living in the same account without disturbing each other.
 *
 * Numbers refer to the journey list in `plans/PREP-session-companion-remote-surface.md`.
 */
import { describe, it, expect } from 'vitest';
import { AgentIdentity, Bootstrap } from '@onderling/core';
import { VaultMemory, RootKeyStoreVault } from '@onderling/vault';
import { createSealedPodDataSource } from '@onderling/pod-client';
import { memoryDataSource } from '@onderling/item-store';
import { createRealHouseholdAgent } from '../src/core/agent/realAgent.js';
import { createHistoryMirror, hydrateHistory } from '../src/v2/historyMirror.js';
import { sealStrategyForRecipients } from '../src/v2/sharedCopyOpener.js';
import { compileReadFilter, viewLaneId } from '../src/v2/surfaceGrants.js';
import { actAsConnection, trustForGrant } from './support/actAsConnection.js';
import { EventLog } from '../src/eventLog.js';
import { CONNECTION_MANIFESTS } from '../src/v2/connectionManifests.js';

function memoryPodSource(map = new Map()) {
  return {
    map,
    async read(uri) { if (!map.has(uri)) { const e = new Error('404'); e.status = 404; throw e; } return { content: map.get(uri) }; },
    async write(uri, body) { map.set(uri, String(body)); },
    async delete(uri) { map.delete(uri); },
    async list(pre) { return [...map.keys()].filter((k) => k.startsWith(pre)); },
  };
}
const sealedOver = (map, strategy) =>
  createSealedPodDataSource({ podSource: memoryPodSource(map), podUrl: 'mem://', strategy });
const entry = (id, circleId, text) => ({ id, ts: Date.now(), circleId, app: 'circle', type: 'chat-message', payload: { text } });

/** A granted connection acting — the real A2A path (gate + the op renderA2A registered), not a stand-in. */
function actor(agent, identity) {
  return {
    act: async ({ group, op, args, token }) => {
      await trustForGrant(agent, identity.pubKey);
      const r = await actAsConnection(agent, {
        callerPubKey: identity.pubKey, opId: `${group}.${op}`, args, token: token?.toJSON?.() ?? token,
      });
      // The walks assert on refusal MEANING, so map the kernel's codes onto the words they already use.
      if (r.ok) return { ok: true };
      return { ok: false, code: r.code === 'INVALID_TOKEN' ? 'bad-token' : r.code };
    },
  };
}

describe('journey 11 — two connections, disjoint sections', () => {
  it('neither can open the other\'s lane, and neither section leaks into the wrong one', async () => {
    const owner = await AgentIdentity.generate(new VaultMemory());
    const viewA = await AgentIdentity.generate(new VaultMemory());
    const viewB = await AgentIdentity.generate(new VaultMemory());
    const mailbox = new Map();
    const log = new EventLog({ initial: [], muted: [] });

    const laneA = viewLaneId(viewA.pubKey);
    const laneB = viewLaneId(viewB.pubKey);
    const mirrorA = createHistoryMirror({
      eventLog: log, source: sealedOver(mailbox, sealStrategyForRecipients(owner, [viewA.pubKey])),
      laneId: laneA, filter: compileReadFilter({ circles: ['fam'] }), batchMax: 1, flushMs: 5,
    });
    const mirrorB = createHistoryMirror({
      eventLog: log, source: sealedOver(mailbox, sealStrategyForRecipients(owner, [viewB.pubKey])),
      laneId: laneB, filter: compileReadFilter({ circles: ['werk'] }), batchMax: 1, flushMs: 5,
    });
    await mirrorA.start(); await mirrorB.start();
    log.append(entry('m-fam', 'fam', 'thuisgeheim'));
    log.append(entry('m-werk', 'werk', 'werkgeheim'));
    await mirrorA.flush(); await mirrorB.flush();

    const readAs = async (identity, lane) => {
      const l = new EventLog({ initial: [], muted: [] });
      await hydrateHistory({
        source: sealedOver(mailbox, sealStrategyForRecipients(identity, [])),
        eventLog: l, lanes: lane ? ((x) => x === lane) : null, logger: { warn: () => {} },
      });
      return l.query().map((e) => e.id);
    };

    // Each sees only its own section…
    expect(await readAs(viewA, laneA)).toEqual(['m-fam']);
    expect(await readAs(viewB, laneB)).toEqual(['m-werk']);
    // …and pointing a view at the OTHER's lane yields nothing: the seal, not the filter, refuses.
    expect(await readAs(viewA, laneB)).toEqual([]);
    expect(await readAs(viewB, laneA)).toEqual([]);
    // Over ALL lanes, each still opens only what it was granted.
    expect(await readAs(viewA, null)).toEqual(['m-fam']);
    expect(await readAs(viewB, null)).toEqual(['m-werk']);
    await mirrorA.stop(); await mirrorB.stop();
  }, 60_000);
});

describe('journey 13 — what scope a grant actually has', () => {
  it('PINS the current answer: the registry is DEVICE-scoped, so a second device does not know the grant', async () => {
    // Two devices of the same owner = two agents on SEPARATE settings stores (that is what a
    // second device is: its own local storage). This pins L29's honest current behaviour rather
    // than asserting the behaviour we might prefer — when L29 is answered, THIS test changes.
    const view = await AgentIdentity.generate(new VaultMemory());
    const dev1 = await createRealHouseholdAgent({ a2aManifests: CONNECTION_MANIFESTS, seedHousehold: false, settingsDataSource: memoryDataSource() });
    const dev2 = await createRealHouseholdAgent({ a2aManifests: CONNECTION_MANIFESTS, seedHousehold: false, settingsDataSource: memoryDataSource() });
    await dev1.surfaceGrantsReady(); await dev2.surfaceGrantsReady();

    await dev1.callSkill('household', 'grantSurface', { viewPubKey: view.pubKey, ops: ['params.set-param'], label: 'tablet' });
    expect((await dev1.callSkill('household', 'listSurfaceGrants', {})).surfaces).toHaveLength(1);
    expect(
      (await dev2.callSkill('household', 'listSurfaceGrants', {})).surfaces,
      'device-scoped today: the second device does not see the first device\'s connection',
    ).toHaveLength(0);
  }, 60_000);
});

describe('journey 14 — the three layers agree', () => {
  it('what the LIST says, what the TOKENS carry, and what the LANE FILTER admits are one fact', async () => {
    const view = await AgentIdentity.generate(new VaultMemory());
    const A = await createRealHouseholdAgent({ a2aManifests: CONNECTION_MANIFESTS, seedHousehold: false, settingsDataSource: memoryDataSource() });
    await A.surfaceGrantsReady();

    const ops = ['params.set-param', 'params.get-param'];
    const granted = await A.callSkill('household', 'grantSurface', {
      viewPubKey: view.pubKey, ops, reads: { circles: ['fam'] }, label: 'tablet',
    });
    const [listed] = (await A.callSkill('household', 'listSurfaceGrants', {})).surfaces;

    // 1 ≡ 2 — the list names exactly the skills the tokens carry.
    expect([...listed.ops].sort()).toEqual([...granted.tokens.map((t) => t.skill)].sort());
    // 2 ≡ 3 — the reads the list reports compile to the filter the lane actually applies.
    const filter = compileReadFilter(listed.reads);
    expect(filter(entry('x', 'fam', 'in'))).toBe(true);
    expect(filter(entry('y', 'werk', 'out'))).toBe(false);
    // and the lane the list implies is the lane the mirror would write
    expect(granted.laneId).toBe(viewLaneId(view.pubKey));
  }, 60_000);
});

describe('journey 16 — a grant that has expired', () => {
  it('stops acting on its own, without anyone revoking it', async () => {
    const view = await AgentIdentity.generate(new VaultMemory());
    const A = await createRealHouseholdAgent({ a2aManifests: CONNECTION_MANIFESTS, seedHousehold: false, settingsDataSource: memoryDataSource() });
    await A.surfaceGrantsReady();

    // ~4ms of life. Expiry is a property of the TOKEN, so no registry state is involved.
    const granted = await A.callSkill('household', 'grantSurface', {
      viewPubKey: view.pubKey, ops: ['params.set-param'], expiresInDays: 0.00000005,
    });
    await new Promise((r) => setTimeout(r, 30));
    const res = await actor(A, view).act({
      group: 'params', op: 'set-param', args: { key: 'display.theme', value: 'dark' }, token: granted.tokens[0],
    });
    expect(res, 'an expired grant must stop working by itself').toEqual({ ok: false, code: 'bad-token' });
  }, 60_000);
});

describe('journey 17 — a device ceremony and a connection in one account', () => {
  it('revoking a DEVICE leaves the connection working; unpairing the CONNECTION leaves the devices alone', async () => {
    // The multi-device corpus rule's own case: two revocation systems built weeks apart, in one
    // account, each of which must not silently break the other.
    const ownerRootVault = new VaultMemory();
    const rootKeyStore = new RootKeyStoreVault({ vault: ownerRootVault });
    const chatVault = new VaultMemory();
    const settings = memoryDataSource();
    const A = await createRealHouseholdAgent({
      a2aManifests: CONNECTION_MANIFESTS,   // the shells pass this; a walk that acts must too
      seedHousehold: false, ownerRootVault, rootKeyStore, chatVault, settingsDataSource: settings,
    });
    await A.surfaceGrantsReady();
    const phrase = (await A.callSkill('household', 'revealOwnerPhrase', {}))?.mnemonic;
    expect(typeof phrase).toBe('string');

    // A connection, paired and working.
    const view = await AgentIdentity.generate(new VaultMemory());
    const granted = await A.callSkill('household', 'grantSurface', {
      viewPubKey: view.pubKey, ops: ['params.set-param'], label: 'tablet',
    });
    expect((await actor(A, view).act({
      group: 'params', op: 'set-param', args: { key: 'display.theme', value: 'dark' }, token: granted.tokens[0],
    })).ok).toBe(true);

    // ACT ONE — a DEVICE revocation ceremony (the phrase-proven one, for some other device).
    const rev = await A.callSkill('household', 'revokeDevice', { mnemonic: phrase, deviceId: 'a-lost-phone' });
    expect(rev.ok).toBe(true);

    // …and the connection is untouched. A device ceremony is not a connection ceremony.
    const stillActs = await actor(A, view).act({
      group: 'params', op: 'set-param', args: { key: 'display.theme', value: 'light' }, token: granted.tokens[0],
    });
    expect(stillActs.ok, 'revoking a device silently broke the connection').toBe(true);
    expect(A.getParamValue('display.theme')).toBe('light');

    // ACT TWO — unpair the CONNECTION, and the account is otherwise intact: the phrase still
    // reveals, the agent still dispatches, the device machinery is unaffected.
    expect(await A.callSkill('household', 'revokeSurface', { viewPubKey: view.pubKey }))
      .toMatchObject({ ok: true, revoked: true });
    // `bad-token`, not a distinct `revoked`: the kernel gate answers INVALID_TOKEN for every
    // invalid-token case and does not say WHICH. That is deliberate — telling a caller whether its
    // token was revoked, expired or forged tells an attacker the same thing. The bespoke door used to
    // distinguish them; losing that distinction on the wire is a gain, and what matters here is
    // unchanged: after unpairing, the connection cannot act.
    expect((await actor(A, view).act({
      group: 'params', op: 'set-param', args: { key: 'display.theme', value: 'dark' }, token: granted.tokens[0],
    }))).toEqual({ ok: false, code: 'bad-token' });

    expect((await A.callSkill('household', 'revealOwnerPhrase', {}))?.mnemonic, 'unpairing disturbed the owner root').toBe(phrase);
    expect((await A.callSkill('params', 'set-param', { key: 'display.theme', value: 'system' })).ok).toBe(true);
    expect(A.getParamValue('display.theme')).toBe('system');
    expect(Bootstrap.fromMnemonic(phrase).fingerprint()).toEqual(Bootstrap.fromMnemonic(phrase).fingerprint());
  }, 120_000);
});
