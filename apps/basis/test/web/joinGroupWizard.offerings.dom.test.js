// @vitest-environment happy-dom
/**
 * Fold-in phase C — the charter-driven offering-sharing default, web wizard surface.
 *
 * A skills-matching circle (invite.offeringsMatching, embedded at invite-build from the circle's
 * board-8 skill record) surfaces a VISIBLE pre-checked "share my skills as category" line on the
 * handle step; the joiner can uncheck it (never silent). Circles without the signal — including
 * every older invite — render no line and keep the protective default-withhold.
 */
import { describe, it, expect, vi } from 'vitest';
import { renderJoinGroupWizard } from '../../src/web/wizards/joinGroupWizard.js';

const matchingInvite = { kind: 'membershipCode', groupId: 'b1', code: 'c1', offeringsMatching: true };
const plainInvite    = { kind: 'membershipCode', groupId: 'b2', code: 'c2' };

function mount() { const el = document.createElement('div'); document.body.appendChild(el); return el; }

function clickByLabel(root, label) {
  const btn = [...root.querySelectorAll('button')].find((b) => b.textContent.trim() === label);
  if (!btn) throw new Error(`button not found: ${label}`);
  btn.click();
}

/** Drive the wizard to step 3 (rules-accept → privacy-accept). */
function advanceToHandleStep(el) {
  const accept = el.querySelector('.cc-wizard-check input[type=checkbox]');
  accept.checked = true;
  accept.dispatchEvent(new Event('change'));
  clickByLabel(el, 'circle.join.wizard.next');
  const privacy = el.querySelector('.cc-wizard-check input[type=checkbox]');
  privacy.checked = true;
  privacy.dispatchEvent(new Event('change'));
  clickByLabel(el, 'circle.join.wizard.next');
}

describe('join wizard — charter-driven offering-sharing default', () => {
  it('matching circle: renders the line PRE-CHECKED with label + hint through t()', () => {
    const el = mount();
    renderJoinGroupWizard({
      container: el, doc: document, args: { invite: matchingInvite },
      callSkill: vi.fn().mockResolvedValue({ ok: true }), onClose: vi.fn(), onDispatched: vi.fn(),
    });
    advanceToHandleStep(el);
    const box = el.querySelector('.cc-wizard-offerings-default-box');
    expect(box).toBeTruthy();
    expect(box.checked).toBe(true);   // pre-checked — but visible and uncheckable
    // label + hint resolve via t() (uninitialised here → the locale KEY, proving no hardcoded copy)
    expect(el.querySelector('.cc-wizard-offerings-default').textContent).toContain('circle.join.offerings_default.label');
    expect(el.querySelector('.cc-wizard-offerings-default-hint').textContent).toBe('circle.join.offerings_default.hint');
  });

  it('non-matching circle (older invites included): no line at all — default stays withhold', () => {
    const el = mount();
    renderJoinGroupWizard({
      container: el, doc: document, args: { invite: plainInvite },
      callSkill: vi.fn().mockResolvedValue({ ok: true }), onClose: vi.fn(), onDispatched: vi.fn(),
    });
    advanceToHandleStep(el);
    expect(el.querySelector('.cc-wizard-offerings-default')).toBeNull();
  });

  it('unchecking the line → the join runs WITHOUT any offerings disclosure (never silent, user wins)', async () => {
    const el = mount();
    const onDispatched = vi.fn();
    const calls = [];
    const callSkill = vi.fn(async (app, op) => { calls.push({ app, op }); return { ok: true, drivers: {}, released: {} }; });
    renderJoinGroupWizard({
      container: el, doc: document, args: { invite: matchingInvite },
      callSkill, onClose: vi.fn(), onDispatched,
    });
    advanceToHandleStep(el);
    const box = el.querySelector('.cc-wizard-offerings-default-box');
    box.checked = false;
    box.dispatchEvent(new Event('change'));
    const handle = el.querySelector('.cc-wizard-handle-input');
    handle.value = 'anne';
    handle.dispatchEvent(new Event('input'));
    clickByLabel(el, 'circle.join.wizard.join');
    await vi.waitFor(() => expect(onDispatched).toHaveBeenCalled());
    // No disclosure enacted, no release computed. (listAgents may fire — that's
    // the persona PICKER loading its options, not a share.)
    const shareOps = ['getProfileDrivers', 'setProfileDisclosure', 'getPersonaRelease'];
    expect(calls.filter((c) => shareOps.includes(c.op))).toEqual([]);
  });
});
