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
  initialState, createSteps, nextCreateStep, prevCreateStep, setAdvanced, purposeOrDefault, withCreateDefaults, REVIEW_STEP,
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
  it('the defaults: a household, rotation on, no pod, a purpose in the kind\'s words when none was typed', () => {
    const s = initialState();
    expect(s.kind).toBe('household');
    expect(s.keyRotationMode).toBeTruthy();
    expect(s.rotationDays).toBeGreaterThan(0);
    expect(s.storagePolicy).toBe('none');
    const t = (k) => `T:${k}`;
    expect(purposeOrDefault(s, t)).toBe('T:circle.wizard.create.default_purpose_household');
    expect(purposeOrDefault({ ...s, purpose: '  Samen koken ' }, t)).toBe('Samen koken');
    expect(buildRulesObjectFromState(withCreateDefaults(s, t)).purpose).toBe('T:circle.wizard.create.default_purpose_household');
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
const review = (el) => Object.fromEntries([...el.querySelectorAll('.cc-wizard-review dt')].map((dt) => [dt.textContent, dt.nextElementSibling?.textContent ?? '']));

describe('the web create wizard', () => {
  it('asks the name, and Next goes straight to the review; two dots', async () => {
    const { el } = boot();
    typeName(el, 'Thuis');
    expect(el.querySelectorAll('.cc-wizard-step').length).toBe(2);
    expect(el.querySelector('[data-role=advanced]')?.open).toBe(false);
    await vi.waitFor(() => expect(el.querySelector('.cc-wizard-btn-primary').disabled).toBe(false));
    el.querySelector('.cc-wizard-btn-primary').click();
    expect(el.querySelector('.cc-wizard-review')).toBeTruthy();
  });
  it('the review names the type, the purpose and the rules — no empty value', async () => {
    const { el } = boot();
    typeName(el, 'Thuis');
    await vi.waitFor(() => expect(el.querySelector('.cc-wizard-btn-primary').disabled).toBe(false));
    el.querySelector('.cc-wizard-btn-primary').click();
    const r = review(el);
    expect(r['circle.wizard.create.review_kind']).toBe('circle.kind.household');
    expect(r['circle.wizard.create.purpose']).toBe('circle.wizard.create.default_purpose_household');
    expect(r['circle.wizard.create.access']).toBeTruthy();
    expect(r['circle.wizard.create.review_conflict']).toBeTruthy();
    for (const [k, v] of Object.entries(r)) expect(v.trim(), k).not.toBe('');
    // what the short path never showed is not in its review
    expect(r['circle.wizard.create.review_storage']).toBeUndefined();
  });
  it('opening "Geavanceerd" walks every step again', async () => {
    const { el } = boot();
    typeName(el, 'Thuis');
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
