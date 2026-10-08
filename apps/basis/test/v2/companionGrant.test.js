/**
 * A household bot keeps the grant its companion's owner gave it: the tokens the companion delivers over the relay
 * (one per op), taken only from a companion the bot holds as a CONTACT and only when every token is that companion's
 * own (issuer and agent = the sender, its signature) and for THIS bot's key, never a wildcard. Kept per companion; the
 * one for an op is what the bot presents when it calls that op there.
 */
import { describe, it, expect } from 'vitest';
import { AgentIdentity, CapabilityToken } from '@onderling/core';
import { VaultMemory } from '@onderling/vault';
import { COMPANION_GRANT_SUBTYPE, createCompanionGrants } from '../../src/v2/companionGrant.js';
import { GRANT_DELIVERY_SUBTYPE } from '../../../companion-node/src/grants.js';

const ident = () => AgentIdentity.generate(new VaultMemory());
const mint = (issuer, { subject, skill, agentId = issuer.pubKey }) => CapabilityToken.issue(issuer, { subject, agentId, skill }).then((t) => t.toJSON());

async function setup() {
  const companion = await ident();
  const stranger = await ident();
  const bot = await ident();
  const contacts = [{ webid: companion.pubKey, peerAddr: companion.pubKey, serves: 'https://relay.example.org' }, { webid: stranger.pubKey, peerAddr: stranger.pubKey }];
  const callSkill = async (app, op) => (app === 'stoop' && op === 'listContacts' ? { contacts } : null);
  const grants = createCompanionGrants({ vault: new VaultMemory(), self: () => bot.pubKey, callSkill });
  const both = async (issuer = companion, extra = {}) => ({
    subtype: COMPANION_GRANT_SUBTYPE,
    tokens: [await mint(issuer, { subject: bot.pubKey, skill: 'feed.put', ...extra }), await mint(issuer, { subject: bot.pubKey, skill: 'feed.drop', ...extra })],
  });
  return { companion, stranger, bot, contacts, grants, both };
}

describe('the bot keeps its companion\'s grant', () => {
  it('the companion and the bot read the same message', () => {
    expect(COMPANION_GRANT_SUBTYPE).toBe(GRANT_DELIVERY_SUBTYPE);
  });

  it('from the companion it holds as a contact, for its own key: kept, and the token for an op is the one it presents', async () => {
    const { companion, grants, both } = await setup();
    expect(await grants.tokenFor(companion.pubKey, 'feed.put')).toBeNull();
    const msg = await both();
    expect(await grants.accept(companion.pubKey, msg)).toEqual({ ok: true, ops: ['feed.drop', 'feed.put'] });
    expect((await grants.tokenFor(companion.pubKey, 'feed.put'))?.id).toBe(msg.tokens[0].id);
    expect((await grants.tokenFor(companion.pubKey, 'feed.drop'))?.id).toBe(msg.tokens[1].id);
    expect(await grants.tokenFor(companion.pubKey, 'feed.serve'), 'nothing for an op not granted').toBeNull();
    // granted again: the new tokens replace the old
    const again = await both();
    expect((await grants.accept(companion.pubKey, again)).ok).toBe(true);
    expect((await grants.tokenFor(companion.pubKey, 'feed.put'))?.id).toBe(again.tokens[0].id);
    // dropped (the companion refused it): nothing to present
    await grants.dropFor(companion.pubKey);
    expect(await grants.tokenFor(companion.pubKey, 'feed.put')).toBeNull();
    expect(await grants.tokenFor(companion.pubKey, 'feed.drop')).toBeNull();
  });

  it('refused whole: not a companion contact, another issuer, another agent, another subject, a wildcard, a broken signature', async () => {
    const { companion, stranger, bot, grants, both } = await setup();
    const unknown = await ident();
    const cases = [
      ['a contact that is no companion (its card serves nothing)', stranger.pubKey, await both(stranger)],
      ['no contact at all', unknown.pubKey, await both(unknown)],
      ['minted by someone else, sent by the companion', companion.pubKey, await both(stranger)],
      ['for another agent', companion.pubKey, await both(companion, { agentId: stranger.pubKey })],
      ['for another key', companion.pubKey, await both(companion, { subject: stranger.pubKey })],
      ['a wildcard', companion.pubKey, { subtype: COMPANION_GRANT_SUBTYPE, tokens: [await mint(companion, { subject: bot.pubKey, skill: '*' })] }],
      ['a prefix wildcard', companion.pubKey, { subtype: COMPANION_GRANT_SUBTYPE, tokens: [await mint(companion, { subject: bot.pubKey, skill: 'feed.*' })] }],
      ['nothing', companion.pubKey, { subtype: COMPANION_GRANT_SUBTYPE, tokens: [] }],
    ];
    const good = await both();
    cases.push(['one token tampered', companion.pubKey, { ...good, tokens: [good.tokens[0], { ...good.tokens[1], skill: 'feed.serve' }] }]);
    for (const [why, from, msg] of cases) {
      expect((await grants.accept(from, msg)).ok, why).toBe(false);
    }
    expect(await grants.tokenFor(companion.pubKey, 'feed.put'), 'nothing kept').toBeNull();
    expect(await grants.tokenFor(stranger.pubKey, 'feed.put')).toBeNull();
  });
});

describe('the app: who a grant can go to, and what a node offers', () => {
  const BOT = 'B'.repeat(43); const PERSON = 'P'.repeat(43); const NODE = 'N'.repeat(43);
  it('contacts and linked bots, by the address they are reached at; hidden, keyless and the node itself left out', async () => {
    const { companionGrantTargets } = await import('../../src/v2/companionGrant.js');
    expect(companionGrantTargets({
      contacts: [
        { webid: 'telegram:1', displayName: 'Bea' },
        { webid: PERSON, pubKey: PERSON, displayName: 'Ann', hidden: true },
        { webid: 'https://id.example/bot', pubKey: 'X'.repeat(43), peerAddr: BOT, displayName: 'Huishoudbot' },
        { webid: NODE, peerAddr: NODE, serves: 'https://r.example' },
      ],
      linkedBots: [{ bot: BOT, botName: '@thuisbot' }, { bot: 'C'.repeat(43), botName: null }],
      node: NODE,
    })).toEqual([{ key: BOT, label: 'Huishoudbot' }, { key: 'C'.repeat(43), label: 'CCCCCCCC…' }]);
  });
  it('the families worded by the locale; one without words by its own name', async () => {
    const { companionFamilyChoices } = await import('../../src/v2/companionGrant.js');
    const t = (k) => ({ 'circle.companionGrant.family_agenda_files': 'agenda-bestanden plaatsen' }[k] ?? k);
    expect(companionFamilyChoices(['agenda-files', 'pod-files', 3], t)).toEqual([
      { id: 'agenda-files', label: 'agenda-bestanden plaatsen' }, { id: 'pod-files', label: 'pod-files' },
    ]);
  });
});

describe('the picker, read through the waist', () => {
  const BOT = 'B'.repeat(43); const NODE = 'N'.repeat(43);
  const t = (k) => ({ 'circle.companionGrant.family_agenda_files': 'agenda-bestanden plaatsen', 'circle.companionGrant.outcome_not_owned': 'niet van jou', 'circle.companionGrant.failed': 'mislukt', 'circle.companionGrant.done': 'gegeven' }[k] ?? k);
  it('the node\'s choices and the agents; a refusal worded; the grant\'s line', async () => {
    const { loadCompanionGrantPicker, companionGrantText } = await import('../../src/v2/companionGrant.js');
    const asked = [];
    const callSkill = async (app, op, args) => {
      asked.push(`${app}.${op}`);
      if (op === 'companionGrantChoices') return args.node === NODE ? { ok: true, outcome: 'ok', families: ['agenda-files'] } : { ok: false, outcome: 'not-owned' };
      if (op === 'listContacts') return { contacts: [{ webid: BOT, peerAddr: BOT, displayName: 'Huishoudbot' }] };
      return null;
    };
    expect(await loadCompanionGrantPicker({ callSkill, node: NODE, t })).toEqual({
      ok: true, targets: [{ key: BOT, label: 'Huishoudbot' }], choices: [{ id: 'agenda-files', label: 'agenda-bestanden plaatsen' }],
    });
    expect(asked).toEqual(['household.companionGrantChoices', 'stoop.listContacts']);
    expect(await loadCompanionGrantPicker({ callSkill, node: 'X'.repeat(43), t })).toEqual({ ok: false, message: 'niet van jou' });
    expect(companionGrantText({ ok: true }, t)).toBe('gegeven');
    expect(companionGrantText({ ok: false, outcome: 'whatever' }, t)).toBe('mislukt');
    expect(companionGrantText(null, t)).toBe('mislukt');
  });
});
