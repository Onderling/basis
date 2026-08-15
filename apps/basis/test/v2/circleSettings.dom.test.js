// @vitest-environment happy-dom
import { describe, it, expect, vi } from 'vitest';
import { renderCircleSettings } from '../../web/v2/circleSettings.js';
import { SETTINGS_ENUM_AXES, CIRCLE_POLICY_ENUMS, DEFAULT_CIRCLE_POLICY, mergeCirclePolicy } from '../../src/v2/circlePolicy.js';
import { pageForOp } from '../../src/v2/pageProjection.js';
import { basisManifest } from '../../manifest.js';

const t = (k) => k;
function mount() { const el = document.createElement('div'); document.body.appendChild(el); return el; }

describe('renderCircleSettings', () => {
  // The axis COUNT is derived from the shared list rather than hardcoded: adding an axis is a one-line
  // change in `circlePolicy.js`, and this test should verify the surface renders them all, not re-state how
  // many there are. `settingsAxesParity.test.js` guards that the list is shared and fully localised.
  it('renders 8 feature toggles + every shared enum axis, reflecting the policy', () => {
    const el = mount();
    renderCircleSettings(el, { policy: DEFAULT_CIRCLE_POLICY, t });
    expect(el.querySelectorAll('.circle-settings__feature input[type=checkbox]')).toHaveLength(8);
    expect(el.querySelectorAll('.circle-settings__axis')).toHaveLength(SETTINGS_ENUM_AXES.length);
    expect([...el.querySelectorAll('.circle-settings__axis')].map((s) => s.dataset.axis))
      .toEqual([...SETTINGS_ENUM_AXES]);
    expect(el.querySelector('input[data-feature=chat]').checked).toBe(true);
    expect(el.querySelector('.circle-settings__axis[data-axis=pod] input[value=none]').checked).toBe(true);
    // obj L — sharePosture axis is editable; default 'closed' reflects DEFAULT_CIRCLE_POLICY.
    expect(el.querySelector('.circle-settings__axis[data-axis=sharePosture] input[value=closed]').checked).toBe(true);
    // 5.9a — view axis is editable; default flipped to 'screen' so
    // tap-on-kring opens the per-circle detail instead of auto-
    // routing to the classic chat shell (see DEFAULT_CIRCLE_POLICY).
    expect(el.querySelector('.circle-settings__axis[data-axis=view] input[value=screen]').checked).toBe(true);
  });

  it('fires onChange with a feature patch on toggle', () => {
    const el = mount();
    const onChange = vi.fn();
    renderCircleSettings(el, { policy: DEFAULT_CIRCLE_POLICY, t, onChange });
    const tasks = el.querySelector('input[data-feature=tasks]');
    tasks.checked = true;
    tasks.dispatchEvent(new Event('change'));
    expect(onChange).toHaveBeenCalledWith({ features: { tasks: true } });
  });

  it('fires onChange with an axis patch on radio select', () => {
    const el = mount();
    const onChange = vi.fn();
    renderCircleSettings(el, { policy: DEFAULT_CIRCLE_POLICY, t, onChange });
    const local = el.querySelector('.circle-settings__axis[data-axis=llmTool] input[value=local]');
    local.checked = true;
    local.dispatchEvent(new Event('change'));
    expect(onChange).toHaveBeenCalledWith({ llmTool: 'local' });
  });

  it('fires onSave and onBack', () => {
    const el = mount();
    const onSave = vi.fn();
    const onBack = vi.fn();
    renderCircleSettings(el, { policy: DEFAULT_CIRCLE_POLICY, t, onSave, onBack });
    el.querySelector('.circle-settings__save').click();
    el.querySelector('.circle-settings__back').click();
    expect(onSave).toHaveBeenCalledTimes(1);
    expect(onBack).toHaveBeenCalledTimes(1);
  });

  it('B #64 — renders the apply-recipe section only when onApplyRecipe is wired, and fires it with the source', async () => {
    const el = mount();
    // absent by default
    renderCircleSettings(el, { policy: DEFAULT_CIRCLE_POLICY, t });
    expect(el.querySelector('.circle-settings__recipe')).toBeNull();

    // wired → section renders + click passes the trimmed source, status shows the returned message
    const onApplyRecipe = vi.fn().mockResolvedValue('circle.recipeApply.applied');
    renderCircleSettings(el, { policy: DEFAULT_CIRCLE_POLICY, t, onApplyRecipe });
    const input = el.querySelector('textarea[data-role=recipe-source]');
    input.value = '  {"capabilities":{}}  ';
    el.querySelector('.circle-settings__recipe-apply').click();
    await Promise.resolve(); await Promise.resolve();
    expect(onApplyRecipe).toHaveBeenCalledWith('{"capabilities":{}}');
    expect(el.querySelector('[data-role=recipe-status]').textContent).toBe('circle.recipeApply.applied');
  });

  it('B consent-card — with onReviewRecipe wired, Apply shows the consent card; Agree applies with declined opt-outs', async () => {
    const el = mount();
    const onReviewRecipe = vi.fn().mockResolvedValue({
      ok: true,
      recipe: { capabilities: { task: { atoms: ['complete'] } } },
      model: {
        enabledCaps: [{ key: 'tasks complete task', app: 'tasks', atom: 'complete', noun: 'task' }],
        features: [], settings: [],
        consent: { keys: ['tasks complete task'], items: [{ key: 'tasks complete task', app: 'tasks', atom: 'complete', noun: 'task', optedOut: false }] },
      },
    });
    const onApplyRecipe = vi.fn().mockResolvedValue('circle.recipeApply.applied');
    renderCircleSettings(el, { policy: DEFAULT_CIRCLE_POLICY, t, onReviewRecipe, onApplyRecipe });

    el.querySelector('textarea[data-role=recipe-source]').value = '{"capabilities":{"task":{"atoms":["complete"]}}}';
    el.querySelector('.circle-settings__recipe-apply').click();
    await Promise.resolve(); await Promise.resolve();

    // review was requested; nothing applied yet — the consent card is shown
    expect(onReviewRecipe).toHaveBeenCalledWith('{"capabilities":{"task":{"atoms":["complete"]}}}');
    expect(onApplyRecipe).not.toHaveBeenCalled();
    const card = document.querySelector('.recipe-consent-card');
    expect(card).not.toBeNull();

    // decline the optional cap, then Agree → applies with the declined key
    const box = card.querySelector('input[data-opt-cap="tasks complete task"]');
    box.checked = false; box.dispatchEvent(new Event('change'));
    card.querySelector('.recipe-consent-card__agree').click();
    await Promise.resolve(); await Promise.resolve();

    expect(onApplyRecipe).toHaveBeenCalledTimes(1);
    const [src, opts] = onApplyRecipe.mock.calls[0];
    expect(src).toBe('{"capabilities":{"task":{"atoms":["complete"]}}}');
    expect(opts.declinedKeys).toEqual(['tasks complete task']);
    expect(el.querySelector('[data-role=recipe-status]').textContent).toBe('circle.recipeApply.applied');
  });

  it('B consent-card — Decline shows the declined status and applies nothing', async () => {
    const el = mount();
    const onReviewRecipe = vi.fn().mockResolvedValue({
      ok: true, recipe: {},
      model: { enabledCaps: [], features: [], settings: [], consent: { keys: [], items: [] } },
    });
    const onApplyRecipe = vi.fn();
    renderCircleSettings(el, { policy: DEFAULT_CIRCLE_POLICY, t, onReviewRecipe, onApplyRecipe });
    el.querySelector('textarea[data-role=recipe-source]').value = '{}';
    el.querySelector('.circle-settings__recipe-apply').click();
    await Promise.resolve(); await Promise.resolve();
    const card = document.querySelector('.recipe-consent-card');
    const declineBtn = [...card.querySelectorAll('button')].find((b) => !b.classList.contains('recipe-consent-card__agree'));
    declineBtn.click();
    expect(onApplyRecipe).not.toHaveBeenCalled();
    expect(el.querySelector('[data-role=recipe-status]').textContent).toBe('circle.recipeConsent.declined');
  });

  it('renders the who-decides picker (the decision-kind unification) and honours custom saveLabel + note', () => {
    const el = mount();
    renderCircleSettings(el, { policy: DEFAULT_CIRCLE_POLICY, t, saveLabel: 'Send proposal', note: 'pending note' });
    const radios = el.querySelectorAll('input[data-field=whoDecides]');
    expect(radios).toHaveLength(3);                                          // any-admin · admin-quorum · member-vote
    expect([...radios].find((r) => r.checked)?.value).toBe('any-admin');     // the lived default
    expect(el.querySelector('.circle-settings__save').textContent).toBe('Send proposal');
    expect(el.querySelector('.circle-settings__note').textContent).toBe('pending note');
  });

  it('the who-decides picker writes the ONE decision table: onChange({ governance: { changePolicy } })', () => {
    const el = mount();
    const onChange = vi.fn();
    renderCircleSettings(el, { policy: DEFAULT_CIRCLE_POLICY, t, onChange });
    const quorum = [...el.querySelectorAll('input[data-field=whoDecides]')].find((r) => r.value === 'admin-quorum');
    quorum.checked = true;
    quorum.dispatchEvent(new Event('change'));
    expect(onChange).toHaveBeenCalledWith({ governance: expect.objectContaining({ changePolicy: 'admin-quorum' }) });
  });

  it('omits ⓘ consequence toggles when no consequence copy is translated', () => {
    const el = mount();
    renderCircleSettings(el, { policy: DEFAULT_CIRCLE_POLICY, t }); // t echoes the key → miss
    expect(el.querySelectorAll('.circle-settings__info')).toHaveLength(0);
    expect(el.querySelectorAll('.circle-settings__consequence')).toHaveLength(0);
  });

  it('renders a ⓘ + collapsed panel per enum option when consequence copy exists', () => {
    const el = mount();
    const tc = (k) => (k.startsWith('circle.settings.consequence.') ? `why ${k.split('.').pop()}` : k);
    renderCircleSettings(el, { policy: DEFAULT_CIRCLE_POLICY, t: tc });
    // One ⓘ per option across every shared axis. Derived rather than hardcoded: this `t` returns
    // consequence copy for EVERY key, so the expected count is simply "all options".
    const totalOptions = SETTINGS_ENUM_AXES.reduce((n, ax) => n + CIRCLE_POLICY_ENUMS[ax].length, 0);
    expect(totalOptions).toBeGreaterThan(20);        // non-vacuous: the axes really did resolve
    expect(el.querySelectorAll('.circle-settings__info')).toHaveLength(totalOptions);
    const panels = el.querySelectorAll('.circle-settings__consequence');
    expect(panels).toHaveLength(totalOptions);
    for (const p of panels) expect(p.hidden).toBe(true);
  });

  it('clicking ⓘ reveals its option panel and flips aria-expanded', () => {
    const el = mount();
    const tc = (k) => (k.startsWith('circle.settings.consequence.') ? `why ${k.split('.').pop()}` : k);
    renderCircleSettings(el, { policy: DEFAULT_CIRCLE_POLICY, t: tc });
    const info = el.querySelector('.circle-settings__info[data-opt=cloud]');
    const panel = el.querySelector('.circle-settings__consequence[data-opt=cloud]');
    expect(panel.hidden).toBe(true);
    expect(info.getAttribute('aria-expanded')).toBe('false');
    info.click();
    expect(panel.hidden).toBe(false);
    expect(info.getAttribute('aria-expanded')).toBe('true');
    expect(panel.textContent).toBe('why cloud');
    info.click();
    expect(panel.hidden).toBe(true);
    expect(info.getAttribute('aria-expanded')).toBe('false');
  });
});

/**
 * Objective L — the sharePosture axis. It reuses the SAME generic radio +
 * consequence renderer as every other enum axis; these prove the 5 posture
 * options render with real locale labels/consequence copy (both langs) and
 * that selecting one round-trips through the circlePolicy store.
 */
describe('renderCircleSettings — sharePosture axis (objective L)', () => {
  // Mirror t(): walk the { text, doc } tree to the leaf .text, echo the key on a miss.
  const makeT = (tree) => (key) => {
    const path = key.replace(/^circle\./, '').split('.');
    let node = tree;
    for (const seg of path) { if (node == null || typeof node !== 'object') return key; node = node[seg]; }
    return node && typeof node === 'object' && typeof node.text === 'string' ? node.text : key;
  };

  it('renders all 5 posture options with resolved locale labels (nl + en)', async () => {
    for (const lang of ['en', 'nl']) {
      const tree = (await import(`../../src/locales/circle.${lang}.json`)).default;
      const tt = makeT(tree);
      const el = mount();
      renderCircleSettings(el, { policy: DEFAULT_CIRCLE_POLICY, t: tt });
      const axis = el.querySelector('.circle-settings__axis[data-axis=sharePosture]');
      expect(axis).not.toBeNull();
      const radios = axis.querySelectorAll('input[type=radio][name=sharePosture]');
      expect([...radios].map((r) => r.value)).toEqual(['closed', 'copy', 'trusted', 'registered', 'canonical']);
      // axis header + each option label + each consequence panel are real strings (no raw key leaked)
      expect(axis.querySelector('.circle-settings__section-title').textContent).not.toContain('circle.settings.sharePosture');
      for (const opt of ['closed', 'copy', 'trusted', 'registered', 'canonical']) {
        const span = axis.querySelector(`input[value=${opt}]`).closest('.circle-settings__opt').querySelector('span');
        expect(span.textContent).toBe(tt(`circle.settings.opt.${opt}`));
        expect(span.textContent.startsWith('circle.settings.')).toBe(false);
        const panel = axis.querySelector(`.circle-settings__consequence[data-opt=${opt}]`);
        expect(panel).not.toBeNull();
        expect(panel.textContent).toBe(tt(`circle.settings.consequence.${opt}`));
      }
    }
  });

  it('fires onChange({ sharePosture }) on select and round-trips through mergeCirclePolicy', () => {
    const el = mount();
    const onChange = vi.fn();
    renderCircleSettings(el, { policy: DEFAULT_CIRCLE_POLICY, t, onChange });
    const canonical = el.querySelector('.circle-settings__axis[data-axis=sharePosture] input[value=canonical]');
    canonical.checked = true;
    canonical.dispatchEvent(new Event('change'));
    expect(onChange).toHaveBeenCalledWith({ sharePosture: 'canonical' });

    // the emitted patch persists through the same policy path as every other axis
    const persisted = mergeCirclePolicy(DEFAULT_CIRCLE_POLICY, onChange.mock.calls[0][0]);
    expect(persisted.sharePosture).toBe('canonical');
    // and a re-render off the persisted policy shows the chosen option checked
    const el2 = mount();
    renderCircleSettings(el2, { policy: persisted, t });
    expect(el2.querySelector('.circle-settings__axis[data-axis=sharePosture] input[value=canonical]').checked).toBe(true);
  });
});

describe('B · Slice 2 — settings form + freedom matrix (sources-driven)', () => {
  const manifest = {
    app: 'demo', itemTypes: ['task'],
    settings: [
      { key: 'assignable', label: 'Assignable', kind: 'toggle', default: true, scope: 'circle' },
      { key: 'visibility', label: 'Visibility', kind: 'choice', of: ['members', 'admins'], default: 'members' },
    ],
    nouns: { task: { atoms: ['add', 'complete'] } },
    operations: [
      { id: 'addTask', verb: 'add', appliesTo: { type: 'task' } },
      { id: 'doneTask', verb: 'complete', appliesTo: { type: 'task' } },
    ],
  };
  const sources = [{ manifest }];
  const policy = { ...DEFAULT_CIRCLE_POLICY };

  it('renders the per-app settings form from manifest.settings', () => {
    const el = mount();
    renderCircleSettings(el, { policy, t, sources });
    const rows = el.querySelectorAll('.circle-settings__app-settings .circle-settings__setting');
    expect(rows).toHaveLength(2);
    expect(el.querySelector('[data-setting="demo.assignable"] input[type=checkbox]').checked).toBe(true);
    expect(el.querySelector('[data-setting="demo.visibility"] select').value).toBe('members');
  });

  it('renders one freedom row per (verb×noun) capability with enabled + freedom + consequence controls', () => {
    const el = mount();
    renderCircleSettings(el, { policy, t, sources });
    const caps = el.querySelectorAll('.circle-settings__capabilities .circle-settings__cap-row');
    expect(caps).toHaveLength(2);   // add·task, complete·task
    const addRow = el.querySelector('[data-cap="demo add task"]');
    expect(addRow.querySelector('input[data-role=enabled]').checked).toBe(true);
    expect(addRow.querySelector('select[data-role=freedom]')).toBeTruthy();
    expect(addRow.querySelector('select[data-role=consequence]')).toBeTruthy();
  });

  it('emits a full capability row on toggle (self-contained template entry)', () => {
    const el = mount();
    const onChange = vi.fn();
    renderCircleSettings(el, { policy, t, sources, onChange });
    const box = el.querySelector('[data-cap="demo add task"] input[data-role=enabled]');
    box.checked = false;
    box.dispatchEvent(new Event('change'));
    expect(onChange).toHaveBeenCalledWith({ capabilities: { 'demo add task': { enabled: false, freedom: 'optional', consequence: 'greyed', privacyFloor: false } } });
  });

  it('emits a settings patch keyed "<app>.<key>" on change', () => {
    const el = mount();
    const onChange = vi.fn();
    renderCircleSettings(el, { policy, t, sources, onChange });
    const sel = el.querySelector('[data-setting="demo.visibility"] select');
    sel.value = 'admins';
    sel.dispatchEvent(new Event('change'));
    expect(onChange).toHaveBeenCalledWith({ settings: { 'demo.visibility': 'admins' } });
  });

  it('renders nothing extra when sources is absent (older callers unaffected)', () => {
    const el = mount();
    renderCircleSettings(el, { policy, t });
    expect(el.querySelector('.circle-settings__capabilities')).toBeNull();
    expect(el.querySelector('.circle-settings__app-settings')).toBeNull();
  });
});

/**
 * D / consumer-switch — the settings header is now a genuine consumer of
 * the manifest PAGE projection (renderWeb → NavModel.pages[]).  These prove the
 * rendered <h2> label comes FROM the projection's labelKey via t(), not from a
 * hardcoded string — closing invariant #4's "zero consumers of .pages" gap.
 */
describe('renderCircleSettings — header sourced from the manifest page projection (D / SP-3b)', () => {
  it('renders the header label from page.labelKey via t() (NOT a hardcoded string)', () => {
    const el = mount();
    // A projected page with a labelKey; a t() that TAGS the key so we can prove
    // the label was resolved via t(labelKey) and did not come from a literal.
    const settingsPage = { opId: 'settings', kind: 'side-panel', title: 'Settings', labelKey: 'my.page.key' };
    const tagT = (k) => `PROJECTED:${k}`;
    renderCircleSettings(el, { policy: DEFAULT_CIRCLE_POLICY, t: tagT, settingsPage });
    const head = el.querySelector('.circle-settings__title');
    expect(head.textContent).toBe('PROJECTED:my.page.key');
    // And crucially NOT the previously-hardcoded key/string.
    expect(head.textContent).not.toBe('PROJECTED:circle.settings.title');
  });

  it('uses the REAL manifest projection: the live settings op → header label', () => {
    // End-to-end with the actual manifest: renderWeb projects the settings op's
    // surfaces.page (labelKey: circle.settings.title); the header resolves it.
    const el = mount();
    const settingsPage = pageForOp(basisManifest, 'settings');
    expect(settingsPage?.labelKey).toBe('circle.settings.title');
    const tagT = (k) => `T:${k}`;
    renderCircleSettings(el, { policy: DEFAULT_CIRCLE_POLICY, t: tagT, settingsPage });
    expect(el.querySelector('.circle-settings__title').textContent).toBe('T:circle.settings.title');
  });

  it('falls back to the raw page.title when the projection has no labelKey', () => {
    const el = mount();
    const settingsPage = { opId: 'settings', kind: 'side-panel', title: 'Instellingen' };
    renderCircleSettings(el, { policy: DEFAULT_CIRCLE_POLICY, t: (k) => k, settingsPage });
    expect(el.querySelector('.circle-settings__title').textContent).toBe('Instellingen');
  });

  it('falls back to tr(circle.settings.title) when no projected page is passed (older callers unchanged)', () => {
    const el = mount();
    renderCircleSettings(el, { policy: DEFAULT_CIRCLE_POLICY, t: (k) => `T:${k}` });
    expect(el.querySelector('.circle-settings__title').textContent).toBe('T:circle.settings.title');
  });
});
