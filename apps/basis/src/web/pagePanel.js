/**
 * **Platform: web** (DOM-dependent).  Needs an RN sibling under `rn/`
 * once the mobile pivot lands (chat-nav RN parallel maps
 * `surfaces.page` to RN nav screens).
 *
 * basis — generic side-panel page renderer (2026-05-24).
 *
 * Renders any op that declares `surfaces.page: { kind, title?, route? }`
 * as a togglable side-panel.  Two content modes:
 *
 *   - **simple (V0)** — op has params + a single dispatch.  Panel
 *     shows a title bar + a form (built from op.params via
 *     buildFormSpec, rendered via renderForm) + [Submit] / [Cancel].
 *     Submit dispatches via callSkill; reply closes panel + appears
 *     as a chat message.
 *
 *   - **custom** — caller passes `customRenderer({container, onClose,
 *     onDispatch})` for arbitrary content (multi-step wizards land
 *     this way; each wizard exports its own renderer).  Cluster C
 *     items (create-group, redeem-invite gate, restore-from-mnemonic,
 *     conflict dispute, audience picker, encrypted backup) build on
 *     top of this hook.
 *
 * Stateless from the caller's POV: caller invokes `openPagePanel(...)`,
 * the panel manages its own DOM + close lifecycle.  Closing via the
 * [×] button or via onClose() removes the panel content + hides the
 * <aside>.
 */

import { buildFormSpec, validateAndCoerce } from '../forms/buildFormSpec.js';
import { renderForm }                       from './domForm.js';
import { renderFloatingButton }             from '@onderling/chat-nav';

/**
 * @typedef {object} PagePanelOptions
 * @property {HTMLElement}                              container
 *   The <aside id="page-panel"> element.  Caller toggles `hidden`.
 * @property {Document}                                 doc
 * @property {object}                                   op
 *   The manifest op being opened.  Must have `surfaces.page` set.
 * @property {string}                                   appOrigin
 * @property {object}                                   [args]
 *   Pre-filled args (e.g. from a button click on a row).
 * @property {Function}                                 callSkill
 *   `(appOrigin, opId, args) => Promise<payload>`
 * @property {Function}                                 onClose
 *   Called when user closes the panel; caller hides the <aside>.
 * @property {Function}                                 [onDispatched]
 *   Optional hook fired after a successful dispatch (panel auto-closes).
 *   `(reply) => void`
 * @property {(t: PagePanelOptions) => void}            [customRenderer]
 *   Wizard-mode renderer; overrides the simple form.  Receives the
 *   full PagePanelOptions; responsible for clearing + rebuilding
 *   container contents.
 * @property {object}                                   [t]
 *   Localisation function (basis's `i18next.t`).
 * @property {object}                                   [backTo]
 *   chat-nav "← back to chat" affordance (E4).  When present, a
 *   floating button closes the panel and refocuses the origin thread.
 * @property {string}                                   backTo.returnTo
 * @property {string}                                   [backTo.label]
 * @property {() => void}                               [backTo.onNavigate]
 */

/**
 * Open the panel for an op.  Clears the container, renders header +
 * content, returns a teardown function the caller can call to force-
 * close (e.g. on route change).
 *
 * @param {PagePanelOptions} opts
 * @returns {() => void}  teardown
 */
export function openPagePanel(opts) {
  const { container, doc, op, appOrigin } = opts;
  if (!container) throw new TypeError('openPagePanel: container required');
  if (!doc)       throw new TypeError('openPagePanel: doc required');
  if (!op?.surfaces?.page) {
    throw new TypeError('openPagePanel: op.surfaces.page required');
  }

  // Reset.
  container.innerHTML = '';
  container.classList.remove('cc-page-closed');
  container.classList.add('cc-page-open');
  container.hidden = false;

  // Title bar.
  const header = doc.createElement('div');
  header.className = 'cc-page-header';
  const titleEl = doc.createElement('span');
  titleEl.className = 'cc-page-title';
  titleEl.textContent = op.surfaces.page.title
    ?? op.surfaces?.chat?.hint
    ?? `${appOrigin}.${op.id}`;
  header.appendChild(titleEl);

  const closeBtn = doc.createElement('button');
  closeBtn.type = 'button';
  closeBtn.className = 'cc-page-close';
  closeBtn.setAttribute('aria-label', opts.t ? opts.t('common.close_panel') : 'Close panel');
  closeBtn.textContent = '×';
  const teardown = () => {
    container.innerHTML = '';
    container.classList.remove('cc-page-open');
    container.classList.add('cc-page-closed');
    container.hidden = true;
    if (typeof opts.onClose === 'function') {
      try { opts.onClose(); } catch { /* swallow */ }
    }
  };
  closeBtn.addEventListener('click', teardown);
  header.appendChild(closeBtn);
  container.appendChild(header);

  // Body.
  const body = doc.createElement('div');
  body.className = 'cc-page-body';
  container.appendChild(body);

  // Back-to-chat (E4, chat-nav) — closes the panel + refocuses origin.
  if (opts.backTo?.returnTo) {
    renderFloatingButton(container, {
      doc,
      returnTo:   opts.backTo.returnTo,
      label:      opts.backTo.label,
      onNavigate: () => {
        teardown();
        if (typeof opts.backTo.onNavigate === 'function') opts.backTo.onNavigate();
      },
    });
  }

  if (typeof opts.customRenderer === 'function') {
    // Wizard mode: let the caller draw whatever it wants inside body.
    opts.customRenderer({ ...opts, container: body, onClose: teardown });
    return teardown;
  }

  // Simple mode: form built from op.params.
  renderSimplePage(body, doc, opts, teardown);
  return teardown;
}

/**
 * E5 — frame an already-rendered content node (a record / mini-page
 * panel produced by `renderToDom`) in the wide side panel.  Unlike
 * `openPagePanel`, this takes no manifest op: it just hosts existing
 * rendered content, letting the user pin a mini-page to the side while
 * they keep scrolling the chat.
 *
 * @param {object} opts
 * @param {HTMLElement} opts.container   the <aside> page-panel element
 * @param {Document}    opts.doc
 * @param {Node}        opts.content     DOM node to host (e.g. renderToDom output)
 * @param {string}      [opts.title]
 * @param {object}      [opts.t]
 * @param {Function}    [opts.onClose]
 * @param {object}      [opts.backTo]    chat-nav descriptor (see openPagePanel)
 * @returns {() => void}  teardown
 */
export function openContentPanel(opts) {
  const { container, doc, content } = opts;
  if (!container) throw new TypeError('openContentPanel: container required');
  if (!doc)       throw new TypeError('openContentPanel: doc required');
  if (!content)   throw new TypeError('openContentPanel: content node required');

  container.innerHTML = '';
  container.classList.remove('cc-page-closed');
  container.classList.add('cc-page-open');
  container.hidden = false;

  const header = doc.createElement('div');
  header.className = 'cc-page-header';
  const titleEl = doc.createElement('span');
  titleEl.className = 'cc-page-title';
  titleEl.textContent = opts.title
    ?? (opts.t ? opts.t('chat.nav.openInFull') : 'Open in full');
  header.appendChild(titleEl);

  const closeBtn = doc.createElement('button');
  closeBtn.type = 'button';
  closeBtn.className = 'cc-page-close';
  closeBtn.setAttribute('aria-label', opts.t ? opts.t('common.close_panel') : 'Close panel');
  closeBtn.textContent = '×';
  const teardown = () => {
    container.innerHTML = '';
    container.classList.remove('cc-page-open');
    container.classList.add('cc-page-closed');
    container.hidden = true;
    if (typeof opts.onClose === 'function') {
      try { opts.onClose(); } catch { /* swallow */ }
    }
  };
  closeBtn.addEventListener('click', teardown);
  header.appendChild(closeBtn);
  container.appendChild(header);

  const body = doc.createElement('div');
  body.className = 'cc-page-body cc-page-body-content';
  body.appendChild(content);
  container.appendChild(body);

  if (opts.backTo?.returnTo) {
    renderFloatingButton(container, {
      doc,
      returnTo:   opts.backTo.returnTo,
      label:      opts.backTo.label,
      onNavigate: () => {
        teardown();
        if (typeof opts.backTo.onNavigate === 'function') opts.backTo.onNavigate();
      },
    });
  }

  return teardown;
}

/**
 * Default form-based page renderer.  Builds a form from op.params,
 * dispatches on submit, closes on success.
 */
function renderSimplePage(body, doc, opts, teardown) {
  const { op, appOrigin, args, callSkill, onDispatched, t } = opts;
  // buildFormSpec takes a named-args object, NOT (op, args).  All
  // params render as fields (missing=[] means inline strategy = show
  // every field as editable).  prefilledArgs populates initial values.
  const formSpec = buildFormSpec({
    opParams:      Array.isArray(op.params) ? op.params : [],
    missing:       [],
    prefilledArgs: args ?? {},
    opId:          op.id,
    appOrigin,
  });

  // Hint / blurb (uses chat hint as the panel's intro line).
  if (op.surfaces?.chat?.hint) {
    const hint = doc.createElement('p');
    hint.className = 'cc-page-hint';
    hint.textContent = op.surfaces.chat.hint;
    body.appendChild(hint);
  }

  const formEl = doc.createElement('div');
  formEl.className = 'cc-page-form';
  body.appendChild(formEl);

  // Status line (success / error feedback).
  const status = doc.createElement('div');
  status.className = 'cc-page-status';
  status.setAttribute('aria-live', 'polite');
  body.appendChild(status);

  const handleSubmit = async (collectedArgs) => {
    status.textContent = '';
    status.classList.remove('cc-page-status-error');
    try {
      const validated = validateAndCoerce(formSpec, collectedArgs);
      if (validated.errors?.length > 0) {
        status.classList.add('cc-page-status-error');
        status.textContent = validated.errors.map((e) => e.message).join('; ');
        return;
      }
      const reply = await callSkill(appOrigin, op.id, validated.args);
      if (reply?.ok === false) {
        status.classList.add('cc-page-status-error');
        status.textContent = reply.error
          ?? (t ? t('common.failed') : 'Failed');
        return;
      }
      if (typeof onDispatched === 'function') {
        try { onDispatched(reply); } catch { /* swallow */ }
      }
      teardown();
    } catch (err) {
      status.classList.add('cc-page-status-error');
      status.textContent = err?.message ?? String(err);
    }
  };

  // renderForm returns a wrap element with the rendered form inside.
  // It calls onSubmit(formValues) on the submit button click.
  const formWrap = renderForm(formSpec, {
    doc,
    onSubmit: handleSubmit,
    onCancel: teardown,
    t,
  });
  formEl.appendChild(formWrap);
}
