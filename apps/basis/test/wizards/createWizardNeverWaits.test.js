/**
 * "Creating circle…" sat ~3 min with every button off (walk 2026-10-09). The circle existed after 0.2 s; the wizard
 * waited on bookkeeping behind it — the founder's release (finalSubmit, pinned in createPersonaFounder.test.js) and,
 * on mobile, the policy write, which ran BEFORE the invite went out. The RN wizard now hands the invite over first
 * and bounds the policy write. RN screens cannot render under vitest; this pins the wiring as source text.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const SRC = readFileSync(fileURLToPath(new URL('../../src/rn/wizards/createGroupWizardModal.js', import.meta.url)), 'utf8');
const onCreate = SRC.slice(SRC.indexOf('const onCreate = useCallback'), SRC.indexOf('const canAdvance1'));

describe('the mobile create wizard never waits on bookkeeping', () => {
  it('hands the invite over before it writes the policy', () => {
    const dispatchAt = onCreate.indexOf('onDispatched({');
    const persistAt = onCreate.indexOf('persistPolicy(result.groupId');
    expect(dispatchAt).toBeGreaterThan(-1);
    expect(persistAt).toBeGreaterThan(dispatchAt);
  });
  it('bounds the policy write', () => {
    expect(onCreate).toMatch(/withinMs\(persistPolicy\(result\.groupId, [^)]*\)\), POLICY_WRITE_BOUND_MS\)/);
  });
});
