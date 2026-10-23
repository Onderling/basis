/**
 * The phone's create wizard walks the same short path as web (web twin:
 * apps/basis/test/web/createGroupWizard.short.dom.test.js): the steps and dots come from the shared `createSteps`
 * path, the kind/persona/purpose/tags sit behind one "Geavanceerd" fold, the review names the type and the purpose
 * (defaults included), and what is created carries the defaults. RN cannot render under Vitest, so this reads the source.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const src = readFileSync(resolve(__dirname, '../../basis/src/rn/wizards/createGroupWizardModal.js'), 'utf8')
  .replace(/\{\/\*[\s\S]*?\*\/\}/g, '').replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

describe('the phone create wizard: the short path', () => {
  it('steps and dots come from the shared path, not the six-step list', () => {
    expect(src).not.toMatch(/STEP_NAMES|STEP_LABEL_KEYS/);
    expect(src).toMatch(/createStepDots\(state\)/);
    expect(src).toMatch(/setStep\(nextStep\)/);
    expect(src).toMatch(/setStep\(prevCreateStep\(state\)\)/);
    expect(src).toMatch(/state\.step === REVIEW_STEP/);
  });
  it('the kind, persona, purpose and tags sit behind the one fold', () => {
    const fold = src.indexOf('testID="create-group-advanced"');
    expect(fold).toBeGreaterThan(0);
    for (const marker of ["label={t('circle.kindPicker')}", "label={t('circle.wizard.create.persona.label')}", "label={t('circle.wizard.create.purpose')}", "label={t('circle.wizard.create.tags')}"]) {
      expect(src.indexOf(marker), marker).toBeGreaterThan(fold);
    }
    expect(src.indexOf('testID="create-group-name"')).toBeLessThan(fold);
  });
  it('the review names type and purpose; the create carries the defaults', () => {
    expect(src).toMatch(/review_kind'\),\s+value: t\(`circle\.kind\.\$\{state\.kind \?\? 'other'\}`\)/);
    expect(src).toMatch(/purpose'\),\s+value: purposeOrDefault\(state, t\)/);
    expect(src).toMatch(/\.\.\.withCreateDefaults\(state, t\), submitting: true/);
  });
});
