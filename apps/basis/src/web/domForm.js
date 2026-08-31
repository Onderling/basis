/**
 * **Platform: web** (DOM-dependent).  Needs an RN sibling under `rn/` — see
 * `Project Files/basis/coding-plan.md` § RN portability inventory.
 *
 * basis — DOM form adapter.
 *
 * Renders a `FormSpec` (from `forms/buildFormSpec.js`) into a DOM
 * `<form>` element with appropriate inputs per field kind.  On
 * submit, the caller's onSubmit gets the form's values; on cancel,
 * the caller's onCancel fires.
 *
 * Strategy → CSS classes:
 *   'sequential' — single field; submit on enter
 *   'inline'     — 2-3 fields stacked compactly
 *   'mini-page'  — 4+ fields; submit button in a footer
 *
 * Phase v0.3 (DOM half).
 */

import { translatorOr } from '../locales/translatorOr.js';

/**
 * @param {import('../forms/buildFormSpec.js').FormSpec} spec
 * @param {object} ctx
 * @param {Document} ctx.doc
 * @param {(formValues: object) => void} ctx.onSubmit
 * @param {() => void}                    [ctx.onCancel]
 * @param {(key: string, params?: object) => string} [ctx.t]
 * @param {(decl: object) => Promise<Array<{id, label}>>} [ctx.pickerFetcher]
 *   v0.7. — when a field has `pickerSource`, this fetcher resolves
 *   the choices list at render-time.  The DOM adapter renders a
 *   click-to-pick list instead of a text input.
 * @returns {Element}
 */
export function renderForm(spec, ctx) {
  if (!ctx?.doc)      throw new TypeError('renderForm: ctx.doc required');
  if (typeof ctx.onSubmit !== 'function') {
    throw new TypeError('renderForm: ctx.onSubmit required');
  }
  const { doc, onSubmit, onCancel, t, pickerFetcher } = ctx;
  const tr = translatorOr(t, 'domForm.js');

  const wrap = doc.createElement('div');
  wrap.className = `cc-message cc-shell cc-form cc-form-${spec.strategy}`;

  const heading = doc.createElement('div');
  heading.className = 'cc-form-heading';
  heading.textContent = tr('form.heading', { opId: spec.opId });
  wrap.appendChild(heading);

  const form = doc.createElement('form');
  form.className = 'cc-form-body';

  for (const field of spec.fields) {
    form.appendChild(renderField(field, { doc, tr, pickerFetcher, onSubmit }));
  }

  const actions = doc.createElement('div');
  actions.className = 'cc-form-actions';

  const submit = doc.createElement('button');
  submit.type = 'submit';
  submit.className = 'cc-form-submit';
  submit.textContent = tr('form.submit');
  actions.appendChild(submit);

  if (typeof onCancel === 'function') {
    const cancel = doc.createElement('button');
    cancel.type = 'button';
    cancel.className = 'cc-form-cancel';
    cancel.textContent = tr('form.cancel');
    // v0.7.-followup 2026-05-23 (5th pass): after a successful
    // submit, the cancel button is relabelled to 'Close'.  Clicking
    // it should NOT fire onCancel (which adds 'Form cancelled' to
    // chat — confusing when the submit already succeeded).  We
    // gate the click on the same `alreadySubmitted` flag defined
    // below; until submit, click runs onCancel; afterwards, it's
    // a no-op (visually the form is just hidden by submission).
    cancel.addEventListener('click', () => {
      if (alreadySubmitted) return;
      onCancel();
    });
    actions.appendChild(cancel);
  }
  form.appendChild(actions);

  // v0.7.-followup 2026-05-23 (3rd pass): one-shot submit guard.
  // Form messages have a live DOM node that re-renders across the
  // thread stream.  If the user clicks Submit twice (or hits Enter
  // after the first submit), the listener used to fire each click.
  // Now: first successful submit marks the form 'submitted' +
  // disables the submit button + ignores subsequent submits.
  let alreadySubmitted = false;
  form.addEventListener('submit', (e) => {
    e.preventDefault();
    if (alreadySubmitted) return;
    alreadySubmitted = true;
    submit.disabled = true;
    submit.textContent = tr('form.submitted', { defaultValue: '✓ Submitted' });
    if (typeof onCancel === 'function') {
      // Re-purpose the cancel button as a 'close' affordance once
      // the form has been used — keeps the panel out of the way.
      const cancelBtn = actions.querySelector('.cc-form-cancel');
      if (cancelBtn) {
        cancelBtn.textContent = tr('form.close',
          { defaultValue: 'Close' });
      }
    }
    const values = readFormValues(form, spec);
    onSubmit(values);
  });

  wrap.appendChild(form);
  return wrap;
}

function renderField(field, { doc, tr, pickerFetcher, onSubmit }) {
  // v0.7. — pickerSource overrides the input kind. Render a
  // clickable list whose rows pick the value + submit the form
  // immediately (the bare-/claim, bare-/done UX flow).
  if (field.pickerSource && typeof pickerFetcher === 'function') {
    return renderPickerField(field, { doc, tr, pickerFetcher, onSubmit });
  }

  const row = doc.createElement('label');
  row.className = `cc-form-field cc-field-${field.kind}`;
  row.dataset.fieldName = field.name;

  const label = doc.createElement('span');
  label.className = 'cc-field-label';
  label.textContent = (field.labelKey ? tr(field.labelKey) : field.name)
                    + (field.required ? ' *' : '');
  row.appendChild(label);

  const input = makeInput(field, doc);
  input.name = field.name;
  if (field.required) input.required = true;
  if (field.readOnly && field.value !== undefined) {
    if ('readOnly' in input) input.readOnly = true;
  }
  if (field.value !== undefined && 'value' in input) input.value = String(field.value);
  if (field.placeholder && 'placeholder' in input) input.placeholder = field.placeholder;
  row.appendChild(input);

  if (field.hint) {
    const hint = doc.createElement('span');
    hint.className = 'cc-field-hint';
    hint.textContent = field.hint;
    row.appendChild(hint);
  }
  return row;
}

/**
 * v0.7. — render a field whose manifest declared `pickerSource`.
 * Fetches the list at render time + renders one button per row.
 * Clicking a row sets a hidden input + auto-submits the form.
 */
function renderPickerField(field, { doc, tr, pickerFetcher, onSubmit }) {
  const row = doc.createElement('div');
  row.className = `cc-form-field cc-field-picker cc-field-${field.kind}`;
  row.dataset.fieldName = field.name;

  const label = doc.createElement('div');
  label.className = 'cc-field-label';
  label.textContent = (field.labelKey ? tr(field.labelKey) : field.name)
                    + (field.required ? ' *' : '');
  row.appendChild(label);

  // Hidden input so the form serialises this field's selected value.
  const hidden = doc.createElement('input');
  hidden.type = 'hidden';
  hidden.name = field.name;
  if (field.value !== undefined) hidden.value = String(field.value);
  if (field.required) hidden.required = true;
  row.appendChild(hidden);

  const list = doc.createElement('div');
  list.className = 'cc-picker-list cc-picker-loading';
  list.textContent = tr('form.picker.loading');
  row.appendChild(list);

  Promise.resolve(pickerFetcher(field.pickerSource))
    .then((items) => {
      list.classList.remove('cc-picker-loading');
      while (list.firstChild) list.removeChild(list.firstChild);
      if (!Array.isArray(items) || items.length === 0) {
        list.classList.add('cc-picker-empty');
        list.textContent = tr('form.picker.empty');
        return;
      }
      for (const it of items) {
        const btn = doc.createElement('button');
        btn.type = 'button';
        btn.className = 'cc-picker-row';
        btn.dataset.itemId = it.id;
        btn.textContent = it.label ?? it.id;
        btn.addEventListener('click', () => {
          hidden.value = it.id;
          // Submit immediately — single-pick UX.
          const form = btn.closest('form');
          if (form) form.requestSubmit?.() ?? form.dispatchEvent(new Event('submit', { cancelable: true }));
        });
        list.appendChild(btn);
      }
    })
    .catch((err) => {
      list.classList.remove('cc-picker-loading');
      list.classList.add('cc-picker-error');
      list.textContent = tr('form.picker.error', { error: err?.message ?? String(err) });
    });

  return row;
}

function makeInput(field, doc) {
  switch (field.kind) {
    case 'number': {
      const i = doc.createElement('input');
      i.type = 'number';
      return i;
    }
    case 'boolean': {
      const i = doc.createElement('input');
      i.type = 'checkbox';
      return i;
    }
    case 'enum': {
      const sel = doc.createElement('select');
      for (const c of field.choices ?? []) {
        const opt = doc.createElement('option');
        opt.value = c;
        opt.textContent = c;
        sel.appendChild(opt);
      }
      return sel;
    }
    case 'date': {
      // v0.7.-followup 2026-05-23 (3rd pass): user reverted on
      // text-only date input — they want the native calendar picker
      // back AND the time component visible.  Use datetime-local
      // which gives the date PICKER + a time field, native browser
      // UI.  Free-text natural-language ('tomorrow 3pm') still
      // works via the slash-command path
      // (--when='tomorrow 3pm' → parseDateAndTime).
      const i = doc.createElement('input');
      i.type = 'datetime-local';
      i.autocomplete = 'off';
      return i;
    }
    case 'webid': {
      const i = doc.createElement('input');
      i.type = 'text';
      i.placeholder = 'webid:...';
      return i;
    }
    default: {
      const i = doc.createElement('input');
      i.type = 'text';
      return i;
    }
  }
}

function readFormValues(form, spec) {
  const out = {};
  for (const field of spec.fields) {
    const el = form.querySelector(`[name="${cssEscape(field.name)}"]`);
    if (!el) continue;
    if (field.kind === 'boolean') {
      out[field.name] = !!el.checked;
    } else {
      out[field.name] = el.value;
    }
  }
  return out;
}

/** Minimal CSS.escape polyfill for happy-dom + safety. */
function cssEscape(s) {
  return String(s).replace(/[^a-zA-Z0-9_-]/g, (c) => `\\${c}`);
}
