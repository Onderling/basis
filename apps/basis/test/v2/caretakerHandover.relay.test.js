/**
 * HANDING A CIRCLE OVER, AND THE LAST ADMIN WALKING OUT: hard assertions over a real relay (the browser walk's story
 * 5 only logged what it saw and could never go red).
 *
 * Three devices, the real factory: the founder makes bram admin and steps back; every device must then fold bram
 * as the one admin. Then bram, the last admin, leaves; the fold hands the circle to an automatic CARETAKER, computed
 * from the log on every device, so the founder and cato must name the SAME caretaker, a member still in the circle,
 * marked as a caretaker. This is the check the governance work stands on (the caretaker hashes per-circle addresses,
 * which the one-address-per-persona work changed), run before that work is built.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { startJourneyRelay } from '../support/testRelay.js';
import { bootRealAgentNode, connectNodesOverRelay, createCircle, joinExistingCircle, bindCircleAddresses, readRoster, until, teardown } from '../support/pairRealAgents.js';
import { bindCircleAddressKeysFor } from '../../src/v2/householdRosterPairing.js';
import { primeCircleSecurity } from '../../src/v2/circleSecurityPriming.js';
import { EventLog } from '../../src/eventLog.js';

const CIRCLE = 'circle-caretaker-handover';
const settle = (ms = 1500) => new Promise((r) => setTimeout(r, ms));
const settleMember = async (node, circleId) => { await bindCircleAddresses([node], circleId); await bindCircleAddressKeysFor({ agent: node.agent, circleId }); };
const admins = (roster) => roster.filter((m) => m?.role === 'admin').map((m) => m.webid).sort();
const view = (roster) => roster.map((m) => `${m.webid}=${m.role}${m.adminVia ? `/${m.adminVia}` : ''}`).sort();

describe('handing a circle over, and the last admin walking out', () => {
  let relay; let founder; let bram; let cato;

  beforeAll(async () => {
    relay = await startJourneyRelay();
    const opts = () => ({ agentOpts: { allowAddressFallback: false, deviceLog: new EventLog({ initial: [], muted: [] }) } });
    [founder, bram, cato] = await Promise.all(['founder', 'bram', 'cato'].map((n) => bootRealAgentNode(n, opts())));
    await connectNodesOverRelay([founder, bram, cato], { relayUrl: relay.url });
    await createCircle(founder, { groupId: CIRCLE, name: 'Overdracht' });
    await settleMember(founder, CIRCLE);
    for (const [who, handle] of [[bram, 'bram'], [cato, 'cato']]) {
      expect((await joinExistingCircle(founder, who, { groupId: CIRCLE, handle })).joined.ok).toBe(true);
      await settleMember(who, CIRCLE);
    }
    await Promise.all([founder, bram, cato].map((n) => primeCircleSecurity({ agent: n.agent, onWarn: () => {} })));
    await settle(1500);
    for (const n of [founder, bram, cato]) await bindCircleAddressKeysFor({ agent: n.agent, circleId: CIRCLE });
  }, 240_000);

  afterAll(async () => {
    try { await teardown(founder, bram, cato); } catch { /* */ }
    try { await relay?.stop?.(); } catch { /* */ }
  });

  it('the founder makes bram admin and steps back: every device folds bram as the one admin', async () => {
    const promoted = await founder.agent.callSkill('pinboard', 'setMemberRole', { groupId: CIRCLE, memberWebid: bram.pubKey, role: 'admin' });
    expect(promoted?.error, JSON.stringify(promoted)).toBeFalsy();
    for (const who of [founder, bram, cato]) {
      expect(await until(async () => (admins(await readRoster(who, CIRCLE)).includes(bram.pubKey) ? true : null), { timeout: 20_000, step: 300 }), `${who.label} sees bram promoted`).toBe(true);
    }
    const stepped = await founder.agent.callSkill('pinboard', 'setMemberRole', { groupId: CIRCLE, memberWebid: founder.pubKey, role: 'member' });
    expect(stepped?.error, JSON.stringify(stepped)).toBeFalsy();
    for (const who of [founder, bram, cato]) {
      const ok = await until(async () => (JSON.stringify(admins(await readRoster(who, CIRCLE))) === JSON.stringify([bram.pubKey]) ? true : null), { timeout: 20_000, step: 300 });
      expect(ok, `${who.label} folds bram as the ONE admin: ${JSON.stringify(view(await readRoster(who, CIRCLE)))}`).toBe(true);
    }
  }, 90_000);

  it('the last admin leaves: the founder and cato name the SAME caretaker, a member still in, marked as caretaker', async () => {
    const left = await bram.agent.callSkill('pinboard', 'leaveGroup', { groupId: CIRCLE, confirm: true });
    expect(left?.error, JSON.stringify(left)).toBeFalsy();
    const caretakerOf = async (who) => {
      const r = await readRoster(who, CIRCLE);
      if (r.some((m) => m?.webid === bram.pubKey)) return null;   // the leave has not folded here yet
      const c = r.filter((m) => String(m?.adminVia ?? '').startsWith('caretaker:'));
      return c.length === 1 ? c[0].webid : null;
    };
    const a = await until(async () => caretakerOf(founder), { timeout: 30_000, step: 400 });
    const c = await until(async () => caretakerOf(cato), { timeout: 30_000, step: 400 });
    expect(a, `the founder names one caretaker: ${JSON.stringify(view(await readRoster(founder, CIRCLE)))}`).toBeTruthy();
    expect(c, `cato names one caretaker: ${JSON.stringify(view(await readRoster(cato, CIRCLE)))}`).toBeTruthy();
    expect(a, 'the same caretaker on both devices').toBe(c);
    expect([founder.pubKey, cato.pubKey]).toContain(a);
  }, 90_000);
});
