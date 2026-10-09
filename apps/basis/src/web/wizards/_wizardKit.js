/**
 * **Platform: web** (DOM-dependent).
 *
 * basis — shared wizard DOM helpers (2026-05-24).
 *
 * Extracted from C2/C1 (joinGroup + createGroup) so C3-C6 don't
 * copy-paste the boilerplate.  Every wizard module imports from here.
 *
 * Functions are deliberately small + DOM-imperative (no JSX, no
 * virtual DOM) so the chat-shell stays framework-free.  RN parallel
 * will provide React Native versions with the same exports.
 */

/** Multi-step header (step pills). */
export function mkSteps(container, doc, labels, active) {
  const header = doc.createElement('div');
  header.className = 'cc-wizard-steps';
  labels.forEach((label, idx) => {
    const n = idx + 1;
    const dot = doc.createElement('span');
    dot.className = `cc-wizard-step ${n === active ? 'cc-wizard-step-active' : ''} ${n < active ? 'cc-wizard-step-done' : ''}`;
    dot.textContent = label;
    header.appendChild(dot);
  });
  container.appendChild(header);
}

/** Body wrapper with heading + optional blurb. */
export function mkBody(doc, heading, blurb) {
  const wrap = doc.createElement('div');
  wrap.className = 'cc-wizard-body';
  if (heading) {
    const h = doc.createElement('h3');
    h.textContent = heading;
    wrap.appendChild(h);
  }
  if (blurb) {
    const p = doc.createElement('p');
    p.className = 'cc-wizard-blurb';
    p.textContent = blurb;
    wrap.appendChild(p);
  }
  return wrap;
}

/**
 * Action button row (sticky at the bottom of a step).
 * Pass `validate: 'key'` on a button to wire it for refreshActions —
 * input handlers can re-evaluate disabled state without rerender.
 */
export function mkActions(container, doc, buttons) {
  const row = doc.createElement('div');
  row.className = 'cc-wizard-actions';
  for (const b of buttons) {
    const btn = doc.createElement('button');
    btn.type = 'button';
    btn.className = `cc-wizard-btn cc-wizard-btn-${b.kind ?? 'secondary'} ${b.className ?? ''}`.trim();
    btn.textContent = b.label;
    btn.disabled = !!b.disabled;
    if (b.validate) btn.setAttribute('data-cc-validate', b.validate);
    btn.addEventListener('click', b.onClick);
    row.appendChild(btn);
  }
  container.appendChild(row);
}

/**
 * Refresh action-row buttons' disabled state by re-evaluating their
 * disabled-predicate.  Use this from text-input onInput handlers
 * INSTEAD of calling rerender() (which destroys the input + loses
 * focus / caret position).
 *
 * Each button must have a `data-cc-validate` attribute pointing at
 * a key in `predicates`; the value will be `!predicates[key]()`.
 *
 * @param {HTMLElement} container
 * @param {Record<string, () => boolean>} predicates
 */
export function refreshActions(container, predicates) {
  if (!container) return;
  for (const btn of container.querySelectorAll('button[data-cc-validate]')) {
    const key = btn.getAttribute('data-cc-validate');
    const fn = predicates[key];
    if (typeof fn === 'function') {
      btn.disabled = !fn();
    }
  }
}

/**
 * Single text/number input field with label + optional hint.
 * @param {HTMLElement} body
 * @param {Document}    doc
 * @param {string}      label
 * @param {string}      value
 * @param {(v: string) => void} onInput   fired on each keystroke.
 *   NOTE: DO NOT call rerender() from here — input gets recreated +
 *   loses focus.  Just mutate state + call refreshActions(container, …).
 * @param {object}      [extra]
 */
export function mkField(body, doc, label, value, onInput, extra = {}) {
  const wrap = doc.createElement('label');
  wrap.className = 'cc-wizard-field';
  const labelText = doc.createElement('span');
  labelText.className = 'cc-wizard-field-label';
  labelText.textContent = label;
  wrap.appendChild(labelText);
  const input = doc.createElement('input');
  input.type = extra.type ?? 'text';
  input.className = `cc-wizard-input${extra.monospace ? ' cc-wizard-input-mono' : ''}`;
  input.value = value;
  if (extra.placeholder) input.placeholder = extra.placeholder;
  input.addEventListener('input', () => onInput(input.value));
  wrap.appendChild(input);
  if (extra.hint) {
    const hint = doc.createElement('span');
    hint.className = 'cc-wizard-field-hint';
    hint.textContent = extra.hint;
    wrap.appendChild(hint);
  }
  body.appendChild(wrap);
}

/** Multi-line textarea field. */
export function mkTextarea(body, doc, label, value, onInput, extra = {}) {
  const labelEl = doc.createElement('div');
  labelEl.className = 'cc-wizard-field-label';
  labelEl.textContent = label;
  body.appendChild(labelEl);
  const ta = doc.createElement('textarea');
  ta.className = 'cc-wizard-textarea';
  ta.rows = extra.rows ?? 4;
  if (extra.placeholder) ta.placeholder = extra.placeholder;
  ta.value = value;
  ta.addEventListener('input', () => onInput(ta.value));
  body.appendChild(ta);
}

/** Single checkbox row with inline text. */
export function mkCheck(body, doc, text, checked, onToggle) {
  const row = doc.createElement('label');
  row.className = 'cc-wizard-check';
  const input = doc.createElement('input');
  input.type = 'checkbox';
  input.checked = checked;
  input.addEventListener('change', () => onToggle(input.checked));
  row.appendChild(input);
  row.appendChild(doc.createTextNode(' ' + text));
  body.appendChild(row);
}

/** Radio button group. */
export function mkRadioGroup(body, doc, label, value, options, onPick) {
  const group = doc.createElement('fieldset');
  group.className = 'cc-wizard-radio-group';
  const legend = doc.createElement('legend');
  legend.className = 'cc-wizard-field-label';
  legend.textContent = label;
  group.appendChild(legend);
  for (const o of options) {
    const row = doc.createElement('label');
    row.className = 'cc-wizard-radio';
    const input = doc.createElement('input');
    input.type = 'radio';
    input.name = `radio-${label}`;
    input.value = o.id;
    input.checked = value === o.id;
    input.addEventListener('change', () => onPick(o.id));
    row.appendChild(input);
    row.appendChild(doc.createTextNode(' ' + o.label));
    group.appendChild(row);
  }
  body.appendChild(group);
}

/** Error block — visible only when message is non-empty. */
export function mkError(body, doc, message) {
  if (!message) return;
  const err = doc.createElement('div');
  err.className = 'cc-wizard-error';
  err.textContent = message;
  body.appendChild(err);
}

/** Submitting status — visible when flag set. */
export function mkSubmitting(body, doc, flag, text = 'Submitting…') {
  if (!flag) return;
  const s = doc.createElement('div');
  s.className = 'cc-wizard-submitting';
  s.textContent = text;
  body.appendChild(s);
}

/**
 * A person's handle in a circle — the ONE field both wizards ask it with: joining (the handle you show there) and
 * creating (the founder's, when their profile has none). The input keeps focus while typing (`onInput`, no rerender);
 * a suggestion chip sets the value (`onPick`, the caller rerenders).
 */
export function mkHandleField(body, doc, { t, value = '', suggestions = [], onInput, onPick, label = null, hint = null }) {
  if (label) {
    const l = doc.createElement('div');
    l.className = 'cc-wizard-field-label';
    l.textContent = label;
    body.appendChild(l);
  }
  const input = doc.createElement('input');
  input.type = 'text';
  input.className = 'cc-wizard-handle-input';
  input.value = value;
  input.placeholder = t('circle.join.wizard.handle.placeholder');
  input.setAttribute('aria-label', label ?? t('circle.join.wizard.handle.label'));
  input.addEventListener('input', () => onInput?.(input.value.trim()));
  body.appendChild(input);
  if (hint) {
    const h = doc.createElement('div');
    h.className = 'cc-wizard-field-hint';
    h.textContent = hint;
    body.appendChild(h);
  }
  if (!suggestions.length) return input;
  const row = doc.createElement('div');
  row.className = 'cc-wizard-suggestions';
  for (const s of suggestions) {
    const chip = doc.createElement('button');
    chip.type = 'button';
    chip.className = 'cc-wizard-suggestion';
    chip.textContent = s;
    chip.addEventListener('click', () => onPick?.(s));
    row.appendChild(chip);
  }
  body.appendChild(row);
  return input;
}

