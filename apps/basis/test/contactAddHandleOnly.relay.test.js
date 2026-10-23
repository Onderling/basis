/**
 * ADDED AT "HANDLE ONLY" — does the other side still see your handle? (Frits 2026-10-22: connecting his phone and
 * laptop, he picked "Handle only" in the add sheet, and "not even the handle was shared in the end".)
 *
 * Two real agents on one relay, composed as the shells compose them (the contact channel + the pair roster). Anna
 * shares her card; Bea scans it and adds her through the add sheet's own path (`addContactAs`: the persona, the
 * level), and they exchange a turn each, which forms their pair circle. What does Anna see of Bea — in her book and on
 * the pair circle's roster? "Handle only" is the FLOOR of the reveal presets, the pseudonym, so Bea's handle must reach
 * Anna. "Profile" runs beside it as the control.
 */
import { describe, it, expect, afterAll } from 'vitest';
import { startJourneyRelay } from './support/testRelay.js';
import { bootRealAgentNode, connectNodesOverRelay, until, teardown, readRoster } from './support/pairRealAgents.js';
import { pairCircleIdFor } from '../src/v2/pairRoster.js';
import { addContactAs } from '../src/v2/contactLens.js';
import { EventLog } from '../src/eventLog.js';

const book = async (n) => ((await n.agent.callSkill('pinboard', 'listContacts', {}))?.contacts ?? []);

async function walk(level) {
  const relay = await startJourneyRelay();
  const opts = () => ({ contactChannel: true, pairRoster: true, agentOpts: { deviceLog: new EventLog({ initial: [], muted: [] }) } });
  const [anna, bea] = await Promise.all([bootRealAgentNode(`anna-${level}`, opts()), bootRealAgentNode(`bea-${level}`, opts())]);
  await connectNodesOverRelay([anna, bea], { relayUrl: relay.url });
  await anna.agent.callSkill('pinboard', 'setMyHandle', { handle: 'anna' });
  await bea.agent.callSkill('pinboard', 'setMyHandle', { handle: 'bea' });
  const card = await anna.agent.callSkill('pinboard', 'getContactShareQr', {});
  const added = await addContactAs({
    callSkill: (a, o, x) => bea.agent.callSkill(a, o, x), payload: card.payload, persona: 'default', revealPreset: level,
    pairCircleIdOf: bea.pairRoster?.pairCircleIdFor,
  });
  expect(added?.contact?.webid, `Bea added Anna: ${JSON.stringify(added)}`).toBe(anna.pubKey);
  // a turn each way: Bea introduces herself (her card rides the first turn), Anna answers — the pair circle forms
  await bea.contactThreadChannel.sendTurn({ peerAddr: anna.pubKey, threadId: anna.pubKey, text: `hoi Anna (${level})`, messageId: `b-${level}` }).sent;
  await until(async () => ((await book(anna)).find((c) => c.webid === bea.pubKey) ? true : null), { timeout: 20_000, step: 200 });
  await anna.contactThreadChannel.sendTurn({ peerAddr: bea.pubKey, threadId: bea.pubKey, text: `hoi Bea (${level})`, messageId: `a-${level}` }).sent;
  const pairId = pairCircleIdFor(anna.pubKey, bea.pubKey);
  await until(async () => (((await anna.agent.callSkill('pinboard', 'listMyCircles', {}))?.circles ?? [])
    .map((c) => (typeof c === 'string' ? c : c?.groupId)).includes(pairId) ? true : null), { timeout: 30_000, step: 300 });
  // let the releases land, then read what Anna sees of Bea, in her book and on the pair roster
  await new Promise((r) => setTimeout(r, 3000));
  const row = (await book(anna)).find((c) => c.webid === bea.pubKey) ?? null;
  const roster = await readRoster(anna, pairId);
  const rosterRow = roster.find((m) => m.webid === bea.pubKey || m.circleAddress) ?? null;
  return { relay, anna, bea, row, rosterRow, roster };
}

describe('added at a level — what the other side sees of you', () => {
  const opened = [];
  afterAll(async () => { for (const o of opened) { await teardown(o.anna, o.bea); try { await o.relay.close(); } catch { /* */ } } });

  for (const level of ['handle', 'profile']) {
    it(`at "${level}", Anna sees Bea's handle — in her book and on their pair circle`, async () => {
      const o = await walk(level); opened.push(o);
      console.info('WHAT-ANNA-SEES', level, JSON.stringify({
        book: o.row && { handle: o.row.handle, displayName: o.row.displayName },
        roster: o.roster.map((m) => ({ webid: String(m.webid).slice(0, 8), handle: m.handle, displayName: m.displayName, name: m.name, props: m.personaProperties })),
      }));
      expect(o.row?.handle, 'her book').toBe('bea');
      const bea = o.roster.find((m) => m.webid !== o.anna.pubKey);
      expect(bea?.handle, `their pair circle's roster: ${JSON.stringify(bea)}`).toBe('bea');
    }, 120_000);
  }
});
