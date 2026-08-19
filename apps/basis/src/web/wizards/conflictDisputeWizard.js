/**
 * **Platform: web** (DOM-dependent). RN parallel pending.
 *
 * basis — C4 conflict-resolution dispute wizard (2026-05-24).
 *
 * 3-step dispute flow: raise → propose resolution → acceptance.  Per
 * stoop's S7 design.
 *
 * **Substrate gap**: stoop hasn't shipped the dedicated raiseDispute /
 * proposeResolution / acceptResolution skills yet (the Lamport
 * version-vector substrate exists but the user-facing dispute ops
 * don't).  V0 fallback per [[quality-over-cheap]]: persist as a
 * `kind: 'dispute'` stoop request via the existing `postRequest`
 * skill.  The circle feed becomes the V0 escalation surface; future
 * C4.5 slice swaps in the real escalation skills when they land.
 *
 * The wizard collects all three steps' data and packages them into a
 * single dispute payload so the substrate skills, when they land,
 * have a ready-to-consume shape.
 */

import { mkBody, mkActions, mkField, mkTextarea, mkRadioGroup, mkSteps, mkError, mkSubmitting, refreshActions } from './_wizardKit.js';
import {
  ESCALATION_PATHS,
  initialState, isSummaryValid, isProposalValid, labelOf,
  loadAboutPostText, submitDispute,
} from '../../core/wizards/conflictDisputeState.js';

export function renderConflictDisputeWizard(opts) {
  const { container, doc, args, callSkill, onClose, onDispatched } = opts;
  const state = initialState(args);

  // Lazy-load the post text so the wizard can display it readably.
  if (state.aboutPostId) {
    (async () => {
      await loadAboutPostText({ state, callSkill });
      rerender();
    })();
  }

  rerender();

  function rerender() {
    container.innerHTML = '';
    if (state.successResult) return renderSuccessStep(container, doc, state, onClose);
    mkSteps(container, doc, ['Raise', 'Propose', 'File'], state.step);
    if (state.step === 1) renderRaiseStep();
    if (state.step === 2) renderProposeStep();
    if (state.step === 3) renderFileStep();
  }

  function renderRaiseStep() {
    const body = mkBody(doc, 'Raise a dispute',
      'Describe what happened.  This goes to the circle; admins and (if your conflict-policy is mediation) two random members see it.');
    const validSummary = () => isSummaryValid(state.summary);
    // 2026-05-24 — when launched from a row button (postId pre-filled),
    // show the post text as a read-only context card instead of a raw
    // id input.  Falls back to a text input when no postId.
    if (state.aboutPostId) {
      const card = doc.createElement('div');
      card.className = 'cc-wizard-context-card';
      const label = doc.createElement('div');
      label.className = 'cc-wizard-field-label';
      label.textContent = 'Disputing this post:';
      card.appendChild(label);
      const quote = doc.createElement('blockquote');
      quote.className = 'cc-wizard-context-quote';
      quote.textContent = state.aboutPostText ?? '(loading post text…)';
      card.appendChild(quote);
      body.appendChild(card);
    } else {
      mkField(body, doc, 'Related post id (optional)', state.aboutPostId,
        (v) => { state.aboutPostId = v; },
        { placeholder: 'leave blank for general dispute', monospace: true });
    }
    mkTextarea(body, doc, 'What happened?', state.summary, (v) => {
      state.summary = v;
      refreshActions(container, { summaryOk: validSummary });
    }, { placeholder: 'Be specific. Avoid naming third parties unless necessary.', rows: 5 });
    // Radio group changes WHICH summary is shown next step — these can
    // safely call rerender (no focus to preserve).
    mkRadioGroup(body, doc, 'Preferred escalation', state.escalation, ESCALATION_PATHS,
      (v) => { state.escalation = v; });
    container.appendChild(body);
    mkActions(container, doc, [
      { label: 'Cancel', onClick: onClose, kind: 'secondary' },
      { label: 'Next →', onClick: () => { state.step = 2; rerender(); }, kind: 'primary',
        disabled: !validSummary(), validate: 'summaryOk' },
    ]);
  }

  function renderProposeStep() {
    const body = mkBody(doc, 'Propose a resolution',
      'What would resolve this for you?  Even if you\'re not sure, write what would feel "good enough" so the mediator has a starting point.');
    const validProposal = () => isProposalValid(state.proposal);
    mkTextarea(body, doc, 'Proposed resolution', state.proposal, (v) => {
      state.proposal = v;
      refreshActions(container, { proposalOk: validProposal });
    }, { placeholder: 'e.g. "an apology + agreement not to use my tools without asking"', rows: 4 });
    container.appendChild(body);
    mkActions(container, doc, [
      { label: '← Back', onClick: () => { state.step = 1; rerender(); }, kind: 'secondary' },
      { label: 'Cancel', onClick: onClose, kind: 'secondary' },
      { label: 'Next →', onClick: () => { state.step = 3; rerender(); }, kind: 'primary',
        disabled: !validProposal(), validate: 'proposalOk' },
    ]);
  }

  function renderFileStep() {
    const body = mkBody(doc, 'File the dispute',
      'Review + confirm.  Filed disputes are visible to admins (and mediators if you picked mediation).  You can withdraw via /leave-group → re-join, or via a follow-up post.');
    const dl = doc.createElement('dl');
    dl.className = 'cc-wizard-review';
    appendKV(dl, doc, 'Summary',          state.summary, { pre: true });
    if (state.aboutPostId) appendKV(dl, doc, 'About post', state.aboutPostId, { mono: true });
    appendKV(dl, doc, 'Escalation',       labelOf(ESCALATION_PATHS, state.escalation));
    appendKV(dl, doc, 'Proposed resolution', state.proposal, { pre: true });
    body.appendChild(dl);

    const warn = doc.createElement('div');
    warn.className = 'cc-wizard-warn';
    warn.textContent = '⚠️ V0 substrate gap: this files as a stoop post with kind:dispute. Full mediation flow (raiseDispute → proposeResolution → acceptResolution) lands when stoop ships those skills.';
    body.appendChild(warn);

    mkError(body, doc, state.submitError);
    mkSubmitting(body, doc, state.submitting, 'Filing dispute…');
    container.appendChild(body);
    mkActions(container, doc, [
      { label: '← Back',     onClick: () => { state.step = 2; rerender(); }, kind: 'secondary', disabled: state.submitting },
      { label: 'Cancel',     onClick: onClose, kind: 'secondary', disabled: state.submitting },
      { label: 'File',       onClick: async () => {
        rerender(); // show submitting state
        const { result } = await submitDispute({ state, callSkill });
        if (result && typeof onDispatched === 'function') {
          try { onDispatched({ ok: true, message: '✓ Dispute filed.', ...result }); } catch {}
        }
        rerender();
      }, kind: 'primary', disabled: state.submitting },
    ]);
  }
}

function renderSuccessStep(container, doc, state, onClose) {
  const body = mkBody(doc, '✓ Dispute filed',
    'Admins (and mediators if you picked mediation) will see it in the circle feed.');
  container.appendChild(body);
  mkActions(container, doc, [{ label: 'Done', onClick: onClose, kind: 'primary' }]);
}

function appendKV(dl, doc, label, value, opts = {}) {
  const dt = doc.createElement('dt'); dt.textContent = label;
  const dd = doc.createElement('dd');
  if (opts.pre) {
    const pre = doc.createElement('pre'); pre.className = 'cc-wizard-review-pre'; pre.textContent = value;
    dd.appendChild(pre);
  } else if (opts.mono) {
    const code = doc.createElement('code'); code.textContent = value;
    dd.appendChild(code);
  } else {
    dd.textContent = value;
  }
  dl.appendChild(dt); dl.appendChild(dd);
}

// labelOf moved to../../core/wizards/conflictDisputeState.js.
