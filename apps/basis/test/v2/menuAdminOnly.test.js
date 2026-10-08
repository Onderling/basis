/**
 * The circle's ⋯ menu tells a member the truth about admin-only entries.
 *
 * A MEMBER's menu offered "Invite to this circle", "Circle settings" and "Admin" exactly as an admin's did
 * (found 2026-10-08 on a real phone: the viewer's roster row said `member`, the projection said all three
 * `enabled`). The real refusals live where they bind — the skills' own admin checks, and the invite screen's
 * "only an admin" on open — so nothing was ever granted; but an offer that always refuses is a lie in the UI.
 * The manifest's actions now declare `role: 'admin'`, and the ONE projection both shells paint from greys
 * them (never hides them) for a viewer who is not an admin, with the sentence that says why.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { validateManifest } from '@onderling/app-manifest';
import { basisManifest } from '../../manifest.js';
import { circleActions, circleActionsMobile } from '../../src/v2/actionProjection.js';

const ADMIN_ONLY = ['invite', 'settings', 'admin'];

describe('the ⋯ menu — admin-only entries', () => {
  for (const [shell, project] of [['web', (o) => circleActions(basisManifest, { platform: 'web', ...o })], ['mobile', (o) => circleActionsMobile(basisManifest, o)]]) {
    it(`${shell}: a member sees them GREYED, with the reason — never hidden`, () => {
      const roster = project({ isAdmin: false });
      for (const id of ADMIN_ONLY) {
        const a = roster.find((x) => x.id === id);
        expect(a, id).toBeTruthy();
        expect(a.disabled, id).toBe(true);
        expect(typeof a.reasonKey, id).toBe('string');
      }
      expect(roster.find((x) => x.id === 'invite').reasonKey).toBe('circle.invite.admin_only');
      expect(roster.find((x) => x.id === 'settings').reasonKey).toBe('circle.op.admin_only');
    });

    it(`${shell}: an admin sees them enabled`, () => {
      const roster = project({ isAdmin: true });
      for (const id of ADMIN_ONLY) expect(roster.find((x) => x.id === id)?.disabled, id).toBeFalsy();
    });

    it(`${shell}: a viewer whose role is not known yet is not offered them (fail closed until the roster answers)`, () => {
      const roster = project({});
      for (const id of ADMIN_ONLY) expect(roster.find((x) => x.id === id)?.disabled, id).toBe(true);
    });
  }

  it('entries without a role are untouched for a member', () => {
    const back = circleActions(basisManifest, { platform: 'web', isAdmin: false }).find((x) => x.id === 'back');
    expect(back?.disabled).toBeFalsy();
  });

  it('the manifest declares the role, and the validator accepts only a known one', () => {
    for (const id of ADMIN_ONLY) expect(basisManifest.actions.find((a) => a.id === id)?.role, id).toBe('admin');
    const bad = { ...basisManifest, actions: [{ id: 'x', labelKey: 'circle.back', target: { kind: 'nav', to: 'back' }, role: 'king' }] };
    const res = validateManifest(bad);
    expect(res.errors.some((e) => /role/.test(e.message))).toBe(true);
  });

  it('both reason sentences exist in English and Dutch', () => {
    for (const lang of ['en', 'nl']) {
      const loc = JSON.parse(readFileSync(fileURLToPath(new URL(`../../src/locales/circle.${lang}.json`, import.meta.url)), 'utf8'));
      expect(loc.op?.admin_only?.text, lang).toBeTruthy();
      expect(loc.invite?.admin_only?.text, lang).toBeTruthy();
    }
  });
});

describe('the ⋯ menu — both shells hand the projection the viewer\'s role and paint the reason', () => {
  const read = (rel) => readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf8');
  it('web (circleView.js)', () => {
    const src = read('../../web/v2/circleView.js');
    expect(src).toMatch(/circleActions\(basisManifest, \{[^}]*isAdmin/);
    expect(src).toMatch(/reasonKey/);
  });
  it('mobile (CircleLauncherScreen.js)', () => {
    const src = read('../../../basis-mobile/src/screens/v2/CircleLauncherScreen.js');
    expect(src).toMatch(/circleActionsMobile\(basisManifest, \{[^}]*isAdmin: mandateViewer\.isAdmin/);
    expect(src).toMatch(/action\.reasonKey/);
  });
});
