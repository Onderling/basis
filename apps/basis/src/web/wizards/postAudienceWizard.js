/**
 * **Platform: web** (DOM-dependent). RN parallel pending.
 *
 * basis — C5 post-audience picker (2026-05-24).
 *
 * Single-step rich UI that ENRICHES /post with audience targeting.
 * Per the audit's S8 finding: pinboard's substrate has an audience model
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
 * `audience: { minTrust, tags, distanceKm, recipients }`.  If pinboard
 * ignores the audience field today, the post still files; the
 * audience intent is preserved for when pinboard wires audience-filter.
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
    const body = mkBody(doc, t('circle.wizard.audience.title'), t('circle.wizard.audience.intro'));

    // Circle picker (only when we have a real list).  Single-circle
    // users see one radio for clarity; multi-circle users see all.
    if (Array.isArray(state.availableCircles) && state.availableCircles.length > 0) {
      mkRadioGroup(body, doc, t('circle.wizard.audience.target'), state.selectedCircle ?? state.availableCircles[0].id,
        state.availableCircles.map(b => ({ id: b.id, label: b.label })),
        (v) => { state.selectedCircle = v; });
    }
    const validText = () => state.text.trim().length > 0;
    mkTextarea(body, doc, t('circle.wizard.audience.what'), state.text, (v) => {
      state.text = v;
      refreshActions(container, { textOk: validText });
    }, { placeholder: t('circle.wizard.audience.text_placeholder'), rows: 3 });
    // Radio + distance buttons change visible UI; rerender is safe
    // (no text input focus to preserve at those points).
    mkRadioGroup(body, doc, t('circle.wizard.audience.kind'), state.kind, [
      { id: 'ask', label: t('circle.wizard.audience.kind_ask') },
      { id: 'offer', label: t('circle.wizard.audience.kind_offer') },
      { id: 'lend',  label: t('circle.wizard.audience.kind_lend') },
    ], (v) => { state.kind = v; });
    mkRadioGroup(body, doc, t('circle.wizard.audience.trust'), state.minTrust, TRUST_OPTS,
      (v) => { state.minTrust = v; });
    mkField(body, doc, t('circle.wizard.audience.tags'),
      state.tags, (v) => { state.tags = v; },
      { placeholder: t('circle.wizard.audience.tags_placeholder') });

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

    mkField(body, doc, t('circle.wizard.audience.recipients'),
      state.recipients, (v) => { state.recipients = v; },
      { placeholder: t('circle.wizard.audience.recipients_placeholder'), monospace: true,
        hint: t('circle.wizard.audience.recipients_hint') });

    mkError(body, doc, state.submitError);
    mkSubmitting(body, doc, state.submitting, t('circle.wizard.audience.posting'));
    container.appendChild(body);
    mkActions(container, doc, [
      { label: t('common.cancel'), onClick: onClose, kind: 'secondary', disabled: state.submitting },
      { label: t('circle.noticeboard.post'),   onClick: async () => {
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
