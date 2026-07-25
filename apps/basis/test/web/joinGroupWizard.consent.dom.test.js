// @vitest-environment happy-dom
/**
 * consent-at-join, web wizard surface.
 *
 * The join wizard's Agree/Decline (rules) step surfaces the circle's OPT-OUTABLE capabilities from the
 * invite's embedded freedom template; unchecking one records an opt-out that rides out with the success
 * envelope (which the host writes into the member's prefs → the gate's admin ∩ user effective set).
 */
import { describe, it, expect, vi } from 'vitest';
import { renderJoinGroupWizard } from '../../src/web/wizards/joinGroupWizard.js';

const sources = [{
  manifest: {
    app: 'tasks', itemTypes: ['task'],
    nouns: { task: { atoms: ['add', 'complete'] } },
    operations: [
      { id: 'addTask', verb: 'add', appliesTo: { type: 'task' } },
      { id: 'doneTask', verb: 'complete', appliesTo: { type: 'task' } },
    ],
  },
}];
// 'add task' required (mandatory), 'complete task' optional (opt-outable)
const invite = {
  kind: 'membershipCode', groupId: 'b1', code: 'c1',
  apps: ['tasks'],
  capabilities: { 'tasks add task': { freedom: 'required' }, 'tasks complete task': { freedom: 'optional' } },
};

function mount() { const el = document.createElement('div'); document.body.appendChild(el); return el; }

describe('join wizard — consent-at-join', () => {
  it('renders only the opt-outable caps as consent checkboxes on the rules step', () => {
    const el = mount();
    renderJoinGroupWizard({
      container: el, doc: document, args: { invite }, sources,
      callSkill: vi.fn(), onClose: vi.fn(), onDispatched: vi.fn(),
    });
    const caps = el.querySelectorAll('.cc-wizard-consent-cap input[type=checkbox]');
    expect(caps).toHaveLength(1);   // only 'complete task' — the required 'add task' is not offered
    expect(el.querySelector('[data-cap="tasks complete task"]')).toBeTruthy();
    expect(el.querySelector('[data-cap="tasks add task"]')).toBeNull();
    // checked = "I take part" by default
    expect(el.querySelector('input[data-cap="tasks complete task"]').checked).toBe(true);
  });

  it('renders no consent section when the invite carries no freedom template (no-op)', () => {
    const el = mount();
    renderJoinGroupWizard({
      container: el, doc: document, args: { invite: { kind: 'membershipCode', groupId: 'b1', code: 'c1' } },
      sources, callSkill: vi.fn(), onClose: vi.fn(), onDispatched: vi.fn(),
    });
    expect(el.querySelector('.cc-wizard-consent')).toBeNull();
  });

  it('unchecking a cap → capabilityOptOuts recorded on the join envelope', async () => {
    const el = mount();
    const onDispatched = vi.fn();
    // setMyHandle + redeemMembershipCode both succeed
    const callSkill = vi.fn().mockResolvedValue({ ok: true });
    renderJoinGroupWizard({
      container: el, doc: document, args: { invite }, sources,
      callSkill, onClose: vi.fn(), onDispatched,
    });

    // opt out of the optional cap
    const box = el.querySelector('input[data-cap="tasks complete task"]');
    box.checked = false;
    box.dispatchEvent(new Event('change'));

    // accept rules → advance
    const accept = el.querySelector('.cc-wizard-check input[type=checkbox]');
    accept.checked = true;
    accept.dispatchEvent(new Event('change'));
    // Next → (step 2)
    clickByLabel(el, 'circle.join.wizard.next');
    // privacy accept → Next (step 3)
    const privacy = el.querySelector('.cc-wizard-check input[type=checkbox]');
    privacy.checked = true;
    privacy.dispatchEvent(new Event('change'));
    clickByLabel(el, 'circle.join.wizard.next');
    // pick handle + join
    const handle = el.querySelector('.cc-wizard-handle-input');
    handle.value = 'anne';
    handle.dispatchEvent(new Event('input'));
    clickByLabel(el, 'circle.join.wizard.join');

    await vi.waitFor(() => expect(onDispatched).toHaveBeenCalled());
    const reply = onDispatched.mock.calls[0][0];
    expect(reply.capabilityOptOuts).toEqual(['tasks complete task']);
  });
});

function clickByLabel(root, label) {
  const btn = [...root.querySelectorAll('button')].find((b) => b.textContent.trim() === label);
  if (!btn) throw new Error(`button not found: ${label}`);
  btn.click();
}
