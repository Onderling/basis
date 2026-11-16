// @vitest-environment happy-dom
/**
 * Creating a circle asks only what a household needs: its name, then the review and the invite. Everything else keeps
 * its default (a household: its template, key rotation on, no pod, the default rules) behind one "Geavanceerd" fold,
 * and the review says what was chosen — type, purpose, rules — never an empty value. Mobile twin:
 * apps/basis-mobile/test/createWizardShortParity.test.js; the shared path is `createSteps` in createGroupState.js.
 */
import { describe, it, expect, vi } from 'vitest';
import { renderCreateGroupWizard } from '../../src/web/wizards/createGroupWizard.js';
import {
  initialState, createSteps, nextCreateStep, prevCreateStep, setAdvanced, purposeOrDefault, withCreateDefaults, REVIEW_STEP, chooseKind,
  setKind, setRevealPolicy, policyPatchFromState,
} from '../../src/core/wizards/createGroupState.js';
import { buildRulesObjectFromState } from '../../src/core/wizards/createGroupState.js';

describe('the path through the create wizard (shared)', () => {
  it('closed: name → review; open: every step; back and forth stay on the path', () => {
    const s = initialState();
    expect(createSteps(s)).toEqual([1, REVIEW_STEP]);
    expect(nextCreateStep(s)).toBe(REVIEW_STEP);
    expect(prevCreateStep({ ...s, step: REVIEW_STEP })).toBe(1);
    const open = setAdvanced(s, true);
    expect(createSteps(open)).toEqual([1, 2, 3, 4, 5, REVIEW_STEP]);
    expect(nextCreateStep(open)).toBe(2);
    expect(prevCreateStep({ ...open, step: REVIEW_STEP })).toBe(5);
  });
  it('the defaults: no kind until one is picked, rotation on, no pod; the purpose is what its field holds', () => {
    const s = initialState();
    expect(s.kind).toBeNull();
    expect(s.keyRotationMode).toBeTruthy();
    expect(s.rotationDays).toBeGreaterThan(0);
    expect(s.storagePolicy).toBe('none');
    const t = (k) => `T:${k}`;
    const home = chooseKind(s, 'household', t);
    expect(home.purpose, 'the kind\'s sentence, in the field where the person sees it').toBe('T:circle.wizard.create.default_purpose_household');
    expect(purposeOrDefault({ ...home, purpose: '  Samen koken ' }, t)).toBe('Samen koken');
    expect(buildRulesObjectFromState(withCreateDefaults(home, t)).purpose).toBe('T:circle.wizard.create.default_purpose_household');
    expect(purposeOrDefault(s, t), 'nothing invented').toBe('');
  });
  it('who sees whose name stays per pair: not widened by the household default, nor by a kind picked later — only by the choice', () => {
    const s = initialState();
    expect(s.revealPolicy).toBe('pairwise');
    expect(policyPatchFromState(s).revealPolicy).toBe('pairwise');
    expect(setKind(setKind(s, 'friends'), 'household').revealPolicy).toBe('pairwise');
    expect(setRevealPolicy(s, 'open').revealPolicy).toBe('open');
    expect(setRevealPolicy(s, 'everyone-ish').revealPolicy).toBe('pairwise');
  });
});

function boot() {
  const el = document.createElement('div');
  document.body.appendChild(el);
  const callSkill = vi.fn(async (app, op, args) => {
    if (op === 'createGroupV2') return { groupId: args.groupId, code: 'K', expiresAt: 1 };
    return {};
  });
  renderCreateGroupWizard({ container: el, doc: document, callSkill, onClose: vi.fn(), onDispatched: vi.fn(), getMyPeerAddr: () => 'founder-key' });
  return { el, callSkill };
}
const typeName = (el, v) => { const n = el.querySelector('input.cc-wizard-input'); n.value = v; n.dispatchEvent(new Event('input')); };
// the kind, picked on the first step as a person does (its radio)
const pickKind = (el, k) => { const r = el.querySelector(`input[type=radio][value=${k}]`); r.checked = true; r.dispatchEvent(new Event('change', { bubbles: true })); r.click(); };
const review = (el) => Object.fromEntries([...el.querySelectorAll('.cc-wizard-review dt')].map((dt) => [dt.textContent, dt.nextElementSibling?.textContent ?? '']));

describe('the web create wizard', () => {
  it('asks the name and the kind, and Next goes straight to the review; two dots', async () => {
    const { el } = boot();
    typeName(el, 'Thuis');
    expect(el.querySelectorAll('.cc-wizard-step').length).toBe(2);
    await new Promise((r) => { setTimeout(r, 50); });
    expect(el.querySelector('.cc-wizard-btn-primary').disabled, 'no kind yet: Next waits').toBe(true);
    pickKind(el, 'household');
    expect(el.querySelector('[data-role=advanced]')?.open).toBe(false);
    await vi.waitFor(() => expect(el.querySelector('.cc-wizard-btn-primary').disabled).toBe(false));
    el.querySelector('.cc-wizard-btn-primary').click();
    expect(el.querySelector('.cc-wizard-review')).toBeTruthy();
  });
  it('the review names the type, the purpose and the rules — no empty value', async () => {
    const { el } = boot();
    typeName(el, 'Thuis');
    pickKind(el, 'household');
    await vi.waitFor(() => expect(el.querySelector('.cc-wizard-btn-primary').disabled).toBe(false));
    el.querySelector('.cc-wizard-btn-primary').click();
    const r = review(el);
    expect(r['circle.wizard.create.review_kind']).toBe('circle.kind.household');
    expect(r['circle.wizard.create.purpose']).toBe('circle.wizard.create.default_purpose_household');
    expect(r['circle.wizard.create.access']).toBeTruthy();
    expect(r['circle.wizard.create.review_conflict']).toBeTruthy();
    expect(r['circle.wizard.create.reveal_label']).toBe('circle.wizard.create.reveal_pairwise');
    for (const [k, v] of Object.entries(r)) expect(v.trim(), k).not.toBe('');
    // what the short path never showed is not in its review
    expect(r['circle.wizard.create.review_storage']).toBeUndefined();
  });
  it('opening "Geavanceerd" walks every step again', async () => {
    const { el } = boot();
    typeName(el, 'Thuis');
    pickKind(el, 'household');
    const fold = el.querySelector('[data-role=advanced]');
    fold.open = true;
    fold.dispatchEvent(new Event('toggle'));
    expect(el.querySelectorAll('.cc-wizard-step').length).toBe(6);
    expect(el.querySelector('[data-role=advanced]').open).toBe(true);
    await vi.waitFor(() => expect(el.querySelector('.cc-wizard-btn-primary').disabled).toBe(false));
    el.querySelector('.cc-wizard-btn-primary').click();
    expect(el.querySelector('.cc-wizard-review')).toBeNull();
  });
});

describe('the web create wizard — a circle with its own pod', () => {
  it('typing the pod address enables the review: the button follows the field, not the moment the step was drawn', async () => {
    const { el } = boot();
    typeName(el, 'Straat');
    pickKind(el, 'neighbourhood');
    const fold = el.querySelector('[data-role=advanced]');
    fold.open = true;
    fold.dispatchEvent(new Event('toggle'));
    // walk to the step that asks where the circle's content lives
    for (let i = 0; i < 6 && !el.querySelector('input[type=radio][value=shared]'); i += 1) {
      await vi.waitFor(() => expect(el.querySelector('.cc-wizard-btn-primary').disabled).toBe(false));
      el.querySelector('.cc-wizard-btn-primary').click();
    }
    const shared = el.querySelector('input[type=radio][value=shared]');
    expect(shared, 'the wizard never asked where the content lives').toBeTruthy();
    shared.click();
    const podField = () => [...el.querySelectorAll('.cc-wizard-field')].find((f) => f.textContent.includes('circle.wizard.create.pod_uri'))?.querySelector('input');
    await vi.waitFor(() => expect(podField(), 'choosing a shared pod asks for its address').toBeTruthy());
    const uri = podField();
    const reviewBtn = () => [...el.querySelectorAll('.cc-wizard-btn-primary')].pop();
    expect(reviewBtn().disabled, 'no address yet: the review waits').toBe(true);
    uri.value = 'https://pod.example/straat/';
    uri.dispatchEvent(new Event('input'));
    expect(reviewBtn().disabled, 'an address typed, and the review is still disabled').toBe(false);
    uri.value = 'not an address';
    uri.dispatchEvent(new Event('input'));
    expect(reviewBtn().disabled, 'a non-address must keep the review disabled').toBe(true);
  });
});
