/**
 * The contact-lens form — what a contact sees of you (L125). One paint for two moments: the ADD SHEET (a scanned
 * card or a link, before the contact is added) and the THREAD HEADER control (changing it later). The logic is
 * `src/v2/contactLens.js`; this paints a model and hands back the choice. Mounted through the wizard overlay
 * (`mountMyDataWizard`), so it takes that adapter's `{ container, doc, onClose }`.
 *
 * The hint is the honest sentence: a different VIEW of the same person, never a second identity (ledger L123).
 */
import { translatorOr } from '../../src/locales/translatorOr.js';

/**
 * @param {object} o
 * @param {HTMLElement} o.container
 * @param {Document} [o.doc]
 * @param {Function} [o.t]
 * @param {Function} o.onClose               the overlay's close
 * @param {'add'|'change'} o.mode
 * @param {{name: string, personas: Array<{id,name}>, persona: string, presets: string[], revealPreset: string}} o.model
 * @param {(choice: {persona: string, revealPreset: string}) => (void|Promise<void>)} o.onSubmit
 * @param {() => void} [o.onCancel]
 */
export function renderContactLensPanel({ container, doc = document, t, onClose, mode = 'change', model, onSubmit, onCancel = null, setCloseGuard = null }) {
  const tr = translatorOr(t, 'contactLensPanel.js');
  container.innerHTML = '';
  const wrap = doc.createElement('div');
  wrap.className = 'cc-lens';
  wrap.dataset.testid = mode === 'add' ? 'contact-add-sheet' : 'contact-lens';

  const h = doc.createElement('h2');
  h.className = 'cc-lens__title';
  h.textContent = mode === 'add'
    ? tr('circle.contacts.add_sheet.title', { name: model.name })
    : tr('circle.contacts.lens.title', { name: model.name });
  wrap.appendChild(h);
  if (mode === 'add') {
    const intro = doc.createElement('p');
    intro.className = 'cc-lens__intro';
    intro.textContent = tr('circle.contacts.add_sheet.intro', { name: model.name });
    wrap.appendChild(intro);
  }

  const choice = { persona: model.persona, revealPreset: model.revealPreset };
  // A click outside the overlay closes it with no word to us — count that as a cancel, once, so a caller waiting
  // on the choice is never left waiting.
  let settled = false;
  const cancelOnce = () => { if (!settled) { settled = true; try { onCancel?.(); } catch { /* the caller's */ } } };
  if (typeof setCloseGuard === 'function') setCloseGuard(() => { cancelOnce(); return true; });
  const field = (labelKey, cls, options, value, onPick) => {
    const lab = doc.createElement('label');
    lab.className = 'cc-lens__field';
    const span = doc.createElement('span');
    span.className = 'cc-lens__label';
    span.textContent = tr(labelKey);
    lab.appendChild(span);
    const sel = doc.createElement('select');
    sel.className = cls;
    for (const o of options) {
      const opt = doc.createElement('option');
      opt.value = o.id;
      opt.textContent = o.label;
      sel.appendChild(opt);
    }
    sel.value = value;
    sel.addEventListener('change', () => onPick(sel.value));
    lab.appendChild(sel);
    wrap.appendChild(lab);
  };
  // The default persona is always offered, even when the list could not be read: it is the one that exists.
  const personas = model.personas?.length ? model.personas : [{ id: 'default', name: 'default' }];
  field('circle.contacts.lens.persona', 'cc-lens__persona', personas.map((p) => ({
    id: p.id,
    label: p.id === 'default' ? tr('circle.join.wizard.persona.default_suffix', { name: p.name }) : p.name,
  })), choice.persona, (v) => { choice.persona = v; });
  field('circle.contacts.lens.level', 'cc-lens__level', (model.presets ?? []).map((p) => ({
    id: p, label: tr(`circle.reveal.preset.${p}`),
  })), choice.revealPreset, (v) => { choice.revealPreset = v; });

  const hint = doc.createElement('p');
  hint.className = 'cc-lens__hint';
  hint.textContent = tr('circle.contacts.lens.hint');
  wrap.appendChild(hint);

  const actions = doc.createElement('div');
  actions.className = 'cc-lens__actions';
  const cancel = doc.createElement('button');
  cancel.type = 'button';
  cancel.className = 'cc-lens__cancel';
  cancel.textContent = tr('circle.contacts.lens.cancel');
  cancel.addEventListener('click', () => { try { cancelOnce(); } finally { onClose?.(); } });
  const ok = doc.createElement('button');
  ok.type = 'button';
  ok.className = 'cc-lens__ok';
  ok.textContent = tr(mode === 'add' ? 'circle.contacts.add_sheet.add' : 'circle.contacts.lens.save');
  ok.addEventListener('click', async () => {
    ok.disabled = true;
    settled = true;
    try { await onSubmit?.({ ...choice }); } finally { onClose?.(); }
  });
  actions.append(cancel, ok);
  wrap.appendChild(actions);
  container.appendChild(wrap);
  return container;
}
