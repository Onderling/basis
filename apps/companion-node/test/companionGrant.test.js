/**
 * The owner lets another agent (a household bot) put people's agenda files on their companion — by a GRANT, not by
 * being the owner. Over a REAL relay + RelayTransport, the node's real gate.
 *
 * The owner's device signs `grants.mint({to, families})`; the node mints ONE capability token per op of the family
 * (issuer and agent = the node, subject = the bot, no wildcard, a long expiry whose real end is revocation) and hands
 * them to the bot over the relay as a one-way message. `feed.put` / `feed.drop` then take a token for exactly that op:
 * none → refused; another op's → refused; another node's → refused; a revoked one → refused on the next call; and an
 * owner's statement alone no longer puts anything. `grants.mint` itself takes only the owner's statement, and only a
 * family the node knows.
 */
import { describe, it, expect, afterEach } from 'vitest';
import { Agent, AgentIdentity, Parts, Bootstrap, CapabilityToken } from '@onderling/core';
import { VaultMemory } from '@onderling/vault';
import { RelayTransport } from '@onderling/transports';
import { randomKey, sealForLink } from '@onderling/blob-gateway';
import { ownerDevice } from './support/ownerDevice.js';
import { startCompanionNode } from '../src/index.js';
import { GRANT_FAMILIES, GRANT_TOKEN_TTL_MS, GRANT_DELIVERY_SUBTYPE, opsForFamilies } from '../src/grants.js';
import { makeDevBlobBucket } from '../src/mediaEdge.js';

const cleanups = [];
afterEach(async () => { while (cleanups.length) { try { await cleanups.pop()(); } catch { /* best-effort */ } } });

const ICS = 'BEGIN:VCALENDAR\r\nVERSION:2.0\r\nBEGIN:VEVENT\r\nUID:x\r\nSUMMARY:Tandarts Bea\r\nEND:VEVENT\r\nEND:VCALENDAR\r\n';
const until = async (fn, ms = 10_000) => { const end = Date.now() + ms; for (;;) { const v = fn(); if (v) return v; if (Date.now() > end) return null; await new Promise((r) => { setTimeout(r, 50); }); } };

/** An agent on the node's relay that keeps every grant message it receives. */
async function agentOn(relayUrl, nodeAddress, label) {
  const id = await AgentIdentity.generate(new VaultMemory());
  const agent = new Agent({ identity: id, transport: new RelayTransport({ relayUrl, identity: id }), label });
  const grants = [];
  agent.on('message', (m) => { if (m?.payload?.subtype === GRANT_DELIVERY_SUBTYPE) grants.push({ from: m.from, tokens: m.payload.tokens }); });
  await agent.start();
  if (nodeAddress) await agent.hello(nodeAddress);
  cleanups.push(() => agent.stop?.());
  return { agent, key: id.pubKey, grants };
}

async function node(owner, extra = {}) {
  const host = await startCompanionNode({
    identityVault: new VaultMemory(), management: true, claimedOwner: { root: owner.delegation.by },
    feeds: true, feedBucket: makeDevBlobBucket(), ...extra,
  });
  cleanups.push(() => host.stop());
  return host;
}

describe('the grant families', () => {
  it('one family is two ops; an unknown family, a wildcard or nothing is refused whole', () => {
    expect(GRANT_FAMILIES['agenda-files']).toEqual(['feed.put', 'feed.drop']);
    expect(opsForFamilies(['agenda-files'])).toEqual(['feed.drop', 'feed.put']);
    for (const bad of [['*'], ['agenda-files', '*'], ['feed.put'], [], null, 'agenda-files', [3]]) expect(opsForFamilies(bad), JSON.stringify(bad)).toBeNull();
    expect(GRANT_TOKEN_TTL_MS).toBe(365 * 24 * 60 * 60 * 1000);
  });
});

describe('a companion grants its agenda files to a bot', () => {
  const ann = Bootstrap.create().bootstrap;
  const owner = ownerDevice(ann, 'phone');

  it('the owner mints; the bot gets one token per op over the relay and puts with it; no token, the wrong op, or the owner\'s statement alone does not', async () => {
    const host = await node(owner);
    const node$ = host.agent.address;
    const app = await agentOn(host.relayUrl, node$, 'owner-app');
    const bot = await agentOn(host.relayUrl, node$, 'bot');

    const args = { to: bot.key, families: ['agenda-files'] };
    const minted = Parts.data(await app.agent.invoke(node$, 'grants.mint', { ...args, auth: owner.auth(node$, 'grants.mint', args) }));
    expect(minted, JSON.stringify(minted)).toMatchObject({ ok: true, ops: ['feed.drop', 'feed.put'], delivery: 'acked' });
    const got = await until(() => bot.grants[0]);
    expect(got, 'the grant reached the bot').toBeTruthy();
    expect(got.from).toBe(node$);
    const tokens = got.tokens.map((t) => CapabilityToken.fromJSON(t));
    expect(tokens.map((t) => t.skill).sort()).toEqual(['feed.drop', 'feed.put']);
    for (const t of tokens) {
      expect(t.issuer, 'issued by the node').toBe(node$);
      expect(t.agentId, 'for the node').toBe(node$);
      expect(t.subject, 'to the bot').toBe(bot.key);
      expect(t.expiresAt - t.issuedAt).toBe(GRANT_TOKEN_TTL_MS);
      expect(CapabilityToken.verify(t, node$)).toBe(true);
    }
    const putTok = tokens.find((t) => t.skill === 'feed.put');
    const dropTok = tokens.find((t) => t.skill === 'feed.drop');

    const id = randomKey(); const k = randomKey();
    const put = { id, envelope: sealForLink(ICS, k) };
    // no token: refused, nothing kept
    await expect(bot.agent.invoke(node$, 'feed.put', put)).rejects.toThrow(/token/i);
    // the owner's statement alone no longer puts: the owner gate on the feed ops is gone
    await expect(bot.agent.invoke(node$, 'feed.put', { ...put, auth: owner.auth(node$, 'feed.put', put) })).rejects.toThrow(/token/i);
    // a feed.drop token cannot put
    await expect(bot.agent.invoke(node$, 'feed.put', put, { token: dropTok })).rejects.toThrow(/grants skill "feed\.drop"/);
    expect(await host.feeds.open(id, k)).toBeNull();
    // the right token: the file is there
    expect(Parts.data(await bot.agent.invoke(node$, 'feed.put', put, { token: putTok }))).toEqual({ ok: true });
    expect(await host.feeds.open(id, k)).toBe(ICS);
    // a token is the bot's: another agent presenting it is refused (its subject is not the caller)
    await expect(app.agent.invoke(node$, 'feed.drop', { id }, { token: dropTok })).rejects.toThrow(/subject/i);
    expect(Parts.data(await bot.agent.invoke(node$, 'feed.drop', { id }, { token: dropTok }))).toEqual({ ok: true });
    expect(await host.feeds.open(id, k)).toBeNull();
  }, 60_000);

  it('a token another companion minted is refused; a revoked one is refused on the next call; minting again ends the old grant', async () => {
    const host = await node(owner);
    const other = await node(owner);   // the same owner's second companion
    const node$ = host.agent.address;
    const app = await agentOn(host.relayUrl, node$, 'owner-app');
    const bot = await agentOn(host.relayUrl, node$, 'bot');

    // the other companion grants the bot (its own relay; the bot is on it too)
    const botThere = await agentOn(other.relayUrl, other.agent.address, 'bot-elsewhere');
    const appThere = await agentOn(other.relayUrl, other.agent.address, 'owner-app-elsewhere');
    const otherArgs = { to: botThere.key, families: ['agenda-files'] };
    expect(Parts.data(await appThere.agent.invoke(other.agent.address, 'grants.mint', { ...otherArgs, auth: owner.auth(other.agent.address, 'grants.mint', otherArgs) })).ok).toBe(true);
    const foreign = (await until(() => botThere.grants[0])).tokens.find((t) => t.skill === 'feed.put');
    // the same claims, minted by THIS node's neighbour: refused here — not for this node, not issued by it
    const forged = await CapabilityToken.issue(other.identity, { subject: bot.key, agentId: node$, skill: 'feed.put' });
    const put = { id: randomKey(), envelope: sealForLink(ICS, randomKey()) };
    await expect(bot.agent.invoke(node$, 'feed.put', put, { token: foreign })).rejects.toThrow(/token/i);
    await expect(bot.agent.invoke(node$, 'feed.put', put, { token: forged })).rejects.toThrow(/not trusted/i);

    const mint = async () => {
      const n = bot.grants.length;
      const args = { to: bot.key, families: ['agenda-files'] };
      expect(Parts.data(await app.agent.invoke(node$, 'grants.mint', { ...args, auth: owner.auth(node$, 'grants.mint', args) })).ok).toBe(true);
      return (await until(() => bot.grants[n])).tokens.find((t) => t.skill === 'feed.put');
    };
    const first = await mint();
    expect(Parts.data(await bot.agent.invoke(node$, 'feed.put', put, { token: first }))).toEqual({ ok: true });
    await host.revokeToken(first.id);
    await expect(bot.agent.invoke(node$, 'feed.put', put, { token: first }), 'revoked: the next call').rejects.toThrow(/revoked/i);

    const second = await mint();
    const third = await mint();
    await expect(bot.agent.invoke(node$, 'feed.put', put, { token: second }), 'minted again: the old grant ends').rejects.toThrow(/revoked/i);
    expect(Parts.data(await bot.agent.invoke(node$, 'feed.put', put, { token: third }))).toEqual({ ok: true });
  }, 60_000);

  it('grants.mint takes only the owner\'s statement, and only a family the node knows, for an agent\'s key', async () => {
    const host = await node(owner);
    const node$ = host.agent.address;
    const app = await agentOn(host.relayUrl, node$, 'owner-app');
    const bot = await agentOn(host.relayUrl, node$, 'bot');
    const ask = (args, auth) => app.agent.invoke(node$, 'grants.mint', { ...args, ...(auth ? { auth } : {}) }).then(Parts.data);
    const args = { to: bot.key, families: ['agenda-files'] };

    // what the owner's app ticks from: the node's own families
    const fam = (auth) => app.agent.invoke(node$, 'grants.families', auth ? { auth } : {}).then(Parts.data);
    expect(await fam(owner.auth(node$, 'grants.families'))).toEqual({ ok: true, families: Object.keys(GRANT_FAMILIES) });
    expect(await fam(), 'unsigned').toEqual({ ok: false, error: 'forbidden' });
    // …and the node as a contact, which the owner's app hands the bot with the grant: its card, to the owner only
    const card = (auth) => app.agent.invoke(node$, 'node.card', auth ? { auth } : {}).then(Parts.data);
    expect(await card(owner.auth(node$, 'node.card'))).toEqual({ ok: true, card: host.card });
    expect(host.card).toMatch(/^onderling-contact:\/\//);
    expect(await card(), 'unsigned').toEqual({ ok: false, error: 'forbidden' });

    expect(await ask(args), 'unsigned').toEqual({ ok: false, error: 'forbidden' });
    const eve = ownerDevice(Bootstrap.create().bootstrap, 'laptop');
    expect(await ask(args, eve.auth(node$, 'grants.mint', args)), 'another root\'s device').toEqual({ ok: false, error: 'forbidden' });
    // a statement for other arguments does not stand for these
    expect(await ask(args, owner.auth(node$, 'grants.mint', { ...args, families: ['agenda-files', 'x'] }))).toEqual({ ok: false, error: 'forbidden' });
    for (const families of [['*'], ['feed.put'], [], ['agenda-files', 'pod-files']]) {
      const a = { to: bot.key, families };
      expect(await ask(a, owner.auth(node$, 'grants.mint', a)), JSON.stringify(families)).toEqual({ ok: false, error: 'unknown-family' });
    }
    for (const to of ['', 'not-a-key', node$]) {
      const a = { to, families: ['agenda-files'] };
      expect(await ask(a, owner.auth(node$, 'grants.mint', a)), `to ${to}`).toEqual({ ok: false, error: 'bad-target' });
    }
    await new Promise((r) => { setTimeout(r, 300); });
    expect(bot.grants, 'nothing was minted, nothing delivered').toEqual([]);
  }, 60_000);

  it('the owner lists who holds what, and revokes an agent: its next call is refused, every token of it', async () => {
    const host = await node(owner);
    const node$ = host.agent.address;
    const app = await agentOn(host.relayUrl, node$, 'owner-app');
    const bot = await agentOn(host.relayUrl, node$, 'bot');
    const other = await agentOn(host.relayUrl, node$, 'other-bot');
    const signed = (op, args) => app.agent.invoke(node$, op, { ...args, auth: owner.auth(node$, op, args) }).then(Parts.data);

    expect(await signed('grants.list', {})).toEqual({ ok: true, grants: [] });
    for (const a of [bot, other]) expect((await signed('grants.mint', { to: a.key, families: ['agenda-files'] })).ok).toBe(true);
    const tok = (await until(() => bot.grants[0])).tokens;
    const otherTok = (await until(() => other.grants[0])).tokens;
    const list = await signed('grants.list', {});
    expect(list.ok).toBe(true);
    expect(list.grants).toEqual(expect.arrayContaining([
      { to: bot.key, families: ['agenda-files'] }, { to: other.key, families: ['agenda-files'] },
    ]));
    expect(list.grants).toHaveLength(2);

    const putK = randomKey();
    const put = { id: randomKey(), envelope: sealForLink(ICS, putK) };
    expect(Parts.data(await bot.agent.invoke(node$, 'feed.put', put, { token: tok.find((t) => t.skill === 'feed.put') }))).toEqual({ ok: true });

    // only the owner revokes; an unsigned or another root's ask changes nothing
    expect(await app.agent.invoke(node$, 'grants.revoke', { to: bot.key }).then(Parts.data)).toEqual({ ok: false, error: 'forbidden' });
    const eve = ownerDevice(Bootstrap.create().bootstrap, 'laptop');
    expect(await app.agent.invoke(node$, 'grants.revoke', { to: bot.key, auth: eve.auth(node$, 'grants.revoke', { to: bot.key }) }).then(Parts.data)).toEqual({ ok: false, error: 'forbidden' });

    // what the bot put is served — until the revoke: then its links go dark, the same miss as any
    const serveArgs = { id: put.id, k: putK };
    expect(Parts.data(await other.agent.invoke(node$, 'feed.serve', serveArgs))).toEqual({ ok: true, ics: ICS });
    const otherFile = { id: randomKey(), envelope: sealForLink(ICS, putK) };
    expect(Parts.data(await other.agent.invoke(node$, 'feed.put', otherFile, { token: otherTok.find((t) => t.skill === 'feed.put') }))).toEqual({ ok: true });

    expect(await signed('grants.revoke', { to: bot.key })).toEqual({ ok: true, revoked: 2, dropped: 1 });
    expect(Parts.data(await other.agent.invoke(node$, 'feed.serve', serveArgs)), 'the revoked agent\'s link is dark').toEqual({ ok: false });
    expect(Parts.data(await other.agent.invoke(node$, 'feed.serve', { id: otherFile.id, k: putK })), 'another agent\'s file stays').toEqual({ ok: true, ics: ICS });
    for (const t of tok) {
      await expect(bot.agent.invoke(node$, t.skill, t.skill === 'feed.put' ? put : { id: put.id }, { token: t }), `${t.skill} after revoke`).rejects.toThrow(/revoked/i);
    }
    // the other agent keeps its grant; the list no longer names the revoked one
    expect(Parts.data(await other.agent.invoke(node$, 'feed.put', put, { token: otherTok.find((t) => t.skill === 'feed.put') }))).toEqual({ ok: true });
    expect((await signed('grants.list', {})).grants).toEqual([{ to: other.key, families: ['agenda-files'] }]);
    // revoking someone with nothing: nothing to revoke, not an error
    expect(await signed('grants.revoke', { to: bot.key })).toEqual({ ok: true, revoked: 0, dropped: 0 });
    expect(await signed('grants.revoke', { to: 'nope' })).toEqual({ ok: false, error: 'bad-target' });
  }, 60_000);

  it('feeds without the gate do not boot: the put is allowed by a token the gate verifies', async () => {
    await expect(startCompanionNode({ identityVault: new VaultMemory(), management: true, claimedOwner: { root: owner.delegation.by }, feeds: true, gate: false, feedBucket: makeDevBlobBucket() })).rejects.toThrow(/gate/);
  });
});
