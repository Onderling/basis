/**
 * walk-corpus.spec.js — the rest of the three-device corpus, walked to a verdict.
 *
 * Frits, 2026-08-28: *"why not do the remaining stories so we have a full error/bug report before
 * moving to solve and fix things?"* So: every remaining story gets a verdict, including BLOCKED.
 *
 * **A BLOCKED verdict is a finding, not a gap in the test.** "This layer has no invocable surface" is
 * exactly the kind of thing a bug report should say out loud — it means nobody can drive it from a
 * shell either, which is a bigger statement than a failing assertion.
 */
import { test, expect } from '@playwright/test';
import { bootPeers, teardown, pair, toChat, sendChat, readBubbles, log,
  gotoCircles, createCircle, openCircleMatching, joinFromInvite } from './peerHarness.js';

test.setTimeout(420_000);

const surface = (page, items = []) => page.evaluate((its) => window.onderlingSurface?.(its), items);
const call = (page, app, opId, args = {}) =>
  page.evaluate(([a, o, g]) => window.onderlingCall?.(a, o, g), [app, opId, args]);
const activeCircle = async (page) => (await surface(page))?.where?.circleId ?? null;
const ok = (r) => !!r && !r.error;
/** An op that is DECLARED in a manifest and answers "unknown skill" is a contract the code does not keep. */
const unimplemented = (r) => /unknown skill/i.test(JSON.stringify(r ?? ''));

test('corpus 1.3 / 1.4 / 1.7 — grants: revoke then re-grant, grant while offline, a task grant outliving its task', async ({ browser }) => {
  const peers = await bootPeers(browser, 3);
  const [A, B, C] = peers;
  try {
    await gotoCircles(A.page);
    const p = await pair(A, B, { name: 'Deel Kring', re: /deel.?kring/i, handle: 'bram' });
    test.skip(!p.joined, 'pairing failed');
    await gotoCircles(C.page);
    await joinFromInvite(C.page, p.inviteUri, { handle: 'cato', tag: 'grants-C' });
    await C.page.waitForTimeout(5000);
    const gid = await activeCircle(A.page);

    const bKey = (await call(B.page, 'stoop', 'whoAmI', {}))?.pubKey ?? null;
    const cKey = (await call(C.page, 'stoop', 'whoAmI', {}))?.pubKey ?? null;

    // 1.3 — grant, revoke, grant again
    const g1 = await call(A.page, 'household', 'grantSurface', { viewPubKey: bKey, ops: ['listOpen'], reads: ['household'] });
    log('corpus 1.3 · grant a surface to Bram', ok(g1) ? 'PASS' : 'BLOCKED', JSON.stringify(g1)?.slice(0, 140));
    const listed = await call(A.page, 'household', 'listSurfaceGrants', {});
    log('corpus 1.3 · are grants listable?', ok(listed) ? 'PASS' : 'BLOCKED', JSON.stringify(listed)?.slice(0, 160));
    const r1 = await call(A.page, 'household', 'revokeSurface', { viewPubKey: bKey });
    log('corpus 1.3 · revoke it', ok(r1) ? 'PASS' : 'BLOCKED', JSON.stringify(r1)?.slice(0, 120));
    const g2 = await call(A.page, 'household', 'grantSurface', { viewPubKey: cKey, ops: ['listOpen'], reads: ['household'] });
    log('corpus 1.3 · then grant to Cato', ok(g2) ? 'PASS' : 'BLOCKED', JSON.stringify(g2)?.slice(0, 120));
    const after = await call(A.page, 'household', 'listSurfaceGrants', {});
    const holders = JSON.stringify(after ?? {});
    log('corpus 1.3 · does the revoked grantee survive the re-grant?',
      holders.includes(String(bKey).slice(0, 20)) ? 'FINDING — Bram is still listed' : 'PASS — only Cato holds it',
      holders.slice(0, 200));

    // 1.4 — grant while the granter is offline, then reconnect
    await A.context.setOffline(true);
    await A.page.waitForTimeout(1500);
    const gOffline = await call(A.page, 'household', 'grantSurface', { viewPubKey: bKey, ops: ['listOpen'], reads: ['household'] });
    log('corpus 1.4 · granting while offline', ok(gOffline) ? 'OBSERVED — accepted locally' : 'OBSERVED — refused',
      JSON.stringify(gOffline)?.slice(0, 140));
    await A.context.setOffline(false);
    await A.page.waitForTimeout(12000);
    const afterReconnect = await call(A.page, 'household', 'listSurfaceGrants', {});
    const count = (JSON.stringify(afterReconnect ?? '').match(new RegExp(String(bKey).slice(0, 20), 'g')) ?? []).length;
    log('corpus 1.4 · exactly once after reconnect?', count === 1 ? 'PASS' : 'FINDING',
      `Bram appears ${count} time(s) in the grant list`);

    // 1.7 — a task grant outliving its task
    const tasks = await call(A.page, 'tasks', 'listOpen', { groupId: gid });
    log('corpus 1.7 · can a task be found to attach a grant to?', ok(tasks) ? 'OBSERVED' : 'BLOCKED',
      JSON.stringify(tasks)?.slice(0, 140));
    const att = await call(A.page, 'tasks', 'attachTaskGrant', { taskId: 'no-such-task', member: bKey });
    log('corpus 1.7 · does attaching a grant to a NON-EXISTENT task refuse?',
      att?.error ? 'PASS' : 'FINDING', JSON.stringify(att)?.slice(0, 140));
  } finally { await teardown(peers); }
});

test('corpus 6.3 — one device removed', async ({ browser }) => {
  const peers = await bootPeers(browser, 1);
  const [A] = peers;
  try {
    const devices = await call(A.page, 'stoop', 'listMyCircles', {});
    const rev = await call(A.page, 'household', 'revokeDevice', { deviceId: 'no-such-device' });
    log('corpus 6.3 · does revoking an unknown device refuse cleanly?',
      rev?.error ? 'PASS' : 'FINDING', JSON.stringify(rev)?.slice(0, 160));
    const s = await surface(A.page);
    const deviceOps = (s?.actions ?? []).filter((a) => /device|revoke/i.test(a.opId)).map((a) => a.opId);
    log('corpus 6.3 · what device management is OFFERED to a person?',
      deviceOps.length ? 'OBSERVED' : 'FINDING — no device affordance on this surface',
      JSON.stringify(deviceOps));
  } finally { await teardown(peers); }
});

test('corpus 8.x / 9.x / 10.x — the property, persona and driver layers: is there anything to drive?', async ({ browser }) => {
  const peers = await bootPeers(browser, 2);
  const [A, B] = peers;
  try {
    await gotoCircles(A.page);
    const p = await pair(A, B, { name: 'Lagen Kring', re: /lagen.?kring/i, handle: 'bram' });
    test.skip(!p.joined, 'pairing failed');
    const gid = await activeCircle(A.page);

    // 9.x — personas
    // The real signatures: `getPersonaView(id, contextId)` — a persona and the context to view it in.
    const me = (await call(A.page, 'stoop', 'whoAmI', {}))?.webid ?? null;
    const view = await call(A.page, 'agents', 'getPersonaView', { id: me, contextId: gid });
    const release = await call(A.page, 'agents', 'getPersonaRelease', { id: me, contextId: gid });
    log('corpus 9.x · persona surface', ok(view) || ok(release) ? 'OBSERVED' : 'BLOCKED',
      `view: ${JSON.stringify(view)?.slice(0, 90)} · release: ${JSON.stringify(release)?.slice(0, 90)}`);
    const rec = await call(A.page, 'stoop', 'recordMemberPersonaProperties', { groupId: gid, properties: { woont: 'hier' } });
    log('corpus 9.2 · can a property be recorded and read back?', ok(rec) ? 'OBSERVED' : 'BLOCKED',
      JSON.stringify(rec)?.slice(0, 140));

    // 10.x — drivers
    // `tags` is a STRING here, not an array — the manifest says so and my first guess did not read it.
    const drv = await call(A.page, 'agents', 'setProfileDriver', { kind: 'drive', text: 'buren helpen', tags: 'zorg' });
    log('corpus 10.x · can a driver be set?', ok(drv) ? 'OBSERVED' : 'BLOCKED', JSON.stringify(drv)?.slice(0, 140));
    const drvs = await call(A.page, 'agents', 'getProfileDrivers', { id: me });
    log('corpus 10.x · …and read back?', ok(drvs) ? 'OBSERVED' : 'BLOCKED', JSON.stringify(drvs)?.slice(0, 160));

    // 8.x — the charter / requested-attributes layer
    const s = await surface(A.page);
    const charterOps = (s?.actions ?? []).filter((a) => /charter|attribute|request|egress|consent/i.test(a.opId)).map((a) => a.opId);
    log('corpus 8.x · is the charter layer invocable at all?',
      charterOps.length ? 'OBSERVED' : 'BLOCKED — no charter op is offered on any surface',
      JSON.stringify(charterOps));
  } finally { await teardown(peers); }
});

test('corpus 3.4 — two decisions at once', async ({ browser }) => {
  const peers = await bootPeers(browser, 2);
  const [A, B] = peers;
  try {
    await gotoCircles(A.page);
    const p = await pair(A, B, { name: 'Besluit Kring', re: /besluit.?kring/i, handle: 'bram' });
    test.skip(!p.joined, 'pairing failed');
    const gid = await activeCircle(A.page);

    // What does the governance surface actually offer a person?
    const s = await surface(A.page);
    const govOps = (s?.actions ?? []).filter((a) => /govern|propos|vote|decis/i.test(a.opId)).map((a) => a.opId);
    log('corpus 3.4 · governance ops offered', govOps.length ? 'OBSERVED' : 'FINDING — nothing invocable',
      JSON.stringify(govOps));

    await openCircleMatching(A.page, new RegExp(`besluit.?kring|${gid}`, 'i')).catch(() => {});
    const more = A.page.locator('.circle-view__more');
    if (await more.count()) {
      await more.first().click(); await A.page.waitForTimeout(600);
      const item = A.page.locator('.circle-view__more-item[data-action="governance"]');
      if (await item.count()) { await item.first().click(); await A.page.waitForTimeout(3000); }
    }
    const body = (await A.page.evaluate(() => document.body.innerText.replace(/\s+/g, ' '))).slice(0, 300);
    log('corpus 3.4 · what the governance screen shows', 'OBSERVED', body);
    const canOpen = /voorstel|besluit|stem|nieuw/i.test(body);
    log('corpus 3.4 · can a person OPEN a decision from here?', canOpen ? 'OBSERVED' : 'FINDING',
      canOpen ? 'the screen offers something to start' : 'nothing on the screen starts a decision');
  } finally { await teardown(peers); }
});

test('corpus 9.1 / 9.2 / 10.x — personas across two circles, and drivers', async ({ browser }) => {
  const peers = await bootPeers(browser, 3);
  const [A, Bram, Cato] = peers;
  try {
    await gotoCircles(A.page);
    const pX = await pair(A, Cato, { name: 'Persona X', re: /persona.?x/i, handle: 'cato' });
    test.skip(!pX.joined, 'X pairing failed');
    const gx = await activeCircle(A.page);

    await gotoCircles(Bram.page);
    await createCircle(Bram.page, 'Persona Y');
    await openCircleMatching(Bram.page, /persona.?y/i);
    const gy = await activeCircle(Bram.page);
    const inviteY = await Bram.page.evaluate(async () => {
      const more = document.querySelector('.circle-view__more'); if (more) more.click();
      await new Promise((r) => setTimeout(r, 800));
      const item = document.querySelector('.circle-view__more-item[data-action="invite"]'); if (item) item.click();
      await new Promise((r) => setTimeout(r, 3000));
      const code = document.querySelector('.cc-mydata-modal code, .cc-mydata-modal__card code');
      const uri = code ? code.textContent.trim() : null; document.body.click(); return uri;
    });
    test.skip(!inviteY, 'no invite for Y');
    await gotoCircles(Cato.page);
    await joinFromInvite(Cato.page, inviteY, { handle: 'cato', tag: 'p91' });
    await Cato.page.waitForTimeout(5000);

    const cato = (await call(Cato.page, 'stoop', 'whoAmI', {}))?.webid ?? null;

    // 9.2 — record a property in ONE circle, then look at both.
    const rec = await call(Cato.page, 'stoop', 'recordMemberPersonaProperties', {
      groupId: gx, personaProperties: { woont: 'in de straat', kanHelpenMet: 'tuin' },
    });
    log('corpus 9.2 · can a member record persona properties?', rec?.error || rec?.ok === false ? 'FINDING' : 'PASS',
      JSON.stringify(rec)?.slice(0, 160));
    await Cato.page.waitForTimeout(4000);

    // 9.1 — the SAME persona, two circles: is the disclosure per-circle?
    const viewX = await call(Cato.page, 'agents', 'getPersonaView', { id: cato, contextId: gx });
    const viewY = await call(Cato.page, 'agents', 'getPersonaView', { id: cato, contextId: gy });
    log('corpus 9.1 · the persona as seen in X', 'OBSERVED', JSON.stringify(viewX)?.slice(0, 200));
    log('corpus 9.1 · …and in Y', 'OBSERVED', JSON.stringify(viewY)?.slice(0, 200));
    const differs = JSON.stringify(viewX?.properties ?? {}) !== JSON.stringify(viewY?.properties ?? {});
    log('corpus 9.1 · is disclosure PER-CIRCLE?', differs ? 'PASS' : 'FINDING',
      differs ? 'the two circles see different properties' : 'both circles see the same thing — a property given to X shows in Y');

    // …and can the OTHER circle's admin read what Cato gave X?
    const bramSees = await call(Bram.page, 'agents', 'getPersonaView', { id: cato, contextId: gy });
    log('corpus 9.1 · what Y\'s admin can read about Cato', 'OBSERVED', JSON.stringify(bramSees)?.slice(0, 200));

    // 10.x — drivers
    const set = await call(Cato.page, 'agents', 'setProfileDriver', {
      id: cato, key: 'tuinhulp', kind: 'drive', text: 'buren helpen met de tuin', tags: 'tuin',
    });
    log('corpus 10.x · can a driver be set?', set?.error ? 'FINDING' : 'PASS', JSON.stringify(set)?.slice(0, 160));
    const mine = await call(Cato.page, 'agents', 'getProfileDrivers', { id: cato });
    log('corpus 10.x · …and read back by their owner?', JSON.stringify(mine ?? '').includes('tuin') ? 'PASS' : 'FINDING',
      JSON.stringify(mine)?.slice(0, 200));

    // 10.1's claim, re-checked from the other side: can ANYONE ELSE read them?
    const bramReadsDrivers = await call(Bram.page, 'agents', 'getProfileDrivers', { id: cato });
    const leaked = JSON.stringify(bramReadsDrivers ?? '').includes('tuin');
    log('corpus 10.x · can another member read your drivers?', leaked ? 'FINDING — drivers are readable by others' : 'PASS',
      JSON.stringify(bramReadsDrivers)?.slice(0, 180));
  } finally { await teardown(peers); }
});
