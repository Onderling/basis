/**
 * basis — contact-skill LIVE wiring tests (feedback-extension wiring).
 *
 * Covers DESIGN §2.2 (acceptance): "a bot contact's commands appear only in
 * that thread; invoking routes to the bot; removing the contact removes them."
 * Drives the real `@onderling/core` PeerGraph (its events are what the registry
 * subscribes to) so the test exercises the actual discover→synth→route→remove
 * loop, not a fake graph.
 *
 * The registry's PeerGraph handler refreshes ASYNCHRONOUSLY (fire-and-forget),
 * so a `flush()` (one macrotask) lets the handler's promise chain settle before
 * asserting event-driven behaviour; logic assertions call `reg.refresh()`
 * directly for determinism.
 */
import { describe, it, expect, vi } from 'vitest';

import { PeerGraph } from '@onderling/core';

import {
  createContactSkillRegistry,
  chainContactCallSkill,
} from '../src/v2/contactSkillsLive.js';
import { mergeManifests } from '../src/manifestMerge.js';

/** Let the registry's async peer-graph handler settle (one macrotask flush). */
const flush = () => new Promise((r) => setTimeout(r, 0));

/** An A2A bot peer record shaped like `discoverA2A` upserts (skills are cards). */
function botPeer(url, skills, extra = {}) {
  return {
    type: 'a2a', url, name: 'Feedback bot', reachable: true,
    skills: skills.map((s) => (typeof s === 'string' ? { id: s, description: '', tags: [] } : s)),
    ...extra,
  };
}

describe('createContactSkillRegistry — discovery → sources', () => {
  it('a discovered bot contributes contact-thread sources; invoking routes to it', async () => {
    const peers = new PeerGraph();
    const sendTask = vi.fn(async (peerUrl, skillId, args) => ({ ok: true, peerUrl, skillId, args }));
    const reg = createContactSkillRegistry({ peerGraph: peers, sendTask });
    await reg.start();

    // Nothing yet.
    expect(reg.contacts()).toEqual([]);
    expect(reg.callSkill('any', 'summarise', {})).toBeUndefined();

    // Discover a bot → the 'added' event drives an automatic refresh.
    await peers.upsert(botPeer('https://bot.example', ['summarise', 'sentiment']));
    await flush();

    const contacts = reg.contacts();
    expect(contacts).toHaveLength(1);
    expect(contacts[0]).toMatchObject({ contactId: 'https://bot.example', skillCount: 2 });

    // Its sources are contact-thread scoped + carry the contactId.
    const src = reg.sourcesFor('https://bot.example');
    expect(src).toHaveLength(1);
    expect(src[0]).toMatchObject({ scope: 'contact-thread', contactId: 'https://bot.example' });

    // Invoking one of its ops routes to the bot via sendTask (peerUrl, skillId, args).
    const res = await reg.callSkill('contact_https___bot_example', 'summarise', { text: 'hi' });
    expect(res).toEqual({ ok: true, peerUrl: 'https://bot.example', skillId: 'summarise', args: { text: 'hi' } });
    expect(sendTask).toHaveBeenCalledWith('https://bot.example', 'summarise', { text: 'hi' });

    reg.dispose();
  });

  it('skillsFor(contactId) returns the bot’s skill cards for in-thread quick actions', async () => {
    const peers = new PeerGraph();
    const reg = createContactSkillRegistry({ peerGraph: peers, sendTask: vi.fn() });
    await reg.start();
    await peers.upsert(botPeer('https://bot.example', [
      { id: 'summarise', description: 'Summarise the thread', tags: ['nlp'] },
      'sentiment',
    ]));
    await reg.refresh();
    const skills = reg.skillsFor('https://bot.example');
    expect(skills).toEqual([
      { id: 'summarise', description: 'Summarise the thread', tags: ['nlp'] },
      { id: 'sentiment', description: '', tags: [] },
    ]);
    expect(reg.skillsFor('https://nope.example')).toEqual([]);   // unknown contact
    reg.dispose();
  });

  it("an op no contact owns falls through (callSkill → undefined)", async () => {
    const peers = new PeerGraph();
    const reg = createContactSkillRegistry({ peerGraph: peers, sendTask: vi.fn() });
    await reg.start();
    await peers.upsert(botPeer('https://bot.example', ['summarise']));
    await reg.refresh();
    expect(reg.callSkill('x', 'not-a-bot-skill', {})).toBeUndefined();
    reg.dispose();
  });
});

describe('createContactSkillRegistry — removal + change events', () => {
  it('removing the contact removes its skills + fires onChange', async () => {
    const peers = new PeerGraph();
    const onChange = vi.fn();
    const reg = createContactSkillRegistry({ peerGraph: peers, sendTask: vi.fn(), onChange });
    await reg.start();

    await peers.upsert(botPeer('https://bot.example', ['summarise']));
    await flush();                                   // 'added' → refresh → onChange
    expect(reg.has('https://bot.example')).toBe(true);
    expect(onChange).toHaveBeenCalled();

    onChange.mockClear();
    await peers.remove('https://bot.example');
    await flush();                                   // 'removed' → refresh → onChange
    expect(reg.has('https://bot.example')).toBe(false);
    expect(reg.callSkill('x', 'summarise', {})).toBeUndefined();
    expect(onChange).toHaveBeenCalled();

    reg.dispose();
  });

  it('a refresh that does not change the skill set does not fire onChange', async () => {
    const peers = new PeerGraph();
    const onChange = vi.fn();
    const reg = createContactSkillRegistry({ peerGraph: peers, sendTask: vi.fn(), onChange });
    await reg.start();
    await peers.upsert(botPeer('https://bot.example', ['summarise']));
    await flush();
    onChange.mockClear();

    // Re-scanning with the same roster keeps the signature stable → no churn.
    await reg.refresh();
    expect(onChange).not.toHaveBeenCalled();

    reg.dispose();
  });
});

describe('createContactSkillRegistry — catalogue merge + isolation', () => {
  it("contact sources merge into a catalogue whose ops carry the remote binding", async () => {
    const peers = new PeerGraph();
    const reg = createContactSkillRegistry({ peerGraph: peers, sendTask: vi.fn() });
    await reg.start();
    await peers.upsert(botPeer('https://bot.example', ['summarise']));
    await reg.refresh();

    const catalogue = mergeManifests(reg.sources(), { runtime: 'browser' });
    const entry = catalogue.opsById.get('summarise');
    expect(entry).toBeTruthy();
    expect(entry.op.binding).toBe('remote-skill@contact');
    expect(entry.op.bindRef).toMatchObject({ contactId: 'https://bot.example', skillId: 'summarise' });

    reg.dispose();
  });

  it('two bots each exposing the same skill id stay isolated by contact app namespace', async () => {
    const peers = new PeerGraph();
    const reg = createContactSkillRegistry({ peerGraph: peers, sendTask: vi.fn() });
    await reg.start();
    await peers.upsert(botPeer('https://a.example', ['summarise']));
    await peers.upsert(botPeer('https://b.example', ['summarise']));
    await reg.refresh();

    expect(reg.contacts()).toHaveLength(2);
    expect(reg.sourcesFor('https://a.example')[0].manifest.app)
      .not.toBe(reg.sourcesFor('https://b.example')[0].manifest.app);

    reg.dispose();
  });
});

describe('chainContactCallSkill', () => {
  it('routes contact ops to the contact router and others to the base', () => {
    const contact = (o, op) => (op === 'summarise' ? `contact:${op}` : undefined);
    const base = (o, op) => `base:${op}`;
    const chained = chainContactCallSkill(contact, base);
    expect(chained('x', 'summarise')).toBe('contact:summarise');
    expect(chained('x', 'markComplete')).toBe('base:markComplete');
  });

  it('tolerates a missing contact router (falls straight through)', () => {
    const chained = chainContactCallSkill(undefined, (o, op) => `base:${op}`);
    expect(chained('x', 'anything')).toBe('base:anything');
  });
});

describe('createContactSkillRegistry — inert without a peer graph', () => {
  it('no peerGraph → no contacts, callSkill falls through, start/dispose are safe', async () => {
    const reg = createContactSkillRegistry({ sendTask: vi.fn() });
    await reg.start();
    expect(reg.contacts()).toEqual([]);
    expect(reg.callSkill('x', 'y', {})).toBeUndefined();
    reg.dispose();
  });

  it('dispose() unsubscribes — later peer-graph events no longer refresh', async () => {
    const peers = new PeerGraph();
    const onChange = vi.fn();
    const reg = createContactSkillRegistry({ peerGraph: peers, sendTask: vi.fn(), onChange });
    await reg.start();
    reg.dispose();
    onChange.mockClear();
    await peers.upsert(botPeer('https://late.example', ['summarise']));
    await flush();
    expect(onChange).not.toHaveBeenCalled();
    expect(reg.has('https://late.example')).toBe(false);
  });
});
