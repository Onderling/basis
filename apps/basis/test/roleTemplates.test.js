/**
 * N3 — role templates (gast / observer / externe-vrijwilliger starter set).
 *
 * Covers the pure registry, the wizard-state toggle + persistence into
 * `rules.roles`, and a locale drift-guard so every template has en/nl
 * label + description text.
 */
import { describe, it, expect } from 'vitest';

import {
  ROLE_TEMPLATES, ROLE_TEMPLATE_IDS, roleTemplateById, applyRoleTemplates,
} from '../src/v2/roleTemplates.js';
import {
  initialState, toggleRole, buildRulesObjectFromState,
} from '../src/core/wizards/createGroupState.js';
import enRaw from '../locales/en.json' assert { type: 'json' };
import nlRaw from '../locales/nl.json' assert { type: 'json' };
import { sharedRoleLocale } from '../src/locales/index.js';
// `role.*` now lives in the shared source (like `circle.*`); merge it back to check the effective bundle.
const en = { ...enRaw, role: sharedRoleLocale.en };
const nl = { ...nlRaw, role: sharedRoleLocale.nl };

describe('ROLE_TEMPLATES registry', () => {
  it('ships the gast / observer / externe-vrijwilliger starter set', () => {
    expect(ROLE_TEMPLATE_IDS).toEqual(['guest', 'observer', 'externalVolunteer']);
  });
  it('each template carries id, rank, baseRole + locale keys', () => {
    for (const tid of ROLE_TEMPLATE_IDS) {
      const tpl = ROLE_TEMPLATES[tid];
      expect(typeof tpl.id).toBe('string');
      expect(typeof tpl.rank).toBe('number');
      expect(tpl.labelKey).toMatch(/^role\./);
      expect(tpl.descKey).toMatch(/^role\./);
    }
  });
  it('externe-vrijwilliger derives from the @onderling/core external role', () => {
    expect(ROLE_TEMPLATES.externalVolunteer.id).toBe('external');
    expect(ROLE_TEMPLATES.externalVolunteer.baseRole).toBe('external');
  });
  it('roleTemplateById returns null for unknown ids', () => {
    expect(roleTemplateById('observer')).not.toBeNull();
    expect(roleTemplateById('nope')).toBeNull();
  });
});

describe('applyRoleTemplates', () => {
  it('maps ids to deduped role defs, dropping unknowns', () => {
    const defs = applyRoleTemplates(['guest', 'externalVolunteer', 'mystery']);
    expect(defs.map((d) => d.id)).toEqual(['guest', 'external']);
    expect(defs[0]).toMatchObject({ id: 'guest', rank: 30, baseRole: 'observer', template: 'guest' });
  });
  it('collapses templates that target the same role id', () => {
    // guest + observer both derive from the observer base, but keep
    // distinct role ids (guest vs observer) so both survive.
    const defs = applyRoleTemplates(['guest', 'observer']);
    expect(defs.map((d) => d.id).sort()).toEqual(['guest', 'observer']);
  });
  it('returns [] for non-array input', () => {
    expect(applyRoleTemplates(null)).toEqual([]);
  });
});

describe('createGroupState — toggleRole + persistence', () => {
  it('toggleRole adds then removes a known template id', () => {
    let s = toggleRole(initialState(), 'observer');
    expect(s.extraRoles).toEqual(['observer']);
    s = toggleRole(s, 'observer');
    expect(s.extraRoles).toEqual([]);
  });
  it('ignores unknown template ids', () => {
    expect(toggleRole(initialState(), 'nope').extraRoles).toEqual([]);
  });
  it('buildRulesObjectFromState carries rules.roles from the selection', () => {
    const s = toggleRole(toggleRole(initialState(), 'guest'), 'externalVolunteer');
    s.name = 'Circle'; s.groupId = 'circle';
    const rules = buildRulesObjectFromState(s);
    expect(rules.roles.map((r) => r.id)).toEqual(['guest', 'external']);
  });
  it('omits rules.roles when no extra role is selected', () => {
    const s = initialState(); s.name = 'X'; s.groupId = 'x';
    expect(buildRulesObjectFromState(s).roles).toBeUndefined();
  });
});

describe('role-template locales (drift guard)', () => {
  it('every template + the section labels have en + nl text', () => {
    for (const key of ['extraRolesLabel', 'extraRolesHint']) {
      expect(en.role?.[key]?.text, `en role.${key}`).toBeTruthy();
      expect(nl.role?.[key]?.text, `nl role.${key}`).toBeTruthy();
    }
    for (const tid of ROLE_TEMPLATE_IDS) {
      const tpl = ROLE_TEMPLATES[tid];
      for (const [lang, bundle] of [['en', en], ['nl', nl]]) {
        const lbl = tpl.labelKey.split('.').reduce((o, s) => o?.[s], bundle);
        const dsc = tpl.descKey.split('.').reduce((o, s) => o?.[s], bundle);
        expect(lbl?.text, `${lang} ${tpl.labelKey}`).toBeTruthy();
        expect(dsc?.text, `${lang} ${tpl.descKey}`).toBeTruthy();
      }
    }
  });
});
