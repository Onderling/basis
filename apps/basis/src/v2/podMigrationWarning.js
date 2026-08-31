/**
 * basis v2 — pod-axis migration warning.
 *
 * When an admin flips the pod axis (`none` ↔ `shared` ↔ `personal` ↔
 * `hybrid`), existing circle content has to be migrated.  The design's
 * red callout warns "Wijzigen migreert bestaande inhoud.  Eén keer
 * omhoog (richting meer-pod) kan altijd, terug naar 'geen pod' niet —
 * vraag de andere admin eerst."
 *
 * This module decides whether a candidate change warrants a warning
 * and which severity to show.  Pure: hosts pass `(from, to)` + the
 * existing circle's metadata; we emit a `{severity, summary, allowed}`
 * triple the renderer styles.
 */

import { translatorOr } from '../locales/translatorOr.js';

// Order maps the privacy/sovereignty gradient:
//   none < shared < personal < hybrid
// 'up' moves toward more-pod (more durable + more individual control).
// 'down' moves toward less-pod (content is consolidated or vanishes).
const POD_LEVELS = ['none', 'shared', 'personal', 'hybrid'];

const POD_LEVEL_IDX = Object.fromEntries(POD_LEVELS.map((k, i) => [k, i]));

/**
 * Classify a pod-axis change.
 *
 * @param {object} args
 * @param {string} args.from           previous pod value
 * @param {string} args.to             proposed pod value
 * @param {boolean} [args.hasContent]  true if the circle already has content (items + member-state); host computes
 * @returns {{
 *   severity: 'none'|'info'|'warn'|'block',
 *   allowed:  boolean,
 *   direction: 'up'|'down'|'lateral'|'same',
 *   summary:  string,
 * }}
 */
export function classifyPodChange({ from, to, hasContent = false } = {}) {
  // Defensive: unknown values can't be reasoned about.
  if (!POD_LEVELS.includes(from) || !POD_LEVELS.includes(to)) {
    return { severity: 'none', allowed: true, direction: 'lateral', summary: 'circle.podMigration.unknown' };
  }
  if (from === to) {
    return { severity: 'none', allowed: true, direction: 'same', summary: 'circle.podMigration.same' };
  }
  const dir = POD_LEVEL_IDX[to] > POD_LEVEL_IDX[from] ? 'up' : 'down';

  if (dir === 'up') {
    // Going up is always allowed, but worth flagging when the circle
    // already carries content so admins know it'll be migrated.
    return {
      severity: hasContent ? 'info' : 'none',
      allowed:  true,
      direction: 'up',
      summary:  hasContent ? 'circle.podMigration.up_with_content' : 'circle.podMigration.up_empty',
    };
  }

  // Going down: special-case the all-the-way-down case.
  if (to === 'none') {
    return {
      severity: 'block',
      allowed:  false,
      direction: 'down',
      summary:  'circle.podMigration.down_to_none',
    };
  }

  return {
    severity: 'warn',
    allowed:  true,
    direction: 'down',
    summary:  'circle.podMigration.down_with_content',
  };
}

/**
 * Convenience: pull the rendered warning copy out of the host translator.
 * Returns `null` for severity:'none' so the renderer can skip the panel.
 */
export function renderPodMigrationCopy(verdict, t) {
  if (!verdict || verdict.severity === 'none') return null;
  const tr = translatorOr(t, 'podMigrationWarning.js');
  return {
    severity: verdict.severity,
    text:     tr(verdict.summary, { /* future: from/to interpolation */ }),
    allowed:  verdict.allowed,
  };
}

export const POD_LEVEL_ORDER = POD_LEVELS;
