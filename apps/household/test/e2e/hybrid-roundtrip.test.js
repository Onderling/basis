/**
 * hybrid-roundtrip.test.js — Phase 2 e2e.
 *
 * Wires the parallel-stream pieces together via the orchestrator +
 * HybridPodStore, and proves the agent works against the hybrid
 * pod layer the same way it works against the InMemoryStore from
 * Phase 1.
 *
 * Migration test: this is the same agent, the same skills, the same
 * regex parser — only the `store` arg has changed.  If Phase 1's
 * commands behave identically here, the Store interface has held.
 */
import { describe, it, expect, beforeEach } from 'vitest';

import { HouseholdAgent }         from '../../src/HouseholdAgent.js';
import { MockBridge }             from '../../src/bridges/MockBridge.js';
import { HouseholdPod }           from '../../src/pods/HouseholdPod.js';
import { MemberPod }              from '../../src/pods/MemberPod.js';
import { HybridPodOrchestrator }  from '../../src/pods/HybridPodOrchestrator.js';
import { HybridPodStore }         from '../../src/pods/HybridPodStore.js';

const ALICE = 'https://id.example.org/alice#me';
const BOB   = 'https://id.example.org/bob#me';

/**
 * Tiny in-memory PodClient mock — enough surface for HouseholdPod +
 * MemberPod to operate against.  Mirrors the conventions the streams
 * landed: read returns { content, contentType, ... }; write accepts
 * objects (auto-stringified); list returns { container, entries: [{ uri }] };
 * delete removes; not-found errors carry `code: 'NOT_FOUND'`.
 */
class FakePodClient {
  #files = new Map();   // uri → string content

  async read(uri, opts = {}) {
    const content = this.#files.get(uri);
    if (content === undefined) {
      const err = new Error(`NOT_FOUND: ${uri}`);
      err.code = 'NOT_FOUND';
      throw err;
    }
    if (opts.decode === 'json') {
      return { content: JSON.parse(content), contentType: 'application/json' };
    }
    return { content, contentType: 'text/plain' };
  }

  async write(uri, content) {
    this.#files.set(uri, typeof content === 'string' ? content : JSON.stringify(content));
  }

  async list(container) {
    const entries = [];
    for (const uri of this.#files.keys()) {
      if (uri.startsWith(container) && uri !== container) {
        entries.push({ uri });
      }
    }
    return { container, entries };
  }

  async delete(uri) {
    if (!this.#files.has(uri)) {
      const err = new Error(`NOT_FOUND: ${uri}`);
      err.code = 'NOT_FOUND';
      throw err;
    }
    this.#files.delete(uri);
  }
}

function makeMsg(text, { sender = 'alice', webid = ALICE } = {}) {
  return {
    bridgeId: 'mock',
    chatId:   'chat-1',
    messageId: `msg-${Math.random().toString(36).slice(2, 8)}`,
    sender:   { displayName: sender, bridgeUid: sender, webid },
    text,
    replyTo:  null,
    isAddressed: true,
  };
}

describe('Phase 2 e2e — HouseholdAgent over HybridPodStore', () => {
  /** @type {FakePodClient} */ let householdPodClient;
  /** @type {Map<string, FakePodClient>} */ let memberPodClients;
  /** @type {HouseholdPod} */ let householdPod;
  /** @type {HybridPodOrchestrator} */ let orchestrator;
  /** @type {HybridPodStore} */ let store;
  /** @type {MockBridge} */ let bridge;
  /** @type {HouseholdAgent} */ let agent;

  beforeEach(async () => {
    householdPodClient = new FakePodClient();
    memberPodClients   = new Map();
    householdPod       = new HouseholdPod({
      podClient: householdPodClient,
      podRoot:   'https://pod.example/household/',
    });

    /** @type {(webid: string) => Promise<MemberPod|null>} */
    const memberPodFor = async (webid) => {
      if (!memberPodClients.has(webid)) memberPodClients.set(webid, new FakePodClient());
      const client = memberPodClients.get(webid);
      // Convention: each member's pod root is derived from their webid for the test.
      const podRoot = webid.replace(/#me$/, '/').replace(/^https:\/\/id\./, 'https://pod.');
      return new MemberPod({ podClient: client, podRoot, memberWebid: webid });
    };

    orchestrator = new HybridPodOrchestrator({ householdPod, memberPodFor });
    store        = new HybridPodStore({ orchestrator });
    bridge       = new MockBridge();
    agent        = new HouseholdAgent({ store, bridges: [bridge] });
    await agent.start();
  });

  it('add → list → done round-trip on shopping (household pod)', async () => {
    const r1 = await bridge.emit(makeMsg('add shopping bread'));
    expect(r1.replies[0].text).toMatch(/added.*bread/i);

    const r2 = await bridge.emit(makeMsg('list shopping'));
    expect(r2.replies[0].text).toMatch(/bread/);

    const r3 = await bridge.emit(makeMsg('done bread'));
    expect(r3.replies[0].text).toMatch(/bread/i);

    const r4 = await bridge.emit(makeMsg('list shopping'));
    expect(r4.replies[0].text).toMatch(/nothing open|empty/i);
  });

  it('multi-item add lands all three on the household pod', async () => {
    await bridge.emit(makeMsg('add shopping bread, milk, eggs'));
    const open = await store.listOpen({ type: 'shopping' });
    expect(open.map((i) => i.text).sort()).toEqual(['bread', 'eggs', 'milk']);
  });

  it('Dutch verbs work the same against the hybrid store', async () => {
    await bridge.emit(makeMsg('voeg toe boodschappen melk'));
    const list = await bridge.emit(makeMsg('lijst boodschappen'));
    expect(list.replies[0].text).toMatch(/melk/);

    await bridge.emit(makeMsg('klaar melk'));
    const open = await store.listOpen({ type: 'shopping' });
    expect(open.map((i) => i.text)).not.toContain('melk');
  });

  it('items added via the store land on the right pod (routing table holds end-to-end)', async () => {
    // Skills don't set an assignee, so all routes land on household.
    await bridge.emit(makeMsg('add errand fix the bike'));
    const open = await store.listOpen();
    expect(open).toHaveLength(1);
    expect(open[0].assignee).toBeUndefined();
    // Check that the household pod actually has a `/household/errands/open/...` entry.
    const householdEntries = await householdPodClient.list('https://pod.example/household/errands/open/');
    expect(householdEntries.entries).toHaveLength(1);
  });

  it('a directly-orchestrator-added member-pod item shows up in cross-pod listings', async () => {
    // Bypass the agent — exercise the orchestrator directly so we can
    // hit the member-pod path (skills don't yet plumb an assignee).
    const item = {
      id:          'TEST123ITEM',
      type:        'errand',
      text:        'pick up dry cleaning',
      addedBy:     ALICE,
      addedAt:     1_000_000,
      assignee:    ALICE,
      source:      { tg: { chatId: 'chat-1', messageId: 'msg-x' } },
    };
    await orchestrator.addItem(item);

    // Listing through the orchestrator reaches the member pod via the ref.
    const all = await orchestrator.listOpen();
    expect(all.find((i) => i.id === 'TEST123ITEM')).toBeTruthy();
  });

  it('agent error handling holds against the hybrid store too', async () => {
    const reply = await bridge.emit(makeMsg('done nonexistent-item'));
    expect(reply.replies[0].text).toMatch(/couldn['’]?t find|unknown|no.*match/i);
    const after = await bridge.emit(makeMsg('add shopping still-works'));
    expect(after.replies[0].text).toMatch(/added/i);
  });

  it('start / stop are idempotent against the hybrid stack', async () => {
    await agent.start();
    await agent.stop();
    await agent.stop();
  });
});
