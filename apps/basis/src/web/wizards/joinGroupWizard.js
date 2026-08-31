/**
 * **Platform: web** (DOM-dependent). RN parallel pending +
 * (chat-nav RN + RN renderer port).
 *
 * basis — C2 join-group wizard (2026-05-24).
 *
 * 3-step rules-gate wizard that lands new circle members.  First
 * customRenderer hook on the `openPagePanel` infrastructure;
 * the pattern here is the template other Cluster C wizards reuse.
 *
 * Flow:
 *   /join-group <invite-url>  → opens panel
 *   Step 1: parse invite → fetch group rules → show rules text →
 *           [Accept rules] required to advance
 *   Step 2: show privacy notice → [I accept] required to advance
 *   Step 3: pick a handle (text input + 3 suggestions) → submit
 *           chains redeemInviteWithGate + setMyHandle + redeemInvite
 *           in sequence; on success closes the panel + emits success.
 *
 * Substrate skills exercised:
 *   stoop.getGroupRules      → step 1's rules text
 *   stoop.redeemInviteWithGate → step 3's gated redeem (writes
 *                                rules-accept audit item)
 *   stoop.setMyHandle        → step 3's handle binding
 *   stoop.redeemInvite       → step 3's actual GroupManager redeem
 *
 * Args expected: `{ invite: <string|object> }`.  String form is the
 * `onderling-invite://<base64url-encoded-invite-object>` URL surfaced by
 * the QR rendering in /invite (A9, 7). Object form: the
 * already-decoded invite per stoop's GroupManager.issueInvite shape.
 */

// State-machine pieces (decodeInvite, summariseEmbeddedRules,
// fetchGroupRules, isValidHandle, handleSuggestions, finalSubmit,
// PRIVACY_NOTICE) moved to ../../core/wizards/joinGroupState.js
// so basis-mobile's RN wizard can reuse them.
import {
  handleSuggestions as HANDLE_SUGGESTIONS,
  decodeInvite,
  isValidHandle,
  initialState,
  fetchGroupRules,
  finalSubmit,
  buildJoinConsent,
  setConsentDecline,
  loadPersonas,
  setPersona,
  applyCharterOfferingsDefault,
  setShareOfferingsAtJoin,
  prepareJoinIdentity,
  setLinkChoice,
  setJoinReveal,
  REVEAL_PRESETS, isJoinDirty } from '../../core/wizards/joinGroupState.js';
import { RULES_FIELDS } from '../../v2/circleRules.js';
import { t } from '../../localisation.js';

/**
 * Wizard renderer for /join-group.  Wired via openPagePanel's
 * `customRenderer` hook in main.js (see joinGroupOpenWizard).
 *
 * @param {object}   opts
 * @param {HTMLElement} opts.container   the panel body
 * @param {Document}    opts.doc
 * @param {object}      opts.args        `{ invite: string|object }`
 * @param {Function}    opts.callSkill   (appOrigin, opId, args) → Promise<payload>
 * @param {Function}    opts.onClose     close the panel
 * @param {Function}    [opts.onDispatched]  fired after final success with the redeemInvite reply
 */
export function renderJoinGroupWizard(opts) {
  const { container, doc, args, callSkill, onClose, onDispatched, sendPeerRedeem, sources, setCloseGuard,
    circles, circleAddressFor, signCircleLink,
    // J-CP1 — the host's seam for connecting to the endpoint the invite names, before the redeem.
    dialEndpoint, activeEndpointUrl } = opts;

  // Wizard state — kept in-scope, re-renders rebuild the DOM from it.
  const state = initialState();

  // Decode the invite arg (URL form or pre-decoded object).
  decodeInvite(args?.invite, state);

  // build the join-time capability consent model from the invite's embedded freedom
  // template + the host-injected manifest sources. No template / no sources ⇒ empty model (no-op step).
  buildJoinConsent({ state, sources });

  // Fold-in phase C — the charter-driven skill-sharing default: a skills-matching circle
  // (invite.offeringsMatching) pre-checks "share my skills as category" VISIBLY on step 3; any other
  // circle (incl. older invites) keeps default-withhold. Logic lives once, in the shared state.
  applyCharterOfferingsDefault(state);

  // Kick off the rules fetch when state.step === 1.
  if (state.invite && !state.inviteParseError) {
    fetchGroupRules({ state, callSkill }).then(rerender).catch((err) => {
      state.rulesError = err?.message ?? String(err);
      rerender();
    });
    // Property layer — load the join-with-persona options in the background so
    // the step-3 picker is populated by the time the joiner reaches it. Failure
    // is silent (empty list → picker offers only "join minimally").
    loadPersonas({ callSkill }).then((personas) => { state.personas = personas; rerender(); }).catch(() => {});
    // #4 — background-load the join-time identity inputs (prior handles + the existing-selves
    // list for the "continue as an existing self" key choice). Failure leaves safe defaults.
    prepareJoinIdentity({ state, callSkill, circles }).then(rerender).catch(() => {});
  }

  // Dismissing by clicking outside the card used to discard a half-filled join without a word — the same
  // fault the phone had with its hardware back button. The host asks this before closing that way; the
  // explicit Cancel button is untouched, since that one is the person saying so. A host that does not
  // offer the seam behaves exactly as before.
  setCloseGuard?.(() => !isJoinDirty(state)
    || globalThis.confirm?.(t('circle.join.wizard.discard_body')) === true);

  rerender();

  function rerender() {
    container.innerHTML = '';
    renderStepHeader(container, doc, state);
    if (state.inviteParseError) {
      renderError(container, doc, state.inviteParseError, onClose);
      return;
    }
    if (state.step === 1) renderRulesStep(container, doc, state, () => { state.step = 2; rerender(); }, onClose, rerender);
    if (state.step === 2) renderPrivacyStep(container, doc, state, () => { state.step = 3; rerender(); }, () => { state.step = 1; rerender(); }, onClose, rerender);
    if (state.step === 3) renderHandleStep(container, doc, state, async () => {
      rerender(); // show submitting state
      const { result } = await finalSubmit({
        state, callSkill, sendPeerRedeem, circleAddressFor, signCircleLink, dialEndpoint, activeEndpointUrl,
      });
      if (result) {
        if (typeof onDispatched === 'function') {
          try { onDispatched(result); } catch { /* swallow */ }
        }
        onClose();
        return;
      }
      rerender(); // failure path: show submitError
    }, () => { state.step = 2; rerender(); }, onClose, rerender);
  }
}

/* ─── step renderers ───────────────────────────────────────── */

function renderStepHeader(container, doc, state) {
  const header = doc.createElement('div');
  header.className = 'cc-wizard-steps';
  for (let n = 1; n <= 3; n++) {
    const dot = doc.createElement('span');
    dot.className = `cc-wizard-step ${n === state.step ? 'cc-wizard-step-active' : ''} ${n < state.step ? 'cc-wizard-step-done' : ''}`;
    dot.textContent = [t('circle.join.wizard.steps.rules'), t('circle.join.wizard.steps.privacy'), t('circle.join.wizard.steps.handle')][n - 1];
    header.appendChild(dot);
  }
  container.appendChild(header);
}

function renderRulesStep(container, doc, state, onNext, onCancel, rerender) {
  const wrap = doc.createElement('div');
  wrap.className = 'cc-wizard-body';

  const heading = doc.createElement('h3');
  // The circle's name when the invite carries it (L55); the id is the honest fallback for older invites.
  heading.textContent = t('circle.join.wizard.rules.title', { circle: state.invite?.name || state.invite?.groupId || '(unknown)' });
  wrap.appendChild(heading);

  const blurb = doc.createElement('p');
  blurb.className = 'cc-wizard-blurb';
  blurb.textContent = t('circle.join.wizard.rules.intro');
  wrap.appendChild(blurb);

  // NKN+pod circle (J-NP3) — the pod-host disclosure, BEFORE redeeming. The invite carries `podBacked`
  // precisely so this can be said to the JOINER: Anna saw it at create, and her accepting it on Bo's
  // behalf is the pattern the disclosure model exists to prevent. Absent on older / non-pod invites.
  if (state.invite?.podBacked === true) {
    const podSees = doc.createElement('p');
    podSees.className = 'cc-wizard-pod-disclosure';
    podSees.textContent = t('circle.nearbyScreen.point_pod_host_sees');
    wrap.appendChild(podSees);
  }

  // 5.5b — when the invite carries a v2 structured rules doc, render
  // each non-blank field as its own section (question + answer).  This
  // matches the create-wizard's authoring shape, so a joiner sees the
  // doc back in the exact format the admin filled it in.  Older invites
  // (rulesText only) and the loading / error states fall back to the
  // legacy <pre> blob.
  if (state.rulesDoc) {
    const docEl = doc.createElement('div');
    docEl.className = 'cc-wizard-rules-doc';
    for (const key of RULES_FIELDS) {
      const v = state.rulesDoc[key];
      if (!v || !v.trim()) continue;
      const sec = doc.createElement('section');
      sec.className = 'cc-wizard-rules-doc-field';
      sec.dataset.field = key;
      const h = doc.createElement('h4');
      h.className = 'cc-wizard-rules-doc-q';
      h.textContent = t(`circle.rules.q.${key}`);
      const p = doc.createElement('p');
      p.className = 'cc-wizard-rules-doc-a';
      p.textContent = v;
      sec.append(h, p);
      docEl.appendChild(sec);
    }
    wrap.appendChild(docEl);
  } else {
    const rulesBox = doc.createElement('pre');
    rulesBox.className = 'cc-wizard-rules';
    rulesBox.textContent = state.rulesError
      ? t('circle.join.wizard.rules.load_error', { error: state.rulesError })
      : state.rulesText ?? t('circle.join.wizard.rules.loading');
    wrap.appendChild(rulesBox);
  }

  const checkRow = doc.createElement('label');
  checkRow.className = 'cc-wizard-check';
  const check = doc.createElement('input');
  check.type = 'checkbox';
  check.checked = state.rulesAccepted;
  check.addEventListener('change', () => {
    state.rulesAccepted = check.checked;
    rerender();
  });
  checkRow.appendChild(check);
  checkRow.appendChild(doc.createTextNode(` ${t('circle.join.wizard.rules.accept')}`));
  wrap.appendChild(checkRow);

  // consent-at-join: the circle's OPT-OUTABLE capabilities. Rendered as part of the
  // Agree/Decline screen; unchecking a cap records an opt-out into state.capabilityOptOuts, which the
  // host writes to the member's prefs so the gate's effective set (admin ∩ user) drops it from join.
  renderConsentCaps(wrap, doc, state, rerender);

  container.appendChild(wrap);
  renderActions(container, doc, [
    { label: t('circle.join.wizard.cancel'), onClick: onCancel, kind: 'secondary' },
    { label: t('circle.join.wizard.next'), onClick: onNext, disabled: !state.rulesAccepted, kind: 'primary' },
  ]);
}

/**
 * the join-time capability consent section. Lists the circle's opt-outable caps (from
 * `state.consentModel`, built off the invite's freedom template). A checked box = "I take part";
 * unchecking opts out. Renders nothing when the model is empty (no template / all-mandatory).
 */
function renderConsentCaps(wrap, doc, state, rerender) {
  const items = Array.isArray(state.consentModel?.items) ? state.consentModel.items : [];
  if (items.length === 0) return;

  const sec = doc.createElement('section');
  sec.className = 'cc-wizard-consent';

  const h = doc.createElement('h4');
  h.className = 'cc-wizard-consent-title';
  h.textContent = t('circle.join.consent.title');
  sec.appendChild(h);

  const blurb = doc.createElement('p');
  blurb.className = 'cc-wizard-consent-blurb';
  blurb.textContent = t('circle.join.consent.blurb');
  sec.appendChild(blurb);

  const declined = new Set(Array.isArray(state.capabilityOptOuts) ? state.capabilityOptOuts : []);
  for (const cap of items) {
    const row = doc.createElement('label');
    row.className = 'cc-wizard-consent-cap';
    row.dataset.cap = cap.key;
    const box = doc.createElement('input');
    box.type = 'checkbox';
    box.dataset.cap = cap.key;
    box.checked = !declined.has(cap.key);   // checked = take part; unchecked = opt out
    box.addEventListener('change', () => {
      setConsentDecline(state, cap.key, !box.checked);
      rerender();
    });
    const floorTag = cap.privacyFloor
      ? ` (${t('circle.settings.privacyFloor')})`
      : '';
    const label = `${t(`circle.settings.verb.${cap.atom}`, { defaultValue: cap.atom })} · ${cap.noun}${floorTag}`;
    row.append(box, doc.createTextNode(` ${label}`));
    sec.appendChild(row);
  }
  wrap.appendChild(sec);
}

function renderPrivacyStep(container, doc, state, onNext, onBack, onCancel, rerender) {
  const wrap = doc.createElement('div');
  wrap.className = 'cc-wizard-body';

  const heading = doc.createElement('h3');
  heading.textContent = t('circle.join.wizard.privacy.title');
  wrap.appendChild(heading);

  const notice = doc.createElement('p');
  notice.className = 'cc-wizard-privacy';
  notice.textContent = t('circle.join.wizard.privacy.notice');
  wrap.appendChild(notice);

  const checkRow = doc.createElement('label');
  checkRow.className = 'cc-wizard-check';
  const check = doc.createElement('input');
  check.type = 'checkbox';
  check.checked = state.privacyAccepted;
  check.addEventListener('change', () => {
    state.privacyAccepted = check.checked;
    rerender();
  });
  checkRow.appendChild(check);
  checkRow.appendChild(doc.createTextNode(` ${t('circle.join.wizard.privacy.accept')}`));
  wrap.appendChild(checkRow);

  // mesh address-sharing consent. When on,
  // admin propagates this joiner's peer address to other consenting
  // members + propagates other consenting members' addresses to
  // this joiner.  When off, the joiner only talks to admin (star
  // routing); other members can't DM directly.
  const meshRow = doc.createElement('label');
  meshRow.className = 'cc-wizard-check';
  const meshBox = doc.createElement('input');
  meshBox.type = 'checkbox';
  meshBox.checked = state.shareAddress;
  meshBox.addEventListener('change', () => {
    state.shareAddress = meshBox.checked;
  });
  meshRow.appendChild(meshBox);
  meshRow.appendChild(doc.createTextNode(` ${t('circle.join.wizard.privacy.mesh')}`));
  wrap.appendChild(meshRow);
  const meshHint = doc.createElement('div');
  meshHint.className = 'cc-wizard-field-hint';
  meshHint.textContent = t('circle.join.wizard.privacy.mesh_hint');
  wrap.appendChild(meshHint);

  container.appendChild(wrap);
  renderActions(container, doc, [
    { label: t('circle.join.wizard.back'),   onClick: onBack,   kind: 'secondary' },
    { label: t('circle.join.wizard.cancel'), onClick: onCancel, kind: 'secondary' },
    { label: t('circle.join.wizard.next'),   onClick: onNext, disabled: !state.privacyAccepted, kind: 'primary' },
  ]);
}

function renderHandleStep(container, doc, state, onSubmit, onBack, onCancel, rerender) {
  const wrap = doc.createElement('div');
  wrap.className = 'cc-wizard-body';

  const heading = doc.createElement('h3');
  heading.textContent = t('circle.join.wizard.handle.title');
  wrap.appendChild(heading);

  const blurb = doc.createElement('p');
  blurb.className = 'cc-wizard-blurb';
  blurb.textContent = t('circle.join.wizard.handle.intro');
  wrap.appendChild(blurb);

  const input = doc.createElement('input');
  input.type = 'text';
  input.className = 'cc-wizard-handle-input';
  input.value = state.handle;
  input.placeholder = t('circle.join.wizard.handle.placeholder');
  input.addEventListener('input', () => {
    state.handle = input.value.trim();
    // Don't re-render on every keystroke to preserve focus + caret;
    // only refresh the submit button's disabled state.
    const submitBtn = container.querySelector('.cc-wizard-submit');
    if (submitBtn) submitBtn.disabled = !isValidHandle(state.handle) || state.submitting;
  });
  wrap.appendChild(input);

  const suggestions = doc.createElement('div');
  suggestions.className = 'cc-wizard-suggestions';
  for (const s of HANDLE_SUGGESTIONS()) {
    const chip = doc.createElement('button');
    chip.type = 'button';
    chip.className = 'cc-wizard-suggestion';
    chip.textContent = s;
    chip.addEventListener('click', () => {
      state.handle = s;
      rerender();
    });
    suggestions.appendChild(chip);
  }
  wrap.appendChild(suggestions);

  // #4 — SENSITIVE: continue as an existing self? Default is a FRESH, unlinkable key (same
  // name in two circles = coincidence). Choosing an existing self presents THAT circle's key
  // + a signing proof → provably the same person to anyone in both circles. Shown only when
  // the joiner already belongs to other circles.
  if (Array.isArray(state.existingSelves) && state.existingSelves.length) {
    const lWrap = doc.createElement('div');
    lWrap.className = 'cc-wizard-link';
    const lLabel = doc.createElement('div');
    lLabel.className = 'cc-wizard-field-label';
    lLabel.textContent = t('circle.join.wizard.link.label');
    lWrap.appendChild(lLabel);
    const lSelect = doc.createElement('select');
    lSelect.className = 'cc-wizard-link-select';
    const fresh = doc.createElement('option');
    fresh.value = 'fresh';
    fresh.textContent = t('circle.join.wizard.link.fresh');
    lSelect.appendChild(fresh);
    for (const self of state.existingSelves) {
      const opt = doc.createElement('option');
      opt.value = self.circleId;
      opt.textContent = t('circle.join.wizard.link.same_person', { name: self.name });
      lSelect.appendChild(opt);
    }
    lSelect.value = state.linkChoice || 'fresh';
    lSelect.addEventListener('change', () => { setLinkChoice(state, lSelect.value); rerender(); });
    lWrap.appendChild(lSelect);
    const lHint = doc.createElement('p');
    lHint.className = 'cc-wizard-blurb';
    lHint.textContent = t('circle.join.wizard.link.hint');
    lWrap.appendChild(lHint);
    wrap.appendChild(lWrap);
  }

  // Property layer — join-with-persona. Choose a persona whose per-circle
  // disclosure applies here, or "join minimally" (the protective default: share
  // no background). On a FIRST join a persona still discloses nothing until you
  // set its sharing in "About me"; this is the identity you enter the circle as.
  if (Array.isArray(state.personas) && state.personas.length) {
    const pWrap = doc.createElement('div');
    pWrap.className = 'cc-wizard-persona';

    const pLabel = doc.createElement('div');
    pLabel.className = 'cc-wizard-field-label';
    pLabel.textContent = t('circle.join.wizard.persona.label');
    pWrap.appendChild(pLabel);

    const select = doc.createElement('select');
    select.className = 'cc-wizard-persona-select';
    const none = doc.createElement('option');
    none.value = '';
    none.textContent = t('circle.join.wizard.persona.minimal');
    select.appendChild(none);
    for (const p of state.personas) {
      const opt = doc.createElement('option');
      opt.value = p.id;
      opt.textContent = p.id === 'default' ? t('circle.join.wizard.persona.default_suffix', { name: p.name }) : p.name;
      select.appendChild(opt);
    }
    select.value = state.persona ?? '';
    select.addEventListener('change', () => { setPersona(state, select.value); });
    pWrap.appendChild(select);

    const pHint = doc.createElement('div');
    pHint.className = 'cc-wizard-field-hint';
    pHint.textContent = t('circle.join.wizard.persona.hint');
    pWrap.appendChild(pHint);
    wrap.appendChild(pWrap);
  }

  // Reveal level (§1.6 · NOTE-reveal-state-and-profile-updates) — how much of your persona other
  // members see in THIS circle. The joiner PICKS it here (default = the resolved preset from
  // prepareJoinIdentity: your saved "usual level", else the fallback); the circle's suggested level
  // is a NON-BINDING hint, never forced. This is what makes the join release VISIBLE + yours to set
  // instead of silently applying the fallback (the reveal-at-join UI the wizard used to omit).
  {
    const rWrap = doc.createElement('div');
    rWrap.className = 'cc-wizard-reveal';
    const rLabel = doc.createElement('div');
    rLabel.className = 'cc-wizard-field-label';
    rLabel.textContent = t('circle.join.wizard.reveal.label');
    rWrap.appendChild(rLabel);
    const rSelect = doc.createElement('select');
    rSelect.className = 'cc-wizard-reveal-select';
    for (const level of REVEAL_PRESETS) {
      const opt = doc.createElement('option');
      opt.value = level;
      opt.textContent = t(`circle.reveal.preset.${level}`);
      rSelect.appendChild(opt);
    }
    rSelect.value = state.revealPreset || 'profile';
    rSelect.addEventListener('change', () => { setJoinReveal(state, rSelect.value); });
    rWrap.appendChild(rSelect);
    const rHint = doc.createElement('div');
    rHint.className = 'cc-wizard-field-hint';
    rHint.textContent = t('circle.join.wizard.reveal.hint');
    rWrap.appendChild(rHint);
    if (state.circleSuggestedReveal) {
      const rSug = doc.createElement('div');
      rSug.className = 'cc-wizard-field-hint cc-wizard-reveal-suggested';
      rSug.textContent = t('circle.join.wizard.reveal.suggested', { level: t(`circle.reveal.preset.${state.circleSuggestedReveal}`) });
      rWrap.appendChild(rSug);
    }
    wrap.appendChild(rWrap);
  }

  // Fold-in phase C — the charter-driven offering-sharing default, VISIBLE and
  // uncheckable (never silent). Rendered only when the invite carried the circle's
  // offering-matching signal; checked ⇒ finalSubmit enables the persona's offering keys
  // at the coarse 'category' rung for this circle before computing the release.
  if (state.offeringsMatching) {
    const offeringsRow = doc.createElement('label');
    offeringsRow.className = 'cc-wizard-check cc-wizard-offerings-default';
    const offeringsBox = doc.createElement('input');
    offeringsBox.type = 'checkbox';
    offeringsBox.className = 'cc-wizard-offerings-default-box';
    offeringsBox.checked = state.shareOfferingsAtJoin;
    offeringsBox.addEventListener('change', () => {
      setShareOfferingsAtJoin(state, offeringsBox.checked);
    });
    offeringsRow.appendChild(offeringsBox);
    offeringsRow.appendChild(doc.createTextNode(` ${t('circle.join.offerings_default.label')}`));
    wrap.appendChild(offeringsRow);
    const offeringsHint = doc.createElement('div');
    offeringsHint.className = 'cc-wizard-field-hint cc-wizard-offerings-default-hint';
    offeringsHint.textContent = t('circle.join.offerings_default.hint');
    wrap.appendChild(offeringsHint);
  }

  // A typed failure carries a locale KEY (`submitErrorKey`); an untyped one carries a raw substrate
  // string (`submitError`). Only the second was ever rendered, so the two failures that bothered to type
  // themselves — the admin being offline, and a handle already taken — showed the joiner NOTHING: a blank
  // re-render, indistinguishable from the button not working. Found walking J-NP2 (2026-07-30), one layer
  // above where the machine-readable half was fixed the same day.
  const failure = state.submitErrorKey ? t(state.submitErrorKey) : state.submitError;
  if (failure) {
    const err = doc.createElement('div');
    err.className = 'cc-wizard-error';
    err.textContent = failure;
    wrap.appendChild(err);
  }

  if (state.submitting) {
    const status = doc.createElement('div');
    status.className = 'cc-wizard-submitting';
    status.textContent = t('circle.join.wizard.submitting');
    wrap.appendChild(status);
  }

  container.appendChild(wrap);
  renderActions(container, doc, [
    { label: t('circle.join.wizard.back'),   onClick: onBack,   kind: 'secondary', disabled: state.submitting },
    { label: t('circle.join.wizard.cancel'), onClick: onCancel, kind: 'secondary', disabled: state.submitting },
    { label: t('circle.join.wizard.join'),   onClick: onSubmit,
      disabled: !isValidHandle(state.handle) || state.submitting,
      kind: 'primary', className: 'cc-wizard-submit' },
  ]);
}

function renderError(container, doc, message, onClose) {
  const wrap = doc.createElement('div');
  wrap.className = 'cc-wizard-body';
  const err = doc.createElement('div');
  err.className = 'cc-wizard-error';
  err.textContent = message;
  wrap.appendChild(err);
  container.appendChild(wrap);
  renderActions(container, doc, [
    { label: t('common.close'), onClick: onClose, kind: 'secondary' },
  ]);
}

/* ─── helpers ──────────────────────────────────────────────── */

function renderActions(container, doc, buttons) {
  const row = doc.createElement('div');
  row.className = 'cc-wizard-actions';
  for (const b of buttons) {
    const btn = doc.createElement('button');
    btn.type = 'button';
    btn.className = `cc-wizard-btn cc-wizard-btn-${b.kind ?? 'secondary'} ${b.className ?? ''}`.trim();
    btn.textContent = b.label;
    btn.disabled = !!b.disabled;
    btn.addEventListener('click', b.onClick);
    row.appendChild(btn);
  }
  container.appendChild(row);
}

// decodeInvite, fetchGroupRules, summariseEmbeddedRules,
// isValidHandle moved to ../../core/wizards/joinGroupState.js
// 

// finalSubmit moved to../../core/wizards/joinGroupState.js.
// The lifted version wraps the chain in a {result, state} envelope +
// mutates state.submitting/submitError; see the call site in rerender().
