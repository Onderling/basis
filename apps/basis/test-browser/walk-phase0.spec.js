/**
 * Phase-0 investigations I5 · I6 · I9 — the ones a single peer can answer.
 *
 * These are QUESTIONS, not fixes: each names its own branch, and the point is to replace a guess in
 * `REMAINING-WORK.md` § 5J with a measured sentence. Nothing here asserts a product property, so a
 * FINDING is a result rather than a failure — the same contract the other walk specs use.
 *
 * I7 (recovery phrase in a second browser) and I8 (the join wizard's "fresh self") need a second context
 * and an invite; they live with the stories that already build one.
 */
import { test, expect } from '@playwright/test';
import { bootPeers, teardown, log, gotoCircles, createCircle, openCircleMatching, toChat, sendChat } from './peerHarness.js';

// The default 30s test budget is for unit-shaped tests; a walk boots a real app, creates a circle and
// polls. Two of these died at exactly 30.0s before this line existed — a timeout that looks like a
// product failure and is not one.
test.setTimeout(420_000);

const surface = (page, items = []) => page.evaluate((its) => window.onderlingSurface?.(its), items);
const call = (page, app, opId, args = {}) =>
  page.evaluate(([a, o, g]) => window.onderlingCall?.(a, o, g), [app, opId, args]);

test('I5 — drivers and persona properties: one store or two, and keyed how?', async ({ browser }) => {
  const peers = await bootPeers(browser, 1);
  const [A] = peers;
  try {
    // `stoop`/`whoAmI` is the identity op the other walk specs use; `basis`/`whoami` is the POD sign-in
    // message and answers about a session, not about me. Guessing that cost this spec its first run.
    const me = await call(A.page, 'stoop', 'whoAmI', {});
    const webid = me?.webid ?? null;
    const pubKey = me?.pubKey ?? null;
    log('I5 · who am I', 'OBSERVED', JSON.stringify({ webid: String(webid).slice(0, 24), pubKey: String(pubKey).slice(0, 16) }));

    // The walk passed a webid as `id` and read nothing back. Ask with BOTH ids, so the answer is
    // "keyed by X" rather than "it did not work".
    const wrote = await call(A.page, 'agents', 'setProfileDriver', { id: webid, key: 'test-driver', text: 'een boormachine lenen' });
    log('I5 · setProfileDriver(webid)', wrote?.error ? 'FINDING' : 'OBSERVED', JSON.stringify(wrote)?.slice(0, 160));

    const byWebid = await call(A.page, 'agents', 'getProfileDrivers', { id: webid });
    const byPub   = pubKey ? await call(A.page, 'agents', 'getProfileDrivers', { id: pubKey }) : null;
    const n = (r) => (Array.isArray(r?.drivers) ? r.drivers.length : (Array.isArray(r?.items) ? r.items.length : (r?.error ? `err:${r.error}` : 0)));
    log('I5 · read back by webid', n(byWebid) ? 'PASS' : 'FINDING', `${n(byWebid)} · ${JSON.stringify(byWebid)?.slice(0, 140)}`);
    log('I5 · read back by pubKey', n(byPub) ? 'PASS' : 'FINDING', `${n(byPub)} · ${JSON.stringify(byPub)?.slice(0, 140)}`);
    log('I5 · VERDICT — same id writes and reads?',
      n(byWebid) ? 'PASS' : (n(byPub) ? 'FINDING' : 'FINDING'),
      n(byWebid) ? 'one store, keyed by the id the caller passes'
        : (n(byPub) ? 'written under one id, readable under another — a KEYING mismatch, not two stores'
          : 'written and readable under neither — the write and the read are different stores'));

    // The persona half: stoop writes the member map, agents reads the profile registry.
    const gid = await (async () => {
      await gotoCircles(A.page); await createCircle(A.page, 'Persona Kring');
      await openCircleMatching(A.page, /persona.?kring/i);
      return (await surface(A.page))?.where?.circleId ?? null;
    })();
    const recorded = await call(A.page, 'stoop', 'recordMemberPersonaProperties', {
      groupId: gid, memberWebid: webid, personaProperties: { mobility: 'walks' },
    });
    log('I5 · recordMemberPersonaProperties', recorded?.error ? 'FINDING' : 'OBSERVED', JSON.stringify(recorded)?.slice(0, 140));
    const view = await call(A.page, 'agents', 'getPersonaView', { id: webid });
    log('I5 · getPersonaView(webid) sees it?',
      JSON.stringify(view ?? {}).includes('mobility') ? 'PASS' : 'FINDING',
      JSON.stringify(view)?.slice(0, 180));
  } finally { await teardown(peers); }
});

test('I6 — is device management offered on the Mij surface? (B4 said "nowhere")', async ({ browser }) => {
  const peers = await bootPeers(browser, 1);
  const [A] = peers;
  try {
    // The walk probed INSIDE a circle, where device ops are not circle affordances. Ask from the app's
    // own top level instead, and then ask the screen itself.
    const top = await surface(A.page);
    const deviceOps = (top?.actions ?? []).filter((a) => /device|apparaat|revoke|enroll/i.test(a.opId ?? ''));
    log('I6 · device ops on the top-level surface', deviceOps.length ? 'PASS' : 'FINDING',
      deviceOps.map((a) => a.opId).join(' · ') || 'none offered');

    const mij = A.page.locator('[data-nav="mydata"], .cc-mydata-modal, [data-tab="mydata"]');
    const opened = await mij.count();
    log('I6 · can a walk reach the Mij screen at all?', opened ? 'PASS' : 'OBSERVED',
      opened ? 'a Mij element is present' : 'no Mij element from the launcher — the walk needs its route');

    const text = await A.page.evaluate(() => document.body.innerText.replace(/\s+/g, ' ').slice(0, 3000));
    const mentionsDevices = /apparaat|apparaten|device|gekoppeld/i.test(text);
    log('I6 · does the app SAY anything about devices where a person can see it?',
      mentionsDevices ? 'PASS' : 'FINDING', mentionsDevices ? 'the word appears on screen' : 'nothing about devices on this screen');
  } finally { await teardown(peers); }
});

test('I9 — do a post\'s row actions vary between reads? (P3/W4)', async ({ browser }) => {
  const peers = await bootPeers(browser, 1);
  const [A] = peers;
  try {
    await gotoCircles(A.page);
    await createCircle(A.page, 'Herhaal Kring');
    await openCircleMatching(A.page, /herhaal.?kring/i);
    await toChat(A.page);
    await sendChat(A.page, 'EEN-REGEL-OM-TE-LEZEN');
    await A.page.waitForTimeout(3000);

    // Ten reads of the SAME surface, same page, no navigation between them. A set that changes is a
    // race in what the projection is composed from; a set that is stable retires the finding.
    const seen = [];
    for (let i = 0; i < 10; i += 1) {
      const s = await surface(A.page, [{ id: 'x1', type: 'chat-message', text: 'EEN-REGEL-OM-TE-LEZEN' }]);
      const rowOps = (s?.rowActions ?? s?.items ?? []).flatMap((r) => (r.actions ?? []).map((a) => a.opId ?? a));
      seen.push(JSON.stringify([...new Set(rowOps)].sort()));
      await A.page.waitForTimeout(400);
    }
    const distinct = [...new Set(seen)];
    log('I9 · ten reads of the same row surface', distinct.length === 1 ? 'PASS' : 'FINDING',
      distinct.length === 1
        ? `stable: ${distinct[0].slice(0, 120)}`
        : `${distinct.length} DIFFERENT sets across ten reads — ${distinct.map((d) => d.slice(0, 60)).join(' | ')}`);
    expect(distinct.length, 'the reads happened').toBeGreaterThan(0);
  } finally { await teardown(peers); }
});
