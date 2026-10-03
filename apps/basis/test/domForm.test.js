/**
 * basis — DOM form rendering tests. v0.3.
 *
 * @vitest-environment happy-dom
 */
import { describe, it, expect, vi } from 'vitest';

import { buildFormSpec } from '../src/forms/buildFormSpec.js';
import { renderForm }    from '../src/web/domForm.js';

const ctx = (overrides = {}) => ({
  doc: document,
  onSubmit: () => {},
  onCancel: () => {},
  ...overrides,
});

describe('renderForm — happy path', () => {
  it('renders one field per spec.fields entry', () => {
    const spec = buildFormSpec({
      opParams: [
        { name: 'text', kind: 'string', required: true },
        { name: 'due',  kind: 'date' },
      ],
      missing: ['text'], prefilledArgs: {},
      opId: 'addTask', appOrigin: 'tasks',
    });
    const el = renderForm(spec, ctx());
    expect(el.querySelectorAll('.cc-form-field').length).toBe(2);
    expect(el.querySelector('.cc-field-string input')).not.toBeNull();
    // v0.7.-followup (3rd pass, 2026-05-23): date kind renders as
    // datetime-local — native browser picker for date AND time.
    // Slash-arg path uses parseDateAndTime for natural-language.
    expect(el.querySelector('.cc-field-date input[type="datetime-local"]')).not.toBeNull();
  });

  it("required marker '*' appended to label", () => {
    const spec = buildFormSpec({
      opParams: [{ name: 'x', kind: 'string', required: true }],
      missing: ['x'], prefilledArgs: {}, opId: 'op', appOrigin: 'a',
    });
    const el = renderForm(spec, ctx());
    expect(el.querySelector('.cc-field-label').textContent).toMatch(/x \*/);
  });

  it("enum renders as <select> with options", () => {
    const spec = buildFormSpec({
      opParams: [{ name: 'k', kind: 'enum', of: ['a','b','c'], required: true }],
      missing: ['k'], prefilledArgs: {}, opId: 'op', appOrigin: 'a',
    });
    const el = renderForm(spec, ctx());
    const sel = el.querySelector('select');
    expect(sel).not.toBeNull();
    expect(sel.querySelectorAll('option').length).toBe(3);
  });

  it("boolean renders as <input type=checkbox>", () => {
    const spec = buildFormSpec({
      opParams: [{ name: 'b', kind: 'boolean' }],
      missing: [], prefilledArgs: {}, opId: 'op', appOrigin: 'a',
    });
    const el = renderForm(spec, ctx());
    expect(el.querySelector('input[type="checkbox"]')).not.toBeNull();
  });

  it("prefilled value populates input + marks readOnly", () => {
    const spec = buildFormSpec({
      opParams: [
        { name: 'who', kind: 'string', required: true },
        { name: 't',   kind: 'string', required: true },
      ],
      missing: ['t'], prefilledArgs: { who: 'Anne' },
      opId: 'op', appOrigin: 'a',
    });
    const el = renderForm(spec, ctx());
    const whoInput = el.querySelector('[data-field-name="who"] input');
    expect(whoInput.value).toBe('Anne');
    expect(whoInput.readOnly).toBe(true);
  });

  it("strategy applied as CSS class", () => {
    const single = renderForm(buildFormSpec({
      opParams: [{ name: 'a', kind: 'string', required: true }],
      missing: ['a'], prefilledArgs: {}, opId: 'op', appOrigin: 'a',
    }), ctx());
    expect(single.classList.contains('cc-form-sequential')).toBe(true);

    const multi = renderForm(buildFormSpec({
      opParams: [
        { name: 'a', kind: 'string' }, { name: 'b', kind: 'string' },
      ],
      missing: ['a','b'], prefilledArgs: {}, opId: 'op', appOrigin: 'a',
    }), ctx());
    expect(multi.classList.contains('cc-form-inline')).toBe(true);
  });
});

describe('renderForm — submit + cancel', () => {
  it("onSubmit receives the form values", () => {
    const spec = buildFormSpec({
      opParams: [
        { name: 'text', kind: 'string', required: true },
        { name: 'urgent', kind: 'boolean' },
      ],
      missing: ['text'], prefilledArgs: {}, opId: 'addTask', appOrigin: 'a',
    });
    const onSubmit = vi.fn();
    const el = renderForm(spec, ctx({ onSubmit }));
    document.body.appendChild(el);

    const textInput = el.querySelector('[name="text"]');
    const boolInput = el.querySelector('[name="urgent"]');
    textInput.value = 'fix the door';
    boolInput.checked = true;

    el.querySelector('form').dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    expect(onSubmit).toHaveBeenCalledWith({ text: 'fix the door', urgent: true });
    document.body.removeChild(el);
  });

  it("onCancel fires when [Cancel] is clicked", () => {
    const spec = buildFormSpec({
      opParams: [{ name: 'x', kind: 'string', required: true }],
      missing: ['x'], prefilledArgs: {}, opId: 'op', appOrigin: 'a',
    });
    const onCancel = vi.fn();
    const el = renderForm(spec, ctx({ onCancel }));
    el.querySelector('.cc-form-cancel').click();
    expect(onCancel).toHaveBeenCalledOnce();
  });

  it("no cancel button rendered when onCancel omitted", () => {
    const spec = buildFormSpec({
      opParams: [{ name: 'x', kind: 'string', required: true }],
      missing: ['x'], prefilledArgs: {}, opId: 'op', appOrigin: 'a',
    });
    const el = renderForm(spec, { doc: document, onSubmit: () => {} });
    expect(el.querySelector('.cc-form-cancel')).toBeNull();
  });
});

describe('renderForm — input validation', () => {
  it("throws when ctx.doc missing", () => {
    expect(() => renderForm({}, { onSubmit: () => {} })).toThrow(/doc required/);
  });

  it("throws when onSubmit missing", () => {
    expect(() => renderForm({}, { doc: document })).toThrow(/onSubmit required/);
  });
});

describe('renderForm — a secret param', () => {
  it('is a password field the browser does not offer back', () => {
    const spec = buildFormSpec({
      opParams: [{ name: 'passphrase', kind: 'secret', required: true }],
      missing: ['passphrase'], prefilledArgs: {},
      opId: 'assistant-export-key-set', appOrigin: 'assistant',
    });
    const input = renderForm(spec, ctx()).querySelector('input[name="passphrase"]');
    expect(input?.type).toBe('password');
    expect(input?.autocomplete).toBe('new-password');
  });
});
