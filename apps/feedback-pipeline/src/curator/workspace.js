// Curator workspace — the Task-2 review/release side (architecture: the editor/steward is
// the eindredacteur). Task 2 (aggregateWithThreshold) produces a DRAFT; this is where a
// human reviews it and RELEASES a report. Release is the mechanism behind two guarantees:
//   • "withdraw before release" — releasing marks the included contributions in the pod
//     (blocks further withdrawal) and records them in a manifest, so it is VERIFIABLE that
//     a contribution withdrawn earlier never appears (see pod/manifest.js).
//   • transparency — a published account of what happened to ALL input (transparency.js).
//
// Default decisions: every statistical theme is INCLUDED; every quarantined (sensitive
// below-k) theme is HELD (not released) until the human explicitly releases it. The curator
// flips those, then release().

import { buildManifest } from '../pod/manifest.js';
import { transparencyCounters } from './transparency.js';
import { routeSignals } from './signalRouting.js';

/**
 * @param {object} a
 * @param {object} a.aggregate
 * @param {object} [a.pod]
 * @param {string} [a.reportId]
 * @param {object} [a.notifier]
 * @param {{ put: (reportId:string, artifact:object) => any }} [a.reportStore]  M13 — persists the published report
 * @param {Record<string,string>} [a.signalDestinations]   M13 — signal → destination (config.signal.destinations)
 * @param {Function} [a.sendSignal]                         M13 — the injected signal transport
 */
export function createCuratorWorkspace({ aggregate, pod, reportId = 'report', notifier, reportStore, signalDestinations, sendSignal }) {
  if (!aggregate) throw new Error('createCuratorWorkspace: aggregate required');

  const included = new Map(aggregate.statistical.map((t) => [t.theme, true]));    // theme -> included?
  const released = new Map(aggregate.review.map((q) => [q.theme, false]));        // quarantined theme -> released?

  const includedThemes = () => aggregate.statistical.filter((t) => included.get(t.theme));
  const releasedQuarantine = () => aggregate.review.filter((q) => released.get(q.theme));
  const includedContributionIds = () => [...new Set([
    ...includedThemes().flatMap((t) => t.contributionIds || []),
    ...releasedQuarantine().flatMap((q) => (q.messages || []).map((m) => m.id).filter(Boolean)),
  ])];

  const counters = () => transparencyCounters(aggregate, {
    includedThemes: includedThemes(), releasedQuarantine: releasedQuarantine(), includedContributionIds: includedContributionIds(),
  });

  return {
    /** The reviewable draft + live counters (reflects current decisions). */
    review() {
      return {
        reportId,
        themes: aggregate.statistical.map((t) => ({
          theme: t.theme, userCount: t.userCount, messageCount: t.messageCount, summary: t.summary, included: included.get(t.theme),
        })),
        quarantine: aggregate.review.map((q) => ({
          theme: q.theme, userCount: q.userCount, messageCount: q.messages?.length ?? q.messageCount,
          via: q.via, detected: q.detected, released: released.get(q.theme),
        })),
        signals: aggregate.signals.map((s) => ({ signal: s.signal, severity: s.severity, confirmed: s.confirmed, via: s.via })),
        counters: counters(),
      };
    },

    includeTheme(theme, on = true) {
      if (!included.has(theme)) throw new Error(`no such theme: ${theme}`);
      included.set(theme, !!on); return this;
    },
    dropTheme(theme) { return this.includeTheme(theme, false); },
    releaseQuarantine(theme, on = true) {
      if (!released.has(theme)) throw new Error(`no such quarantined theme: ${theme}`);
      released.set(theme, !!on); return this;
    },

    /** Finalise: mark the included contributions in the pod (blocks withdrawal), build the
     *  withdrawal manifest + transparency counters, and return the report. `now` is the
     *  caller-stamped ISO timestamp (the module takes no clock). */
    async release({ now } = {}) {
      if (!now) throw new Error('release: now (ISO timestamp) required');
      const ids = includedContributionIds();
      if (pod) await pod.markIncluded(ids);
      // Two-way notify: tell each participant (pseudonymously) that their contribution was
      // released — best-effort, never blocks the release. Maps included ids → participants
      // via the pod's own records.
      if (notifier && pod) {
        const idSet = new Set(ids);
        const byParticipant = new Map();
        for (const { participant, contribution } of await pod.list()) {
          if (!idSet.has(contribution.id)) continue;
          if (!byParticipant.has(participant)) byParticipant.set(participant, []);
          byParticipant.get(participant).push(contribution.id);
        }
        for (const [participant, contributionIds] of byParticipant) {
          try { await notifier.notify(participant, { type: 'report-released', payload: { reportId, contributionIds } }); }
          catch { /* a notify failure must not fail the release */ }
        }
      }
      const c = counters();
      const report = {
        reportId, createdAt: now, lang: aggregate.lang, kThreshold: aggregate.kThreshold,
        themes: includedThemes().map((t) => ({ theme: t.theme, userCount: t.userCount, summary: t.summary })),
        counters: c,
      };
      const manifest = buildManifest({ reportId, createdAt: now, includedContributionIds: ids });

      // M13 — route confirmed signals to their configured destinations (best-effort; recorded).
      const routedSignals = await routeSignals({
        signals: aggregate.signals, destinations: signalDestinations, send: sendSignal, reportId, now,
      });

      // M13 — publish/persist the report artifact (the curator's release deliverable). Surfaced (not
      // swallowed): if the report can't be persisted, the curator must know it didn't publish.
      const artifact = { report, manifest, counters: c, routedSignals };
      if (reportStore) await reportStore.put(reportId, artifact);

      return { report, manifest, counters: c, routedSignals };
    },
  };
}
