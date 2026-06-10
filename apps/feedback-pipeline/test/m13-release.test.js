// M13 — release publishes the report artifact + routes confirmed signals to their configured
// destinations. Unit-tests the routing mechanism + the release wiring (no LLM / no pod needed).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { routeSignals } from '../src/curator/signalRouting.js';
import { createCuratorWorkspace } from '../src/curator/workspace.js';
import { renderCuratorView } from '../src/curator/render.js';
import { getStrings } from '../src/strings/index.js';

const NOW = '2026-06-10T12:00:00Z';

const SIGNALS = [
  { user: 'a', signal: 'crisis', severity: 'high', confirmed: true },
  { user: 'b', signal: 'safety', severity: 'med',  confirmed: true },
  { user: 'c', signal: 'crisis', severity: 'high', confirmed: false },   // unconfirmed → not routed
];
const DESTS = { crisis: '113 / meldpunt', safety: 'afdeling OR' };

test('routeSignals routes only CONFIRMED signals to their configured destination', async () => {
  const sent = [];
  const routed = await routeSignals({ signals: SIGNALS, destinations: DESTS, send: (d) => sent.push(d), reportId: 'r1', now: NOW });
  assert.equal(routed.length, 2);                                   // the two confirmed ones
  assert.deepEqual(routed.map((r) => [r.signal, r.destination, r.routed]),
    [['crisis', '113 / meldpunt', true], ['safety', 'afdeling OR', true]]);
  assert.equal(sent.length, 2);
  assert.deepEqual(sent[0], { destination: '113 / meldpunt', signal: SIGNALS[0], reportId: 'r1', now: NOW });
});

test('routeSignals records a no-destination signal (not dropped silently)', async () => {
  const routed = await routeSignals({ signals: [{ signal: 'theme', confirmed: true }], destinations: DESTS });
  assert.deepEqual(routed, [{ signal: 'theme', severity: undefined, destination: null, routed: false, reason: 'no-destination' }]);
});

test('routeSignals records a send failure but never throws (release must not be blocked)', async () => {
  const routed = await routeSignals({ signals: SIGNALS, destinations: DESTS, send: () => { throw new Error('meldpunt down'); } });
  assert.equal(routed[0].routed, false);
  assert.equal(routed[0].error, 'meldpunt down');
});

test('routeSignals falls back to severity then "*"', async () => {
  const bySev = await routeSignals({ signals: [{ signal: 'x', severity: 'high', confirmed: true }], destinations: { high: 'esc' } });
  assert.equal(bySev[0].destination, 'esc');
  const byStar = await routeSignals({ signals: [{ signal: 'x', confirmed: true }], destinations: { '*': 'catch-all' } });
  assert.equal(byStar[0].destination, 'catch-all');
});

// A minimal synthetic aggregate (createCuratorWorkspace only reads these fields).
function aggregateWith(signals = []) {
  return {
    statistical: [{ theme: 'waiting times', userCount: 2, messageCount: 2, summary: 'too long', contributionIds: ['p1:1', 'p2:1'] }],
    review: [], dropped: [], rejected: [], signals,
    totalUsers: 2, totalMessages: 2, lang: 'nl', kThreshold: 2,
  };
}

test('release persists the report artifact to the reportStore', async () => {
  const puts = [];
  const ws = createCuratorWorkspace({
    aggregate: aggregateWith(), reportId: 'r1',
    reportStore: { put: (id, artifact) => puts.push({ id, artifact }) },
  });
  const out = await ws.release({ now: NOW });
  assert.equal(puts.length, 1);
  assert.equal(puts[0].id, 'r1');
  assert.equal(puts[0].artifact.report.reportId, 'r1');
  assert.equal(puts[0].artifact.report.themes.length, 1);
  assert.ok(puts[0].artifact.manifest);
  assert.deepEqual(out.routedSignals, []);                         // no signals in this aggregate
});

test('release routes the aggregate signals + includes them in the persisted artifact', async () => {
  const sent = [];
  const puts = [];
  const ws = createCuratorWorkspace({
    aggregate: aggregateWith([{ user: 'a', signal: 'crisis', severity: 'high', confirmed: true }]),
    reportId: 'r1',
    signalDestinations: DESTS,
    sendSignal: (d) => sent.push(d),
    reportStore: { put: (id, artifact) => puts.push(artifact) },
  });
  const out = await ws.release({ now: NOW });
  assert.deepEqual(out.routedSignals, [{ signal: 'crisis', severity: 'high', destination: '113 / meldpunt', routed: true }]);
  assert.equal(sent.length, 1);
  assert.equal(puts[0].routedSignals[0].destination, '113 / meldpunt');   // recorded in the artifact
});

test('renderCuratorView shows theme status, quarantine, signals → destinations (localised)', () => {
  const aggregate = {
    statistical: [{ theme: 'waiting times', userCount: 2, messageCount: 2, summary: 'too long', contributionIds: ['p1:1'] }],
    review: [{ theme: 'safety concern', userCount: 1, messages: [{ id: 'q1' }], via: 'sensitive-domain', detected: ['safe'] }],
    dropped: [], rejected: [],
    signals: [{ user: 'a', signal: 'crisis', severity: 'high', confirmed: true }],
    totalUsers: 3, totalMessages: 3, lang: 'en', kThreshold: 2,
  };
  const ws = createCuratorWorkspace({ aggregate, reportId: 'r1' });
  const view = renderCuratorView(ws.review(), { destinations: DESTS, s: getStrings('en') });

  assert.match(view, /Report r1 — review/);
  assert.match(view, /\[included\] waiting times/);            // default-included theme
  assert.match(view, /Held for review/);
  assert.match(view, /\[held\] safety concern/);               // quarantined, not yet released
  assert.match(view, /crisis \(high\) → 113 \/ meldpunt/);     // signal routed to its destination
  assert.match(view, /Release publishes the report/);

  // a dropped theme reflects in the view
  ws.dropTheme('waiting times');
  assert.match(renderCuratorView(ws.review(), { s: getStrings('en') }), /\[left out\] waiting times/);
  // localised
  assert.match(renderCuratorView(ws.review(), { s: getStrings('nl') }), /beoordeling/);
});

test('release surfaces a persistence failure (the curator must know it did not publish)', async () => {
  const ws = createCuratorWorkspace({
    aggregate: aggregateWith(), reportId: 'r1',
    reportStore: { put: () => { throw new Error('pod write failed'); } },
  });
  await assert.rejects(() => ws.release({ now: NOW }), /pod write failed/);
});
