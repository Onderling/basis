/**
 * walk-nkn.spec.js — does anything work without a relay?
 *
 * Every walk so far ran over the relay, because the peer harness notes that "two ephemeral headless
 * contexts do not find each other over NKN". Frits: *"I'm pretty sure you can do tests over NKN as you
 * have done that before too."* Fair — that note is a claim about a harness, and it deserves testing
 * rather than repeating. NKN is the transport that makes the product work without infrastructure we
 * run, so "untested" is not a place to leave it.
 */
import { test } from '@playwright/test';
import { bootPeers, teardown, log, gotoCircles, createCircle, openCircleMatching } from './peerHarness.js';

test.setTimeout(420_000);

test('nkn — do two peers find each other with no relay at all?', async ({ browser }) => {
  const peers = await bootPeers(browser, 2, { transportMode: 'nkn' });
  const [A, B] = peers;
  const lines = { A: [], B: [] };
  A.page.on('console', (m) => { const t = m.text(); if (/nkn|transport|relay|rendezvous|peer/i.test(t)) lines.A.push(t.slice(0, 160)); });
  B.page.on('console', (m) => { const t = m.text(); if (/nkn|transport|relay|rendezvous|peer/i.test(t)) lines.B.push(t.slice(0, 160)); });
  try {
    // RELOAD after attaching the listeners: `bootPeers` navigates before this test can listen, so the
    // boot lines — the only ones that say what transport came up — were already gone. An empty console
    // read exactly like "no transport at all", which would have been a big and wrong claim.
    await Promise.all(peers.map((p2) => p2.page.reload()));
    await A.page.waitForTimeout(4000);

    // NKN bootstraps through its own network and can take a while — give it a real chance before
    // concluding anything. A verdict of "does not work" after 4 seconds is not a verdict.
    for (let i = 0; i < 12; i += 1) {
      await A.page.waitForTimeout(5000);
      const routed = lines.A.some((t) => /routing across/i.test(t));
      if (routed) break;
    }
    log('nkn · what A\'s transport says', 'OBSERVED', JSON.stringify([...new Set(lines.A)].slice(0, 6)));
    log('nkn · what B\'s transport says', 'OBSERVED', JSON.stringify([...new Set(lines.B)].slice(0, 6)));

    const routedA = lines.A.find((t) => /routing across/i.test(t)) ?? null;
    log('nkn · did a transport come up at all?', routedA ? 'PASS' : 'FINDING', routedA ?? 'nothing said it was routing');

    // Is a RELAY actually present? "routing across {nkn, relay}" names the transports that EXIST, not
    // the ones with an endpoint — and claiming "NKN works" while a relay quietly carried the traffic
    // would be the worst kind of green.
    const cfg = await A.page.evaluate(() => {
      const ls = {};
      try { for (const k of Object.keys(localStorage)) if (/relay|transport/i.test(k)) ls[k] = localStorage.getItem(k); } catch { /* */ }
      return { ls, viteRelay: (globalThis.__VITE_CIRCLE_RELAY_URL__ ?? null), href: location.href };
    });
    log('nkn · is a relay configured at all?', 'OBSERVED', JSON.stringify(cfg));

    // …and can a circle even be made with no relay? That is the first thing a person does.
    await gotoCircles(A.page);
    await createCircle(A.page, 'Nkn Kring').catch((e) => log('nkn · creating a circle threw', 'FINDING', String(e?.message ?? e).slice(0, 120)));
    const opened = await openCircleMatching(A.page, /nkn.?kring/i).then(() => true).catch(() => false);
    log('nkn · can a circle be created and opened with no relay?', opened ? 'PASS' : 'FINDING',
      opened ? 'yes — local work does not need the relay' : 'no');
  } finally { await teardown(peers); }
});
