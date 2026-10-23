// @vitest-environment happy-dom
/**
 * The create wizard asks which persona founds the circle — the default preselected — and the one chosen is the
 * release that rides onto the new circle (Frits 2026-09-24). The web half of the shared state's test
 * (`test/wizards/createPersonaFounder.test.js`): the picker is painted, the review says it, and the shell's seam
 * is handed the circle and the persona after a create that succeeded.
 */
import { describe, it, expect, vi } from 'vitest';
import { renderCreateGroupWizard } from '../../src/web/wizards/createGroupWizard.js';

function mount() { const el = document.createElement('div'); document.body.appendChild(el); return el; }

const PERSONAS = { items: [
  { agentId: 'default', name: 'Frits', role: 'profile' },
  { agentId: 'buurt', name: 'Buurt', role: 'profile' },
] };

function boot({ shareFounderRelease } = {}) {
  const el = mount();
  const onDispatched = vi.fn();
  const callSkill = vi.fn(async (app, op, args) => {
    if (op === 'listAgents') return PERSONAS;
    if (op === 'createGroupV2') return { groupId: args.groupId, code: 'K', expiresAt: 1 };
    if (op === 'bindCirclePersona') return { ok: true };   // the persona founds after the bind
    return {};
  });
  renderCreateGroupWizard({
    container: el, doc: document, callSkill, onClose: vi.fn(), onDispatched,
    getMyPeerAddr: () => 'founder-key', shareFounderRelease,
  });
  return { el, onDispatched };
}

async function picker(el) {
  await vi.waitFor(() => expect(el.querySelector('[data-testid=create-founder-persona]')).toBeTruthy());
  return el.querySelector('[data-testid=create-founder-persona]');
}

describe('create wizard — which persona founds the circle', () => {
  it('paints the picker on the identity step with the default preselected and a start-minimally option', async () => {
    const { el } = boot();
    const sel = await picker(el);
    expect([...sel.options].map((o) => o.value)).toEqual(['', 'default', 'buurt']);
    expect(sel.value).toBe('default');
    expect(el.textContent).toContain('circle.wizard.create.persona.hint');
  });

  it('hands the shell the new circle and the chosen persona, after the create succeeded', async () => {
    const shareFounderRelease = vi.fn(async () => ({ ok: true }));
    const { el, onDispatched } = boot({ shareFounderRelease });
    const sel = await picker(el);
    // the persona is chosen under "Geavanceerd": opening it walks every step
    const fold = el.querySelector('[data-role=advanced]');
    fold.open = true;
    fold.dispatchEvent(new Event('toggle'));
    sel.value = 'buurt';
    sel.dispatchEvent(new Event('change'));
    const name = el.querySelector('input.cc-wizard-input');   // the first field on the identity step is the name
    name.value = 'De straat';
    name.dispatchEvent(new Event('input'));
    // Through the five steps to the review: each step's forward button is its primary one.
    for (let i = 0; i < 5; i += 1) el.querySelector('.cc-wizard-btn-primary').click();
    expect(el.textContent).toContain('Buurt');                    // the review names the founding persona
    el.querySelector('.cc-wizard-btn-primary').click();          // the review's primary button creates the circle (its words come from the locale)
    await vi.waitFor(() => expect(onDispatched).toHaveBeenCalled());
    const gid = onDispatched.mock.calls[0][0].groupId;
    expect(shareFounderRelease).toHaveBeenCalledWith(gid, 'buurt');
  });
});
