/**
 * The identity link on the phone (`/koppel`): the same shared pieces web composes, painted here.
 *
 *   - after `/koppel`, the bot is IN THE CONTACT BOOK: the bot's statement reaches the phone through the shared lane
 *     table its peer router spreads (`buildCircleLanes` → `agent.identityLinks`), which writes the contact row;
 *   - My data has the entry: the link the bot sent, pasted, painted through the shared view (`agent.identityLinks.view`)
 *     — which bot, what linking means, the line and the code, "linked" when the statement lands — every word a shared
 *     `circle.identityLink.*` key in both languages;
 *   - the phone's turns to that bot carry this device's statement (`authFor: agent.linkedTurnAuth`), as web's and the box's.
 *
 * `src/screens/**` has no render coverage (docs/agent-notes-known-gotchas.md): the composition is read as source, the
 * behaviour through the shared code it composes.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { sharedCircleLocale } from '@onderling-app/basis';
import { buildCircleLanes } from '../../basis/src/v2/circleLanes.js';
import { createIdentityLinks } from '../../basis/src/v2/identityLinkView.js';
import { encodeLinkStartLink, IDENTITY_LINK_SUBTYPE } from '../../basis/src/v2/identityLink.js';

const src = (p) => readFileSync(fileURLToPath(new URL(p, import.meta.url)), 'utf8');
const MYDATA = src('../src/screens/v2/CircleMyDataScreen.js');
const BUNDLE = src('../src/core/agentBundle.js');
const CHAT = src('../src/screens/ChatScreen.js');

describe('the identity link on the phone', () => {
  it('after /koppel, the bot is in the contact book — through the lane table the phone\'s router spreads', async () => {
    const rows = new Map();
    const callSkill = async (app, op, args) => {
      if (op === 'listContacts') return { contacts: [...rows.values()] };
      if (op === 'addContact') { rows.set(args.webid, { ...(rows.get(args.webid) ?? {}), ...args }); return { contact: rows.get(args.webid) }; }
      return null;
    };
    const identityLinks = createIdentityLinks({ signOffer: async () => ({ offer: 'onderling-koppel:x', nonce: 'n'.repeat(32), root: 'ROOT' }), selfRoot: () => 'ROOT', callSkill });
    const lanes = buildCircleLanes({ agent: { identityLinks, sendPeerMessage: async () => {} } });
    expect(CHAT).toMatch(/\.\.\.lanes\.handlers|\.\.\.circleLanes\.handlers/);
    const made = await identityLinks.view(encodeLinkStartLink('https://basis.example/app', { botAddress: 'BOT', botName: '@huisbot' })).offer();
    expect(made.ok).toBe(true);
    lanes.handlers[IDENTITY_LINK_SUBTYPE]('BOT', { subtype: IDENTITY_LINK_SUBTYPE, statement: { bot: 'BOT', row: 'telegram:42', root: 'ROOT' } });
    await new Promise((r) => { setTimeout(r, 10); });
    expect(rows.get('BOT')).toMatchObject({ webid: 'BOT', peerAddr: 'BOT', displayName: '@huisbot', linkedRow: 'telegram:42' });
  });

  it('My data has the entry: the pasted link, painted through the shared view', () => {
    expect(MYDATA).toMatch(/agent\.identityLinks\.view\(/);
    expect(MYDATA).toMatch(/agent\?\.identityLinks\?\.onLinked\?\.\(/);
    expect(MYDATA).toMatch(/\.offer\(\)/);
    // no store of the phone's own: what is linked is the contact book
    expect(MYDATA).not.toMatch(/AsyncStorage\.[a-zA-Z]+\(\s*['"`]onderling\.identityLink/);
  });

  it('every word the entry paints is a shared key, in both languages', () => {
    const used = [...new Set([...MYDATA.matchAll(/t\('circle\.identityLink\.([a-z_]+)'/g)].map((m) => m[1]))];
    expect(used.length).toBeGreaterThan(5);
    for (const lang of ['en', 'nl']) {
      for (const k of used) expect(sharedCircleLocale[lang]?.identityLink?.[k], `${lang}.circle.identityLink.${k}`).toBeTruthy();
    }
  });

  it('the phone\'s turns to a linked bot carry this device\'s statement', () => {
    expect(BUNDLE).toMatch(/authFor:\s*agent\.linkedTurnAuth/);
  });
});
