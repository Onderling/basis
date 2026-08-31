/**
 * **Platform: web** (DOM-dependent). RN parallel pending.
 *
 * basis — C5 post-audience picker (2026-05-24).
 *
 * Single-step rich UI that ENRICHES /post with audience targeting.
 * Per the audit's S8 finding: stoop's substrate has an audience model
 * (subset of group + per-tag + distance) but no compositional UI.
 * The wizard collects audience config + calls postRequest with the
 * extended args; substrate uses them when audience-filter ships, or
 * stores them with the post for later honour.
 *
 * Audience composition (all optional, intersected):
 *   - Trust level: known / trusted / all-known
 *   - Tags (CSV) — match contacts with any of these tags
 *   - Distance (km grid: 1 / 2 / 5 / 10 / 25 / no-limit)
 *   - Explicit webids (CSV)
 *
 * Substrate skill: postRequest (existing).  Args extended with
 * `audience: { minTrust, tags, distanceKm, recipients }`.  If stoop
 * ignores the audience field today, the post still files; the
 * audience intent is preserved for when stoop wires audience-filter.
 */

import { mkBody, mkActions, mkField, mkTextarea, mkRadioGroup, mkError, mkSubmitting, refreshActions } from './_wizardKit.js';
import {
  TRUST_OPTS, DISTANCE_OPTS,
  initialState, canSubmit, loadAvailableCircles, submitPost,
} from '../../core/wizards/postAudienceState.js';
import { t } from '../../localisation.js';

export function renderPostAudienceWizard(opts) {
  const { container, doc, args, callSkill, onClose, onDispatched } = opts;
  const state = initialState(args);

  // Lazy-load the circle list.  Failures fall back silently to the
  // single-circle default ('cc-default-circle'); the picker just won't
  // render and substrate-side default applies.
  (async () => {
    await loadAvailableCircles({ state, callSkill });
    rerender();
  })();

  rerender();

  function rerender() {
    container.innerHTML = '';
    const body = mkBody(doc, 'Post with audience',
      'Pick a target audience.  Empty = everyone in your circle.');

    // Circle picker (only when we have a real list).  Single-circle
    // users see one radio for clarity; multi-circle users see all.
    if (Array.isArray(state.availableCircles) && state.availableCircles.length > 0) {
      mkRadioGroup(body, doc, 'Circle', state.selectedCircle ?? state.availableCircles[0].id,
        state.availableCircles.map(b => ({ id: b.id, label: b.label })),
        (v) => { state.selectedCircle = v; });
    }
    const validText = () => state.text.trim().length > 0;
    mkTextarea(body, doc, 'Post text', state.text, (v) => {
      state.text = v;
      refreshActions(container, { textOk: validText });
    }, { placeholder: 'What are you asking / offering?', rows: 3 });
    // Radio + distance buttons change visible UI; rerender is safe
    // (no text input focus to preserve at those points).
    mkRadioGroup(body, doc, 'Kind', state.kind, [
      { id: 'ask', label: 'Ask (request help)' },
      { id: 'offer', label: 'Offer (share skills/items)' },
      { id: 'lend',  label: 'Lend (share a physical thing)' },
    ], (v) => { state.kind = v; });
    mkRadioGroup(body, doc, 'Trust level', state.minTrust, TRUST_OPTS,
      (v) => { state.minTrust = v; });
    mkField(body, doc, 'Tags (CSV — match contacts with any tag)',
      state.tags, (v) => { state.tags = v; },
      { placeholder: 'e.g. tools, gardening, kids' });

    // km distance grid
    const distLabel = doc.createElement('div');
    distLabel.className = 'cc-wizard-field-label';
    distLabel.textContent = t('circle.wizard.audience.max_distance');
    body.appendChild(distLabel);
    const distGrid = doc.createElement('div');
    distGrid.className = 'cc-wizard-distance-grid';
    for (const d of DISTANCE_OPTS) {
      const btn = doc.createElement('button');
      btn.type = 'button';
      btn.className = `cc-wizard-distance ${state.distanceKm === d.km ? 'cc-wizard-distance-active' : ''}`;
      btn.textContent = d.label;
      btn.addEventListener('click', () => { state.distanceKm = d.km; rerender(); });
      distGrid.appendChild(btn);
    }
    body.appendChild(distGrid);

    mkField(body, doc, 'Specific webids (CSV, optional)',
      state.recipients, (v) => { state.recipients = v; },
      { placeholder: 'e.g. webid:anne,webid:karl', monospace: true,
        hint: 'When set, restricts to these recipients regardless of trust/distance.' });

    mkError(body, doc, state.submitError);
    mkSubmitting(body, doc, state.submitting, 'Posting…');
    container.appendChild(body);
    mkActions(container, doc, [
      { label: 'Cancel', onClick: onClose, kind: 'secondary', disabled: state.submitting },
      { label: 'Post',   onClick: async () => {
        rerender(); // show submitting state
        const { result } = await submitPost({ state, callSkill });
        if (result) {
          if (typeof onDispatched === 'function') {
            try { onDispatched({ ok: true, message: '✓ Posted to your circle.', ...result }); } catch {}
          }
          onClose();
          return;
        }
        rerender(); // failure path: re-render to show submitError
      }, kind: 'primary', validate: 'textOk',
        disabled: !canSubmit(state) },
    ]);
  }
}
