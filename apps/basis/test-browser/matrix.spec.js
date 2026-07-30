/**
 * matrix.spec.js — the CORE connectivity journeys, run across the SETUP / MODE MATRIX.
 *
 * Builds on the Phase-0 harness (peerHarness.js) + journeys (journeys.spec.js). Where journeys.spec.js
 * runs each journey ONCE (default transport, no-pod), this runs the CORE journeys across the transport ×
 * pod matrix from setups.js — so we headlessly prove the journey suite with clients in different client
 * modes and circle setups, across phases. It does NOT replace journeys.spec.js; it multiplies the core
 * ones over the setups and is the structural proof that the matrix enumerates.
 *
 * Per (journey × setup) CELL:
 *   - supported now (transport real + pod=no-pod + journey.phase ≤ current) → a REAL body via the harness.
 *   - otherwise → `test.fixme` carrying the reason + the target phase (so the net DOCUMENTS the cell
 *     without failing CI). Pod-backed setups are all fixme today (only no-pod/fan-out is wired).
 *
 * EXTEND: add a transport/pod = one entry in setups.js; add a core journey = one entry in `CORE` below.
 *
 * Run one setup:  npx playwright test matrix.spec.js --project=relay   (or --project=nkn)
 * List the cells: npx playwright test matrix.spec.js --list
 */
import { test, expect } from '@playwright/test';
import * as H from './peerHarness.js';
import { describeMatrix, CURRENT_PHASE } from './setups.js';

test.setTimeout(420_000);

// ── the core journeys, as data ───────────────────────────────────────────────────
// Each: id/name, the earliest phase it goes green (from the DESIGN doc table), and a body that drives
// the REAL surface via the harness and asserts what is PROVABLE at that phase. The cell's own phase
// (transport/pod) is combined with the journey phase to decide real-vs-fixme.
const CORE = [
  {
    id: 'pairing', name: 'pairing', phase: 1,
    async run({ peers }) {
      const [A, B] = peers;
      const res = await H.pair(A, B, { name: 'Peer Circle' });
      console.log('[pairing]', JSON.stringify(res));
      expect(res.inviteUri, 'peer A produced a onderling-invite URI').toBeTruthy();
      // Phase-0-provable: the redeem handshake completed (wizard closed / joiner got the tile).
      // The hard both-rosters-show-2 assertion is the Phase-1 acceptance (see journeys.spec.js).
      expect(res.joined || res.joinerHasTile, 'B joined (wizard closed / tile present)').toBeTruthy();
    },
  },
  {
    id: 'fan-out', name: 'fan-out', phase: 2,
    async run({ peers }) {
      const [A, B] = peers;
      const res = await H.pair(A, B, { name: 'Peer Circle' });
      test.skip(!res.joinerHasTile, 'B never joined — pairing precondition');
      await H.reopenCircle(A.page, /peer.?circle/i);
      await H.reopenCircle(B.page, /peer.?circle/i);
      const msg = `hoi vanaf A ${Date.now().toString(36)}`;
      await H.toChat(A.page);
      await H.sendChat(A.page, msg, 3000);
      expect(await H.waitForBubble(B.page, msg), `B received ${JSON.stringify(msg)}`).toBeTruthy();
    },
  },
  {
    id: 'task-handoff', name: 'task-handoff', phase: 2,
    async run({ peers }) {
      const [A, B] = peers;
      const res = await H.pair(A, B, { name: 'Peer Circle' });
      test.skip(!res.joinerHasTile, 'B never joined — pairing precondition');
      // GOTCHA: tasks are OFF by policy default → enableFeature('tasks') on both before /addtask.
      await H.reopenCircle(A.page, /peer.?circle/i); await H.enableFeature(A.page, 'tasks');
      await H.reopenCircle(A.page, /peer.?circle/i);
      await H.reopenCircle(B.page, /peer.?circle/i); await H.enableFeature(B.page, 'tasks');
      await H.reopenCircle(B.page, /peer.?circle/i);
      await H.addTask(A.page, 'verf kopen');
      await B.page.waitForTimeout(3500);
      const bTaken = await H.openTakenTab(B.page);
      expect(bTaken.present, 'B has a Taken tab').toBeTruthy();
      expect(bTaken.rows.some((r) => /verf/i.test(r)), "B's Taken tab shows A's task").toBeTruthy();
    },
  },
  {
    id: 'entrust', name: 'entrust', phase: 1,
    async run({ peers }) {
      const [A, B] = peers;
      const res = await H.pair(A, B, { name: 'Peer Circle' });
      test.skip(!res.joinerHasTile, 'B never joined — pairing precondition');
      await H.reopenCircle(A.page, /peer.?circle/i); await H.enableFeature(A.page, 'tasks');
      await H.reopenCircle(A.page, /peer.?circle/i);
      await H.addTask(A.page, 'verf kopen');
      const picker = await H.openMandatePicker(A.page);
      console.log('[entrust] picker who=', picker.whoCount, 'empty=', picker.emptyNote);
      expect(picker.opened, 'the mandate picker opened').toBeTruthy();
      // Phase-1 acceptance: WIE lists B (roster non-empty). Today (B1) it can be empty — that's the gate.
      expect(picker.whoCount >= 1 && picker.emptyNote === 0, 'WIE lists peer B (Phase 1)').toBeTruthy();
    },
  },
  {
    id: 'offline-catch-up', name: 'offline-catch-up', phase: 2,
    async run({ peers, browser, cell }) {
      // Uses the harness storageState reuse so the RETURNING peer is the SAME identity (not a fresh one).
      const [A, B] = peers;
      const res = await H.pair(A, B, { name: 'Peer Circle' });
      test.skip(!res.joinerHasTile, 'B never joined — pairing precondition');
      const bState = await H.saveStorage(B, undefined);
      await B.context.close();
      await H.reopenCircle(A.page, /peer.?circle/i);
      const msg = `terwijl-B-weg ${Date.now().toString(36)}`;
      await H.sendChat(A.page, msg, 3000);
      const B2 = await H.bootPeer(browser, 'B', {
        transportMode: cell.transport.transportMode, pod: cell.pod.pod, storageState: bState,
      });
      await H.reopenCircle(B2.page, /peer.?circle/i);
      expect(await H.waitForBubble(B2.page, msg), 'returning B catches up the missed message').toBeTruthy();
    },
  },
];

// ── the matrix: transport × pod × core journey ────────────────────────────────────
describeMatrix(test, 'matrix', {}, (cell) => {
  for (const journey of CORE) {
    const phase = Math.max(cell.phase, journey.phase);
    const supported = cell.supported && phase <= CURRENT_PHASE;
    const title = `${journey.name}`;

    if (!supported) {
      const why = !cell.supported ? cell.reason : `${journey.name} needs Phase ${phase} (current ${CURRENT_PHASE})`;
      test.fixme(`${title} — ${why}`, async () => { /* documented target; unblocks when the phase lands */ });
      continue;
    }

    test(title, async ({ browser }) => {
      const peers = await H.bootPeers(browser, 2, {
        transportMode: cell.transport.transportMode, pod: cell.pod.pod,
      });
      try {
        await journey.run({ peers, browser, cell });
      } finally {
        await H.teardown(peers);
      }
    });
  }
});

// ── mixed-mode: peer A relay-only, peer B nkn-only, still pair ─────────────────────
// The capability Frits specifically asked for — clients in DIFFERENT transport modes in ONE test.
// Real body when Phase ≥ 1 (pairing is a no-pod/Phase-1 journey). It only truly crosses the wire when a
// relay fixture is up (the `relay` project / PEER_TEST_RELAY) AND/OR NKN reaches the network; structural
// regardless. Two peers boot from an ARRAY of per-peer modes (that's how the harness holds mixed modes).
test.describe('matrix · mixed-mode (A relay-only, B nkn-only) · no-pod', () => {
  const mixedSupported = CURRENT_PHASE >= 1;
  const body = async ({ browser }) => {
    const peers = await H.bootPeers(browser, 2, [
      { transportMode: 'relay' },   // A: relay-only (uses PEER_TEST_RELAY / the relay fixture)
      { transportMode: 'nkn' },     // B: nkn-only
    ]);
    try {
      const [A, B] = peers;
      console.log('[mixed-mode] A=', JSON.stringify(A.mode), 'B=', JSON.stringify(B.mode));
      const res = await H.pair(A, B, { name: 'Peer Circle' });
      console.log('[mixed-mode]', JSON.stringify(res));
      expect(res.inviteUri, 'relay-mode A produced an invite').toBeTruthy();
      expect(res.joined || res.joinerHasTile, 'nkn-mode B joined the relay-mode A circle').toBeTruthy();
    } finally {
      await H.teardown(peers);
    }
  };
  if (mixedSupported) test('pairing across mixed transport modes', body);
  else test.fixme('pairing across mixed transport modes — needs Phase 1', body);
});
