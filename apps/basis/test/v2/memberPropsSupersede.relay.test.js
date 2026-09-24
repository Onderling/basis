/**
 * SUPERSEDING `member-props` OVER A REAL RELAY (L121, 2026-09-24): a member who renames three times leaves three
 * statements on every device's membership lane. The lane never drops on a clock — but the FOLD names the dead ones
 * (every field overwritten, no handle) and each device TOMBSTONES them: chain fields kept, bytes gone. Three devices
 * must then agree on the roster with or without the tombstones, before and after a reload.
 *
 * Admin + bram + cato in one circle. Bram sets a display name three times and a face twice. Then: every device's
 * roster shows the newest; the admin's log carries tombstones for the older statements and no face bytes in them;
 * a fresh log hydrated from the admin's persisted snapshot folds the same roster; cato, who received the very same
 * statements, agrees. The refold-agreement is the acceptance: two devices that hold different bytes fold one roster.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { startJourneyRelay } from '../support/testRelay.js';
import { bootRealAgentNode, connectNodesOverRelay, createCircle, joinExistingCircle, bindCircleAddresses, readRoster, until, teardown } from '../support/pairRealAgents.js';
import { bindCircleAddressKeysFor } from '../../src/v2/householdRosterPairing.js';
import { primeCircleSecurity } from '../../src/v2/circleSecurityPriming.js';
import { EventLog } from '../../src/eventLog.js';

const CIRCLE = 'circle-member-props-supersede';
const settle = (ms = 1500) => new Promise((r) => setTimeout(r, ms));
const settleMember = async (node, circleId) => { await bindCircleAddresses([node], circleId); await bindCircleAddressKeysFor({ agent: node.agent, circleId }); };
const rowOf = (roster, webid) => roster.find((m) => m?.webid === webid) ?? null;
const face = (tag) => ({ type: 'blob', ref: `blob://${tag}`, enc: { sealed: true, keyRef: 'k', format: 'b', bytes: 9, thumb: tag.repeat(1200) } });

describe('member-props supersession — three devices agree, with and without the tombstones', () => {
  let relay; let admin; let bram; let cato; const logs = {};

  beforeAll(async () => {
    relay = await startJourneyRelay();
    const opts = (name) => { logs[name] = new EventLog({ initial: [], muted: [] }); return { agentOpts: { allowAddressFallback: false, deviceLog: logs[name] } }; };
    [admin, bram, cato] = await Promise.all([bootRealAgentNode('admin', opts('admin')), bootRealAgentNode('bram', opts('bram')), bootRealAgentNode('cato', opts('cato'))]);
    await connectNodesOverRelay([admin, bram, cato], { relayUrl: relay.url });
    await createCircle(admin, { groupId: CIRCLE, name: 'S' });
    await settleMember(admin, CIRCLE);
    expect((await joinExistingCircle(admin, bram, { groupId: CIRCLE, handle: 'bram' })).joined.ok).toBe(true);
    await settleMember(bram, CIRCLE);
    expect((await joinExistingCircle(admin, cato, { groupId: CIRCLE, handle: 'cato' })).joined.ok).toBe(true);
    await settleMember(cato, CIRCLE);
    await Promise.all([admin, bram, cato].map((n) => primeCircleSecurity({ agent: n.agent, onWarn: () => {} })));
    await settle(1500);
    for (const node of [admin, bram, cato]) await bindCircleAddressKeysFor({ agent: node.agent, circleId: CIRCLE });
  }, 180000);

  afterAll(async () => {
    try { await teardown(admin, bram, cato); } catch { /* */ }
    try { await relay?.stop(); } catch { /* */ }
  });

  it('bram says three names and two faces; every roster shows the newest; the older statements are tombstoned, bytes gone', async () => {
    for (const [name, pic] of [['Bram Een', 'A'], ['Bram Twee', 'B'], ['Bram Drie', null]]) {
      const props = pic ? { displayName: name, personaProperties: { profilePicture: face(pic) } } : { displayName: name };
      await bram.agent.emitMemberProps({ circleIds: [CIRCLE], props });
      await settle(800);
    }
    for (const who of [admin, bram, cato]) {
      const ok = await until(async () => (rowOf(await readRoster(who, CIRCLE), bram.pubKey)?.displayName === 'Bram Drie' ? true : null), { timeout: 20_000, step: 400 });
      expect(ok, `${who.label} shows the newest name`).toBe(true);
    }
    // the face from the SECOND statement stands (the third set no face); 'A' was overwritten by 'B'
    const adminRow = rowOf(await readRoster(admin, CIRCLE), bram.pubKey);
    expect(adminRow?.personaProperties?.profilePicture?.enc?.thumb?.startsWith('B')).toBe(true);

    // the admin's LOG: bram's member-props entries — the first (name+face A) is dead: both fields overwritten
    const entries = () => logs.admin.query({}).filter((e) => e.type === 'membership' && e.circleId === CIRCLE && e.payload?.body?.kind === 'member-props' && e.payload?.body?.payload?.authorRef === bram.pubKey);
    const tombstoned = await until(async () => { await readRoster(admin, CIRCLE); const t = entries().filter((e) => e.payload.tombstone === true); return t.length >= 1 ? t : null; }, { timeout: 20_000, step: 400 });
    expect(tombstoned.length).toBeGreaterThanOrEqual(1);
    for (const t of tombstoned) {
      expect(JSON.stringify(t.payload)).not.toContain('AAAA');           // the face bytes are gone
      expect(t.payload.body.hash).toBeTruthy(); expect(t.payload.body.author).toBeTruthy();   // the chain edge stays
    }
    // the newest statement is never tombstoned
    expect(entries().some((e) => e.payload.tombstone !== true && e.payload.body.payload.displayName === 'Bram Drie')).toBe(true);
  }, 90_000);

  it('REFOLD AGREEMENT: a fresh log hydrated from the admin\'s snapshot folds the same roster; cato agrees', async () => {
    const snapshot = logs.admin.query({});
    const fresh = new EventLog({ initial: [], muted: [] });
    fresh.hydrate(snapshot);
    expect(fresh.size).toBe(logs.admin.size);
    const a = rowOf(await readRoster(admin, CIRCLE), bram.pubKey);
    const c = rowOf(await readRoster(cato, CIRCLE), bram.pubKey);
    for (const k of ['displayName', 'handle']) expect(c?.[k], `cato agrees on ${k}`).toBe(a?.[k]);
    expect(c?.personaProperties?.profilePicture?.enc?.thumb).toBe(a?.personaProperties?.profilePicture?.enc?.thumb);
  }, 60_000);
});
