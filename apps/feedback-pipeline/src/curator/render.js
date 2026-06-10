// Render a released report to localised text (the published artifact). Prose comes from the
// string table (src/strings curator section) — nothing hardcoded here.

import { getStrings } from '../strings/index.js';
import { renderTransparency } from './transparency.js';

export function renderReport(report, s = getStrings()) {
  const c = s.curator;
  const lines = [c.reportTitle(report.reportId), '', c.themesHeading];
  if (report.themes.length) {
    for (const t of report.themes) lines.push(c.themeLine(t.theme, t.userCount, t.summary));
  } else {
    lines.push(c.noThemes);
  }
  lines.push('', renderTransparency(report.counters, s));
  return lines.join('\n');
}

/**
 * M13 — the curator's REVIEW surface (before release): the draft as the editor sees it, with each
 * theme's include/exclude status, the quarantine's held/released status, and each signal's configured
 * destination. Localised text (the portal / a chat surface renders this); the interactive toggles +
 * the release button call the workspace's `includeTheme` / `releaseQuarantine` / `release`.
 *
 * @param {object} review   the `createCuratorWorkspace().review()` output
 * @param {{ destinations?: Record<string,string>, s?: object }} [opts]
 */
export function renderCuratorView(review, { destinations = {}, s = getStrings() } = {}) {
  const c = s.curator;
  const lines = [c.reviewTitle(review.reportId), '', c.themesHeading];
  if (review.themes.length) {
    for (const t of review.themes) {
      lines.push(`[${t.included ? c.statusIncluded : c.statusExcluded}] ${t.theme} (${t.userCount}) — ${t.summary}`);
    }
  } else {
    lines.push(c.noThemes);
  }
  if (review.quarantine.length) {
    lines.push('', c.quarantineHeading);
    for (const q of review.quarantine) {
      lines.push(`[${q.released ? c.statusReleased : c.statusHeld}] ${q.theme} (${q.userCount}) — ${q.via}`);
    }
  }
  if (review.signals.length) {
    lines.push('', c.signalsHeading);
    for (const sig of review.signals) {
      const dest = destinations[sig.signal] ?? destinations[sig.severity] ?? destinations['*'] ?? c.noDestination;
      lines.push(c.signalLine(sig.signal, sig.severity, dest, sig.confirmed));
    }
  }
  lines.push('', renderTransparency(review.counters, s), '', c.releaseHint);
  return lines.join('\n');
}
