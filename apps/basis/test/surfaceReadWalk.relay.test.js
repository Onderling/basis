/**
 * THE PAIR-A-VIEW WALK OVER A REAL RELAY — the READING half.
 *
 * What actually crosses a wire when a view reads is NOT the content: the edition lane is storage
 * (a pod), and the view fetches it there. What crosses the network is the NUDGE — "your edition
 * has a new batch, come read" — and that is the piece the in-process walk could only simulate.
 * So this journey puts a real relay in the middle of exactly that: the mirror flushes on the
 * acting device, the nudge travels the relay, the view's router hands it to the client, and the
 * client re-pulls its sealed lane and sees the new entry.
 *
 * It also holds the two promises honest across the real path:
 *   • the nudge is CONTENTLESS — the payload that crossed carries a lane id and nothing else;
 *   • the section filter still binds — an entry from a circle the view was not granted never
 *     enters its lane, so no nudge can reveal it.
 *
 * ONE HONEST SEAM, named rather than hidden: the nudge is addressed here through the test's
 * `surfaceNudge` hook, to the address of the node HOSTING the view. In production `realAgent`
 * defaults to sending to the view's own pubkey, which assumes a view is directly addressable —
 * true for a view that connects to a relay under its own key, not true for one hosted behind
 * something else. That assumption is exactly what L27/L29 are about, so the walk does not
 * pretend to settle it.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { AgentIdentity } from '@onderling/core';
import { VaultMemory } from '@onderling/vault';
import { startRelay } from '@onderling/relay';
import { createSealedPodDataSource } from '@onderling/pod-client';
import { memoryDataSource } from '@onderling/item-store';
import { bootRealAgentNode, connectNodesOverRelay, teardown, until } from './support/pairRealAgents.js';
import { createHistoryPodMedium, hydrateHistory } from '../src/v2/historyMirror.js';
import { sealStrategyForRecipients } from '../src/v2/sharedCopyOpener.js';
import { makeSurfaceActClient, SURFACE_NUDGE_SUBTYPE } from '../src/v2/surfaceRail.js';
import { EventLog } from '../src/eventLog.js';

const SEND = { hold: true, firstSendTimeoutMs: 4000 };

/** A SolidPodSource-shaped memory backend — the "mailbox" both ends address. */
function memoryPodSource(map = new Map()) {
  return {
    map,
    async read(uri) { if (!map.has(uri)) { const e = new Error('404'); e.status = 404; throw e; } return { content: map.get(uri) }; },
    async write(uri, body) { map.set(uri, String(body)); },
    async delete(uri) { map.delete(uri); },
    async list(pre) { return [...map.keys()].filter((k) => k.startsWith(pre)); },
  };
}

const famEntry  = (id, text) => ({ id, ts: Date.now(), circleId: 'fam',  app: 'circle', type: 'chat-message', payload: { text } });
const werkEntry = (id, text) => ({ id, ts: Date.now(), circleId: 'werk', app: 'circle', type: 'chat-message', payload: { text } });

describe('the reading half over a REAL relay — the nudge crosses, the view re-pulls', () => {
  let relay; let relayUrl; let A; let VIEWHOST; let view; let client;
  let podMap; let log; let lane; let repulled; const crossed = [];

  beforeAll(async () => {
    relay = await startRelay({ port: 0, log: false });
    relayUrl = `ws://127.0.0.1:${relay.port}`;

    podMap = new Map();
    log = new EventLog({ initial: [], muted: [] });
    view = await AgentIdentity.generate(new VaultMemory());   // the view: a keypair

    // VIEWHOST is booted first so its address exists when A's nudge hook is built.
    VIEWHOST = await bootRealAgentNode('viewhost');
    A = await bootRealAgentNode('A', {
      agentOpts: {
        settingsDataSource: memoryDataSource(),
        deviceLog: log,
        provisionHistoryMirror: async (strategy) => createHistoryPodMedium({ podSource: memoryPodSource(podMap), strategy }),
        // The nudge goes over the REAL relay to the node hosting the view (see the header note).
        surfaceNudge: (viewPubKey, laneId) =>
          A.agent.sendPeerMessage(VIEWHOST.pubKey, { subtype: SURFACE_NUDGE_SUBTYPE, laneId }, SEND),
      },
    });
    await connectNodesOverRelay([A, VIEWHOST], { relayUrl });
    await A.agent.surfaceGrantsReady();

    // The view's client + its re-pull reaction: hydrate its own lane from the mailbox.
    client = makeSurfaceActClient({ identity: view, send: () => {} });
    client.onNudge(async ({ laneId }) => {
      const relog = new EventLog({ initial: [], muted: [] });
      const source = createSealedPodDataSource({
        podSource: memoryPodSource(podMap), podUrl: 'mem://', strategy: sealStrategyForRecipients(view, []),
      });
      await hydrateHistory({ source, eventLog: relog, lanes: (l) => l === laneId, logger: { warn: () => {} } });
      repulled = relog.query().map((e) => e.id);
    });

    // VIEWHOST's shell wiring: the nudge subtype reaches the client. We keep what crossed so the
    // contentless promise can be checked against the actual wire payload, not our intent.
    const prev = VIEWHOST._routerRef.fn;
    VIEWHOST._routerRef.fn = (env) => {
      if (env?.payload?.subtype === SURFACE_NUDGE_SUBTYPE) {
        crossed.push(env.payload);
        return client.handleNudge(env.payload);
      }
      return prev?.(env);
    };

    const grant = await A.agent.callSkill('household', 'grantSurface', {
      viewPubKey: view.pubKey, ops: ['params.set-param'], reads: { circles: ['fam'] }, label: 'relay-editie',
    });
    expect(grant.ok).toBe(true);
    lane = grant.laneId;

    await A.agent.callSkill('params', 'set-param', { key: 'history.mirror', value: true });
    await until(() => [...podMap.keys()].some((k) => k.includes(`/${lane}/`) && k.includes('batch-')), { timeout: 15_000 });
  }, 180_000);

  afterAll(async () => {
    await A?.agent?.callSkill('params', 'set-param', { key: 'history.mirror', value: false }).catch(() => {});
    await teardown(A, VIEWHOST);
    await relay?.stop?.();
  });

  it('a new entry flushes, the nudge crosses the relay, and the view re-pulls it', async () => {
    repulled = null;
    const before = crossed.length;
    log.append(famEntry('relay-fam', 'geheim over de lijn'));

    await until(() => crossed.length > before, { timeout: 15_000 });
    await until(() => repulled !== null, { timeout: 15_000 });
    expect(repulled).toContain('relay-fam');
  }, 60_000);

  it('what crossed the wire carries a lane id and nothing else', () => {
    expect(crossed.length).toBeGreaterThan(0);
    for (const p of crossed) {
      expect(Object.keys(p).sort()).toEqual(['laneId', 'subtype']);
      expect(p.laneId).toBe(lane);
    }
    // and no plaintext ever reached the mailbox either
    expect([...podMap.values()].join('\n')).not.toContain('geheim');
  });

  it('an ungranted circle never enters the lane, so no nudge can carry it', async () => {
    repulled = null;
    const before = crossed.length;
    log.append(werkEntry('relay-werk', 'ander geheim'));
    log.append(famEntry('relay-fam-2', 'nog een'));

    await until(() => crossed.length > before, { timeout: 15_000 });
    await until(() => repulled !== null, { timeout: 15_000 });
    expect(repulled).toContain('relay-fam-2');
    expect(repulled).not.toContain('relay-werk');
  }, 60_000);
});
