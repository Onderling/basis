/**
 * **Platform: web** (DOM-dependent). RN parallel pending.
 *
 * basis — C1 create-group wizard (2026-05-24).
 *
 * 5-step wizard surfacing stoop.createGroupV2 — substantially richer
 * than C2 (join-group): 14 distinct configuration questions across
 * identity, governance, rules, and technical settings.  Lands the
 * circle + mints the first membership code (shown ONCE per stoop's
 * design — the user must copy it or it's lost).
 *
 * Substrate skill: stoop.createGroupV2
 * Returns: { groupId, code, expiresAt, ... } — the code is the
 * one-time-shown membership code for early members.
 *
 * Open via: /create-group  (no slash args needed; wizard collects
 * everything).  Custom renderer in main.js's WIZARD_RENDERERS map.
 */

// Policy catalogues + state helpers moved to
// ../../core/wizards/createGroupState.js so basis
// mobile's RN wizard can reuse them.
import {
  ACCESS_POLICIES, LEAVE_POLICIES, CONFLICT_POLICIES,
  STORAGE_POLICIES, KEY_ROTATION_MODES, STEP_NAMES,
  initialState, slugify, isValidSlug, labelOf,
  buildRulesObjectFromState, finalSubmit,
  newOfferingRow, OFFERING_AXES,
  // N1+E8 — kind picker + neighbourhood size/chat advice + policy patch.
  CIRCLE_KINDS, setKind, setSize, setChatEnabled, chatAdvice, policyPatchFromState,
  // N3 — extra role templates (admin opt-in).
  ROLE_TEMPLATE_IDS, toggleRole,
} from '../../core/wizards/createGroupState.js';
import { ROLE_TEMPLATES } from '../../v2/roleTemplates.js';
// B5 — the ceiling field. `markAxisTouched` so an explicit choice survives a kind switch (the same
// rule every other axis follows); the system cap comes from the module that ENFORCES it, so the
// wizard cannot offer a number the substrate would silently clamp.
import { markAxisTouched } from '../../v2/circleTemplates.js';
import { INVITE_REDEMPTION_SYSTEM_CAP } from '@onderling-app/stoop/lib/inviteCeiling';
import { RULES_QUESTIONS } from '../../v2/circleRules.js';
import { createCirclePolicyStore, localStoragePolicyIo } from '../../v2/circlePolicyStore.js';
import { consequenceKeyFor } from '../../v2/optionConsequences.js';
import { t } from '../../localisation.js';

/**
 * N1+E8 — persist the wizard's chosen policy axes (features incl. the
 * neighbourhood chat-off default, reveal/pod/llm/agents/consensus) onto the new
 * circle's policy, so the launcher's CONVERSATION gating honours
 * them.  Shares the launcher's localStorage key (`cc.circlePolicy.<id>`).
 * Only writes axes a template actually filled.  Best-effort.
 */
async function persistCreatedCirclePolicy(groupId, state) {
  if (!groupId || !state) return;
  const patch = policyPatchFromState(state);
  if (Object.keys(patch).length === 0) return;
  try {
    const store = createCirclePolicyStore(localStoragePolicyIo());
    await store.update(groupId, patch);
  } catch { /* policy write is best-effort; creation already succeeded */ }
}

/**
 * Wizard renderer for /create-group.
 *
 * @param {object}   opts
 * @param {HTMLElement} opts.container
 * @param {Document}    opts.doc
 * @param {object}      opts.args
 * @param {Function}    opts.callSkill
 * @param {Function}    opts.onClose
 * @param {Function}    [opts.onDispatched]
 */
export function renderCreateGroupWizard(opts) {
  const { container, doc, callSkill, onClose, onDispatched, getMyPeerAddr } = opts;

  const state = initialState();

  rerender();

  function rerender() {
    container.innerHTML = '';
    if (state.successResult) {
      renderSuccessStep(container, doc, state, onClose);
      return;
    }
    renderStepHeader(container, doc, state.step);
    if (state.step === 1) renderIdentityStep(container, doc, state, advance, onClose, rerender);
    if (state.step === 2) renderGovernanceStep(container, doc, state, advance, back, onClose, rerender);
    if (state.step === 3) renderRulesStep(container, doc, state, advance, back, onClose, rerender);
    if (state.step === 4) renderOfferingsStep(container, doc, state, advance, back, onClose, rerender);
    if (state.step === 5) renderTechStep(container, doc, state, advance, back, onClose, rerender);
    if (state.step === 6) renderReviewStep(container, doc, state, back, onClose, rerender, async () => {
      rerender(); // show submitting state
      const { result } = await finalSubmit({ state, callSkill });
      if (result) {
        // Stamp the current peer address on the success payload so the
        // invite URL we render carries the admin's peer-redeem target.
        // null / unavailable transport just means joiners can't fall
        // back to the peer path (they still get local + pod paths).
        result.adminPeerAddr = (typeof getMyPeerAddr === 'function') ? (getMyPeerAddr() ?? null) : null;
        // 2026-05-24 — also embed the rules in the invite URL so the
        // joiner's wizard step 1 can show them directly (their local
        // substrate has no group-rules item until after they join).
        result.rules = buildRulesObjectFromState(state);
        // N1+E8 — write the chosen policy (incl. neighbourhood chat-off) so the
        // new circle opens with the right surfaces.
        await persistCreatedCirclePolicy(result.groupId, state);
        state.successResult = result;
        if (typeof onDispatched === 'function') {
          try { onDispatched({ ok: true, message: `✓ Circle "${result.groupId}" created.`, ...result }); } catch { /* swallow */ }
        }
      }
      rerender();
    });
  }
  function advance() { if (state.step < STEP_NAMES.length) { state.step += 1; rerender(); } }
  function back()    { if (state.step > 1) { state.step -= 1; rerender(); } }
}

/* ─── step renderers ───────────────────────────────────────── */

// STEP_NAMES moved to../../core/wizards/createGroupState.js.

function renderStepHeader(container, doc, step) {
  const header = doc.createElement('div');
  header.className = 'cc-wizard-steps';
  for (let n = 1; n <= 5; n++) {
    const dot = doc.createElement('span');
    dot.className = `cc-wizard-step ${n === step ? 'cc-wizard-step-active' : ''} ${n < step ? 'cc-wizard-step-done' : ''}`;
    dot.textContent = STEP_NAMES[n - 1];
    header.appendChild(dot);
  }
  container.appendChild(header);
}

function renderIdentityStep(container, doc, state, onNext, onCancel, rerender) {
  const wrap = makeBody(doc, 'Circle identity & purpose',
    'A circle is a closed group with its own posts, members, and rules.');

  // N1+E8 — kind picker.  Picking a kind applies the matching template
  // (β.4) in place; for a neighbourhood it also surfaces the size question +
  // chat advice (neighbourhood is noticeboard-first, open chat off by default).
  appendRadioField(wrap, doc, t('circle.kindPicker'), state.kind ?? null,
    CIRCLE_KINDS.map((k) => ({ id: k, label: t(`circle.kind.${k}`) })),
    (k) => { Object.assign(state, setKind(state, k)); rerender(); },
    { consequenceGroup: 'kind' });

  if (state.kind === 'neighbourhood') {
    appendRadioField(wrap, doc, t('circle.size.label'), state.size ?? null,
      [{ id: 'small', label: t('circle.size.small') },
       { id: 'large', label: t('circle.size.large') }],
      (sz) => { Object.assign(state, setSize(state, sz)); rerender(); },
      { consequenceGroup: 'size' });
    appendChatAdvice(wrap, doc, state, rerender);
  }

  // The name input updates the auto-derived groupId field WITHOUT
  // rerendering the panel (which would lose focus).  We grab a
  // direct reference to the groupId input after it's appended +
  // mutate its .value on each keystroke.
  let groupIdInputRef = null;
  const refreshNextBtn = () => refreshActionsLocal(container, () =>
    !!state.name.trim() && isValidSlug(state.groupId));

  appendField(wrap, doc, 'Name *', 'name',
    state.name, (v) => {
      state.name = v;
      // Re-derive groupId only if user hasn't manually edited it.
      const derived = slugify(v);
      state.groupId = derived;
      if (groupIdInputRef) groupIdInputRef.value = derived;
      refreshNextBtn();
    },
    { placeholder: 'e.g. Circle Westend' });
  appendField(wrap, doc, 'Circle id *', 'groupId',
    state.groupId, (v) => { state.groupId = v; refreshNextBtn(); },
    { placeholder: 'auto-slugified from name', monospace: true,
      hint: 'Lowercase letters, digits, hyphens. Must be unique.' });
  // Capture a ref to the groupId input we just appended (it's the
  // second `.cc-wizard-input` in the wrap).
  groupIdInputRef = wrap.querySelectorAll('.cc-wizard-input')[1] ?? null;

  appendField(wrap, doc, 'Purpose', 'purpose',
    state.purpose, (v) => { state.purpose = v; },
    { placeholder: 'One sentence: what is this circle for?' });
  appendField(wrap, doc, 'Tags (CSV)', 'tags',
    state.tags, (v) => { state.tags = v; },
    { placeholder: 'e.g. neighbourhood, tools, kids' });

  container.appendChild(wrap);
  renderActions(container, doc, [
    { label: 'Cancel', onClick: onCancel, kind: 'secondary' },
    { label: 'Next →', onClick: onNext, kind: 'primary',
      disabled: !state.name.trim() || !isValidSlug(state.groupId),
      validate: 'identityOk' },
  ]);
}

// Local refresh-helper for C1 — the wizardKit's refreshActions uses
// a predicates map; here we just refresh the single primary button.
function refreshActionsLocal(container, ok) {
  const btn = container.querySelector('button[data-cc-validate]');
  if (btn) btn.disabled = !ok();
}

function renderGovernanceStep(container, doc, state, onNext, onBack, onCancel, rerender) {
  const wrap = makeBody(doc, 'Members & governance',
    'Who runs the circle + how people join + how they leave.');

  appendField(wrap, doc, 'Additional admins (CSV of webids)', 'additionalAdmins',
    state.additionalAdmins, (v) => { state.additionalAdmins = v; },
    { placeholder: 'e.g. webid:anne,webid:karl',
      hint: 'You are admin by default. Add others now or invite later.' });
  appendRadioField(wrap, doc, 'Access policy', state.accessPolicy, ACCESS_POLICIES,
    (v) => { state.accessPolicy = v; rerender(); }, { consequenceGroup: 'accessPolicy' });
  appendRadioField(wrap, doc, 'Leave policy', state.leavePolicy, LEAVE_POLICIES,
    (v) => { state.leavePolicy = v; rerender(); }, { consequenceGroup: 'leavePolicy' });

  appendField(wrap, doc, 'Invite-code expiry (hours, 1-8760)', 'inviteExpiresInHours',
    String(state.inviteExpiresInHours),
    (v) => {
      const n = parseInt(v, 10);
      state.inviteExpiresInHours = Number.isFinite(n)
        ? Math.max(1, Math.min(8760, n)) : 1;
    },
    { type: 'number',
      hint: 'How long the membership-code stays redeemable. Short = safer for ad-hoc shares (1 h default). Long = good for slower onboarding (e.g. 168 = 1 week). Admin can /rotate-code later to mint a fresh one.' });

  // B5 — the invite CEILING, next to the invite expiry because they answer the same worry from two
  // sides: how long a leaked code lives, and how many people it can let in while it does.
  appendField(wrap, doc, t('circle.invite.ceiling_label'), 'inviteMaxRedemptions',
    String(state.inviteMaxRedemptions),
    (v) => {
      const n = parseInt(v, 10);
      state.inviteMaxRedemptions = Number.isFinite(n)
        ? Math.max(1, Math.min(INVITE_REDEMPTION_SYSTEM_CAP, n)) : 1;
      markAxisTouched(state, 'inviteMaxRedemptions');
    },
    { type: 'number', hint: t('circle.invite.ceiling_hint') });

  // N3 — extra role templates (admin opt-in).
  appendRoleChecklist(wrap, doc, state, rerender);

  container.appendChild(wrap);
  renderActions(container, doc, [
    { label: '← Back',  onClick: onBack,   kind: 'secondary' },
    { label: 'Cancel',  onClick: onCancel, kind: 'secondary' },
    { label: 'Next →',  onClick: onNext,   kind: 'primary' },
  ]);
}

function renderRulesStep(container, doc, state, onNext, onBack, onCancel, rerender) {
  const wrap = makeBody(doc, 'Rules & conflict resolution',
    'Members see these rules when they accept the invite + when they ask "what does this group expect of me?"');

  // 5.5a — render the v2 structured rules doc.  Step 1 already captured
  // `purpose` (the one-liner), so we skip that question here; the rules
  // step asks the other five (admins / agreements / conflict / admission /
  // leaving).  Question text is already in the locale file under
  // `circle.rules.q.<key>.text`.
  for (const q of RULES_QUESTIONS) {
    if (q.key === 'purpose') continue;
    const label = doc.createElement('div');
    label.className = 'cc-wizard-field-label';
    label.textContent = q.required
      ? `${t(`circle.rules.q.${q.key}.text`)} *`
      : t(`circle.rules.q.${q.key}.text`);
    wrap.appendChild(label);
    const ta = doc.createElement('textarea');
    ta.className = 'cc-wizard-textarea';
    ta.rows = 3;
    ta.value = state.rulesDoc[q.key] ?? '';
    ta.addEventListener('input', () => { state.rulesDoc[q.key] = ta.value; });
    wrap.appendChild(ta);
  }

  appendRadioField(wrap, doc, 'Conflict resolution policy', state.conflictPolicy, CONFLICT_POLICIES,
    (v) => { state.conflictPolicy = v; rerender(); }, { consequenceGroup: 'conflictPolicy' });

  container.appendChild(wrap);
  renderActions(container, doc, [
    { label: '← Back',  onClick: onBack,   kind: 'secondary' },
    { label: 'Cancel',  onClick: onCancel, kind: 'secondary' },
    { label: 'Next →',  onClick: onNext,   kind: 'primary' },
  ]);
}

// 5.5c — Offerings step: list `{name, openness, posture, status, radius}`
// rows.  Each row's four axes are radio groups over `OFFERING_AXES`.
// Unnamed rows are dropped at submit (see buildRulesObjectFromState).
function renderOfferingsStep(container, doc, state, onNext, onBack, onCancel, rerender) {
  const wrap = makeBody(doc, 'Offerings (optional)',
    'What members can do / offer in this circle.  Each offering is named + has four axes (openness / posture / status / radius).  You can skip this step or edit it later.');

  state.offerings.forEach((row, i) => {
    const card = doc.createElement('div');
    card.className = 'cc-wizard-offering-row';
    card.style.cssText = 'border:1px solid var(--cc-line,#d8d1bc);border-radius:6px;padding:10px;margin-bottom:10px';

    appendField(card, doc, 'Offering name', `offering-${i}-name`,
      row.name, (v) => { row.name = v; }, { placeholder: 'e.g. plumbing' });

    for (const axis of Object.keys(OFFERING_AXES)) {
      const opts = OFFERING_AXES[axis].map((id) => ({ id, label: id }));
      appendRadioField(card, doc, axis, row[axis], opts,
        (v) => { row[axis] = v; rerender(); }, { consequenceGroup: axis });
    }

    const del = doc.createElement('button');
    del.type = 'button';
    del.className = 'cc-wizard-cta-secondary';
    del.textContent = 'Remove offering';
    del.addEventListener('click', () => {
      state.offerings.splice(i, 1);
      rerender();
    });
    card.appendChild(del);
    wrap.appendChild(card);
  });

  const add = doc.createElement('button');
  add.type = 'button';
  add.className = 'cc-wizard-cta-secondary';
  add.textContent = '+ Add offering';
  add.addEventListener('click', () => {
    state.offerings.push(newOfferingRow());
    rerender();
  });
  wrap.appendChild(add);

  container.appendChild(wrap);
  renderActions(container, doc, [
    { label: '← Back',  onClick: onBack,   kind: 'secondary' },
    { label: 'Cancel',  onClick: onCancel, kind: 'secondary' },
    { label: 'Next →',  onClick: onNext,   kind: 'primary' },
  ]);
}

function renderTechStep(container, doc, state, onNext, onBack, onCancel, rerender) {
  const wrap = makeBody(doc, 'Tech & storage',
    'How the circle stores its data + how the encryption key rotates.');

  appendRadioField(wrap, doc, 'Storage policy', state.storagePolicy, STORAGE_POLICIES,
    (v) => { state.storagePolicy = v; rerender(); }, { consequenceGroup: 'storagePolicy' });

  // Conditional pod URI field for centralised/hybrid.
  if (state.storagePolicy === 'shared' || state.storagePolicy === 'hybrid') {
    appendField(wrap, doc, 'Group pod URI *', 'groupPodUri',
      state.groupPodUri, (v) => { state.groupPodUri = v; },
      { placeholder: 'https://group-pod.example/onderling/circle/',
        hint: 'Required for centralised + hybrid storage.', monospace: true });
    // NKN+pod circle (J-NP3) — the CREATE half of the disclosure shown at both ends: choosing a shared
    // pod means its host can see the membership. Said here, next to the choice that causes it, so the
    // creator decides with the fact in view rather than discovering it in a settings screen later.
    const podSees = doc.createElement('p');
    podSees.className = 'cc-wizard-pod-disclosure';
    podSees.textContent = t('circle.nearbyScreen.point_pod_host_sees');
    wrap.appendChild(podSees);
  }

  appendRadioField(wrap, doc, 'Key rotation mode', state.keyRotationMode, KEY_ROTATION_MODES,
    (v) => { state.keyRotationMode = v; rerender(); });

  appendField(wrap, doc, 'Key rotation interval (days, 1-365)', 'rotationDays',
    String(state.rotationDays),
    (v) => { state.rotationDays = Math.max(1, Math.min(365, parseInt(v, 10) || 30)); },
    { type: 'number',
      hint: 'How often the circle-wide encryption key rotates. 30 d default suits most circles; drop lower for higher-sensitivity groups. (Invite expiry is configured separately in Governance.)' });

  const needsUri = (state.storagePolicy === 'shared' || state.storagePolicy === 'hybrid');
  const uriOk    = !needsUri || /^https?:\/\//.test(state.groupPodUri.trim());

  container.appendChild(wrap);
  renderActions(container, doc, [
    { label: '← Back',  onClick: onBack,   kind: 'secondary' },
    { label: 'Cancel',  onClick: onCancel, kind: 'secondary' },
    { label: 'Review →',  onClick: onNext, kind: 'primary', disabled: !uriOk },
  ]);
}

function renderReviewStep(container, doc, state, onBack, onCancel, rerender, onSubmit) {
  const wrap = makeBody(doc, 'Review & create', 'Everything you\'ve configured.  After [Create circle] you\'ll get a one-time membership code to hand out.');

  const dl = doc.createElement('dl');
  dl.className = 'cc-wizard-review';
  appendReview(dl, doc, 'Name',           state.name);
  appendReview(dl, doc, 'Circle id',       state.groupId);
  if (state.purpose) appendReview(dl, doc, 'Purpose', state.purpose);
  if (state.tags)    appendReview(dl, doc, 'Tags', state.tags);
  if (state.additionalAdmins) appendReview(dl, doc, 'Additional admins', state.additionalAdmins);
  appendReview(dl, doc, 'Access policy',   labelOf(ACCESS_POLICIES, state.accessPolicy));
  appendReview(dl, doc, 'Leave policy',    labelOf(LEAVE_POLICIES, state.leavePolicy));
  appendReview(dl, doc, 'Invite expiry',   `${state.inviteExpiresInHours} h`);
  appendReview(dl, doc, t('circle.invite.ceiling_review'), String(state.inviteMaxRedemptions));
  // 5.5a — render each non-empty rules-doc field on its own row.
  for (const q of RULES_QUESTIONS) {
    if (q.key === 'purpose') continue;   // shown above via state.purpose
    const v = state.rulesDoc?.[q.key];
    if (v) appendReview(dl, doc, t(`circle.rules.q.${q.key}.text`), v, { pre: true });
  }
  appendReview(dl, doc, 'Conflict policy', labelOf(CONFLICT_POLICIES, state.conflictPolicy));
  // 5.5c — list named offerings with their axes.
  const namedOfferings = (state.offerings ?? []).filter((s) => s?.name?.trim());
  if (namedOfferings.length > 0) {
    const offeringsSummary = namedOfferings
      .map((s) => `${s.name} — ${s.openness}/${s.posture}/${s.status}/${s.radius}`)
      .join('\n');
    appendReview(dl, doc, 'Offerings', offeringsSummary, { pre: true });
  }
  appendReview(dl, doc, 'Storage',        labelOf(STORAGE_POLICIES, state.storagePolicy));
  if (state.groupPodUri) appendReview(dl, doc, 'Group pod URI', state.groupPodUri);
  appendReview(dl, doc, 'Key rotation',   labelOf(KEY_ROTATION_MODES, state.keyRotationMode));
  appendReview(dl, doc, 'Rotation days',  String(state.rotationDays));
  wrap.appendChild(dl);

  if (state.submitError) {
    const err = doc.createElement('div');
    err.className = 'cc-wizard-error';
    err.textContent = state.submitError;
    wrap.appendChild(err);
  }
  if (state.submitting) {
    const status = doc.createElement('div');
    status.className = 'cc-wizard-submitting';
    status.textContent = 'Creating circle…';
    wrap.appendChild(status);
  }

  container.appendChild(wrap);
  renderActions(container, doc, [
    { label: '← Back',         onClick: onBack,                       kind: 'secondary', disabled: state.submitting },
    { label: 'Cancel',         onClick: onCancel,                     kind: 'secondary', disabled: state.submitting },
    { label: 'Create circle',   onClick: onSubmit,                     kind: 'primary',   disabled: state.submitting },
  ]);
}

function renderSuccessStep(container, doc, state, onClose) {
  const wrap = makeBody(doc, '✓ Circle created', `${state.successResult.groupId} is live.`);

  // Encode {kind, groupId, code, expiresAt, adminPeerAddr?} as a onderling-invite://
  // URL so the invitee can paste a single string into /join-group.  The
  // wizard's decoder reads `kind` to pick the right substrate path; if
  // `adminPeerAddr` is set, the joiner falls back to a peer-redeem when its
  // local substrate has no copy of the code (cross-browser/-device).
  const inviteUrl = encodeMembershipCodeUrl(state.successResult);

  // ── QR block (primary on mobile — scan + done) ──
  const qrLabel = doc.createElement('div');
  qrLabel.className = 'cc-wizard-field-label';
  qrLabel.textContent = 'Scan the QR with the invitee\'s phone (or copy the URL below)';
  wrap.appendChild(qrLabel);

  const canvas = doc.createElement('canvas');
  canvas.className = 'cc-field-qr-canvas';
  canvas.width = 240; canvas.height = 240;
  canvas.style.display = 'block';
  canvas.style.maxWidth = '240px';
  canvas.style.background = '#fff';
  canvas.style.margin = '0.4rem auto';
  wrap.appendChild(canvas);

  // Lazy-load qrcode; renders into the canvas.
  import('qrcode').then((mod) => {
    const qrcode = mod.default ?? mod;
    qrcode.toCanvas(canvas, inviteUrl, {
      width: 240, margin: 1, errorCorrectionLevel: 'M',
    }, (err) => {
      if (err && typeof console !== 'undefined') {
        console.warn('[createGroupWizard] QR render failed', err);
      }
    });
  }).catch((err) => {
    if (typeof console !== 'undefined') {
      console.warn('[createGroupWizard] qrcode lib failed to load', err);
    }
  });

  // ── URL block (fallback / desktop copy-paste) ──
  const urlRow = doc.createElement('div');
  urlRow.className = 'cc-wizard-code-row';
  const urlText = doc.createElement('code');
  urlText.className = 'cc-wizard-code';
  urlText.textContent = inviteUrl;
  urlText.style.fontSize = '0.65rem';
  urlText.style.wordBreak = 'break-all';
  urlRow.appendChild(urlText);

  const copyUrlBtn = doc.createElement('button');
  copyUrlBtn.type = 'button';
  copyUrlBtn.className = 'cc-wizard-btn cc-wizard-btn-secondary';
  copyUrlBtn.textContent = 'Copy URL';
  copyUrlBtn.addEventListener('click', () => {
    try {
      void navigator.clipboard.writeText(inviteUrl);
      copyUrlBtn.textContent = 'Copied!';
      setTimeout(() => { copyUrlBtn.textContent = 'Copy URL'; }, 1500);
    } catch { /* clipboard API unavailable */ }
  });
  urlRow.appendChild(copyUrlBtn);
  wrap.appendChild(urlRow);

  // ── Raw code block (fallback for voice / SMS share) ──
  const codeLabel = doc.createElement('div');
  codeLabel.className = 'cc-wizard-field-label';
  codeLabel.style.marginTop = '0.8rem';
  codeLabel.textContent = 'Or share groupId + code separately:';
  wrap.appendChild(codeLabel);

  const idRow = doc.createElement('div');
  idRow.className = 'cc-wizard-code-row';
  const idText = doc.createElement('code');
  idText.className = 'cc-wizard-code';
  idText.textContent = `groupId: ${state.successResult.groupId}`;
  idRow.appendChild(idText);
  wrap.appendChild(idRow);

  const codeRow = doc.createElement('div');
  codeRow.className = 'cc-wizard-code-row';
  const codeText = doc.createElement('code');
  codeText.className = 'cc-wizard-code';
  codeText.textContent = `code: ${state.successResult.code}`;
  codeRow.appendChild(codeText);
  const copyCodeBtn = doc.createElement('button');
  copyCodeBtn.type = 'button';
  copyCodeBtn.className = 'cc-wizard-btn cc-wizard-btn-secondary';
  copyCodeBtn.textContent = 'Copy code';
  copyCodeBtn.addEventListener('click', () => {
    try {
      void navigator.clipboard.writeText(state.successResult.code);
      copyCodeBtn.textContent = 'Copied!';
      setTimeout(() => { copyCodeBtn.textContent = 'Copy code'; }, 1500);
    } catch { /* clipboard API unavailable */ }
  });
  codeRow.appendChild(copyCodeBtn);
  wrap.appendChild(codeRow);

  const expires = state.successResult.expiresAt
    ? new Date(state.successResult.expiresAt).toLocaleString()
    : '(no expiry)';
  const hint = doc.createElement('p');
  hint.className = 'cc-wizard-blurb';
  hint.style.marginTop = '0.8rem';
  hint.textContent = `Expires ${expires}.  After expiry: /rotate-code to mint a fresh one.  ⚠️ This is the ONLY time the code is shown — save it now.`;
  wrap.appendChild(hint);

  container.appendChild(wrap);
  renderActions(container, doc, [
    { label: 'Done', onClick: onClose, kind: 'primary' },
  ]);
}

function encodeMembershipCodeUrl(result) {
  const payload = {
    kind:      'membershipCode',
    groupId:   result.groupId,
    code:      result.code,
    expiresAt: result.expiresAt,
    // Optional: admin's peer address for peer-redeem fallback when the
    // joiner has no local copy of the code (cross-browser/-device).
    ...(result.adminPeerAddr ? { adminPeerAddr: result.adminPeerAddr } : {}),
    // 2026-05-24 — embed the rules object so the joiner's wizard can
    // show them without needing to fetch from the admin's substrate
    // (joiner has no local group-rules item for groups they haven't
    // joined yet).  Compact: only the fields with values.
    ...(result.rules ? { rules: result.rules } : {}),
  };
  const json = JSON.stringify(payload);
  if (typeof globalThis.btoa !== 'function') return `onderling-invite://${json}`;
  const b64 = globalThis.btoa(json)
    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  return `onderling-invite://${b64}`;
}

/* ─── helpers ──────────────────────────────────────────────── */

function makeBody(doc, heading, blurb) {
  const wrap = doc.createElement('div');
  wrap.className = 'cc-wizard-body';
  const h = doc.createElement('h3');
  h.textContent = heading;
  wrap.appendChild(h);
  if (blurb) {
    const p = doc.createElement('p');
    p.className = 'cc-wizard-blurb';
    p.textContent = blurb;
    wrap.appendChild(p);
  }
  return wrap;
}

function appendField(wrap, doc, label, name, value, onInput, extra = {}) {
  const labelEl = doc.createElement('label');
  labelEl.className = 'cc-wizard-field';
  const labelText = doc.createElement('span');
  labelText.className = 'cc-wizard-field-label';
  labelText.textContent = label;
  labelEl.appendChild(labelText);
  const input = doc.createElement('input');
  input.type = extra.type ?? 'text';
  input.className = `cc-wizard-input${extra.monospace ? ' cc-wizard-input-mono' : ''}`;
  input.value = value;
  if (extra.placeholder) input.placeholder = extra.placeholder;
  input.addEventListener('input', () => onInput(input.value));
  labelEl.appendChild(input);
  if (extra.hint) {
    const hint = doc.createElement('span');
    hint.className = 'cc-wizard-field-hint';
    hint.textContent = extra.hint;
    labelEl.appendChild(hint);
  }
  wrap.appendChild(labelEl);
}

function appendRadioField(wrap, doc, label, value, options, onPick, opts = {}) {
  // N2 — `opts.consequenceGroup` lights up a per-option ⓘ ("Gevolgen
  // als je dit kiest…") for any option registered in optionConsequences.
  const consequenceGroup = opts.consequenceGroup ?? null;
  const group = doc.createElement('fieldset');
  group.className = 'cc-wizard-radio-group';
  const legend = doc.createElement('legend');
  legend.className = 'cc-wizard-field-label';
  legend.textContent = label;
  group.appendChild(legend);
  for (const o of options) {
    const optWrap = doc.createElement('div');
    optWrap.className = 'cc-radio-option';
    const row = doc.createElement('label');
    row.className = 'cc-wizard-radio';
    const input = doc.createElement('input');
    input.type = 'radio';
    input.name = `radio-${legend.textContent}`;
    input.value = o.id;
    input.checked = value === o.id;
    input.addEventListener('change', () => onPick(o.id));
    row.appendChild(input);
    row.appendChild(doc.createTextNode(' ' + o.label));

    const key = consequenceGroup ? consequenceKeyFor(consequenceGroup, o.id) : null;
    if (key) {
      // ⓘ button (inside the label so it sits inline, but a <button>
      // inside a <label> does NOT toggle the radio) + a hidden note.
      const info = doc.createElement('button');
      info.type = 'button';
      info.className = 'cc-radio-info';
      info.textContent = 'ⓘ';
      info.title = t('common.consequences');
      info.setAttribute('aria-label', t('common.consequences'));
      info.setAttribute('aria-expanded', 'false');
      const note = doc.createElement('p');
      note.className = 'cc-radio-consequence';
      note.textContent = t(key);
      note.hidden = true;
      info.addEventListener('click', (e) => {
        e.preventDefault();
        note.hidden = !note.hidden;
        info.setAttribute('aria-expanded', String(!note.hidden));
      });
      row.appendChild(info);
      optWrap.appendChild(row);
      optWrap.appendChild(note);
    } else {
      optWrap.appendChild(row);
    }
    group.appendChild(optWrap);
  }
  wrap.appendChild(group);
}

// N1 — neighbourhood chat advice banner + the open-chat toggle.  The banner's
// emphasis tracks the recommendation mode (`advise-off` is the loudest;
// `ask` is neutral).  The toggle writes through `setChatEnabled` so a
// user override is remembered (`chatUserSet`).
// N3 — "Extra roles (optional)" checklist.  A circle defaults to
// admin + member; the admin opts into a starter role from a template.
// Each row shows the role name + a "what it can do" note.  Selected ids
// persist into rules.roles at submit.
function appendRoleChecklist(wrap, doc, state, rerender) {
  const group = doc.createElement('fieldset');
  group.className = 'cc-wizard-radio-group';
  const legend = doc.createElement('legend');
  legend.className = 'cc-wizard-field-label';
  legend.textContent = t('role.extraRolesLabel');
  group.appendChild(legend);
  const hint = doc.createElement('p');
  hint.className = 'cc-radio-consequence';
  hint.style.cssText = 'margin-left:0;border-left:none;padding-left:0';
  hint.textContent = t('role.extraRolesHint');
  group.appendChild(hint);

  const selected = Array.isArray(state.extraRoles) ? state.extraRoles : [];
  for (const tid of ROLE_TEMPLATE_IDS) {
    const tpl = ROLE_TEMPLATES[tid];
    const optWrap = doc.createElement('div');
    optWrap.className = 'cc-radio-option';
    const row = doc.createElement('label');
    row.className = 'cc-wizard-toggle';
    const cb = doc.createElement('input');
    cb.type = 'checkbox';
    cb.checked = selected.includes(tid);
    cb.dataset.role = tid;
    cb.addEventListener('change', () => {
      Object.assign(state, toggleRole(state, tid));
      rerender();
    });
    row.appendChild(cb);
    row.appendChild(doc.createTextNode(' ' + t(tpl.labelKey)));
    optWrap.appendChild(row);
    const note = doc.createElement('p');
    note.className = 'cc-radio-consequence';
    note.textContent = t(tpl.descKey);
    optWrap.appendChild(note);
    group.appendChild(optWrap);
  }
  wrap.appendChild(group);
}

function appendChatAdvice(wrap, doc, state, rerender) {
  const adv = chatAdvice(state);
  if (adv.reasonKey) {
    const note = doc.createElement('p');
    note.className = `cc-wizard-advice cc-wizard-advice-${adv.mode}`;
    note.textContent = t(adv.reasonKey);
    wrap.appendChild(note);
  }
  const row = doc.createElement('label');
  row.className = 'cc-wizard-toggle';
  const cb = doc.createElement('input');
  cb.type = 'checkbox';
  cb.checked = !!state.features?.chat;
  cb.addEventListener('change', () => {
    Object.assign(state, setChatEnabled(state, cb.checked));
    rerender();
  });
  row.appendChild(cb);
  row.appendChild(doc.createTextNode(' ' + t('circle.chatToggle')));
  wrap.appendChild(row);
}

function appendReview(dl, doc, label, value, opts = {}) {
  const dt = doc.createElement('dt');
  dt.textContent = label;
  const dd = doc.createElement('dd');
  if (opts.pre) {
    const pre = doc.createElement('pre');
    pre.className = 'cc-wizard-review-pre';
    pre.textContent = value;
    dd.appendChild(pre);
  } else {
    dd.textContent = value;
  }
  dl.appendChild(dt);
  dl.appendChild(dd);
}

function renderActions(container, doc, buttons) {
  const row = doc.createElement('div');
  row.className = 'cc-wizard-actions';
  for (const b of buttons) {
    const btn = doc.createElement('button');
    btn.type = 'button';
    btn.className = `cc-wizard-btn cc-wizard-btn-${b.kind ?? 'secondary'} ${b.className ?? ''}`.trim();
    btn.textContent = b.label;
    btn.disabled = !!b.disabled;
    if (b.validate) btn.setAttribute('data-cc-validate', b.validate);
    btn.addEventListener('click', b.onClick);
    row.appendChild(btn);
  }
  container.appendChild(row);
}

// slugify, isValidSlug, labelOf, buildRulesObjectFromState, finalSubmit
// moved to../../core/wizards/createGroupState.js.
