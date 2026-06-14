/**
 * Plain consent-card modal for installing an extension (feedback-extension P2c-3, web).
 *
 * Vanilla DOM (matches the app's other web UI); `doc`/`t` injectable for tests.
 * Renders the model from `buildConsentModel` — the commands it adds, what each
 * invokes, the atoms it needs, the scope, and "what if I deny?" — and resolves
 * Add/Decline. A REFUSED mapping (the sandbox verifier failed) shows the
 * "capabilities not available here" message instead of an Add button.
 *
 * Strings go through `t()` (circle.extension.*); NO hardcoded English.
 */

import { t as defaultT } from '../localisation.js';

function btn(doc, label, onClick) {
  const b = doc.createElement('button');
  b.type = 'button';
  b.textContent = label;
  b.style.cssText = 'padding:8px 14px;border-radius:8px;border:1px solid #ccc;cursor:pointer;background:#f5f5f5;';
  b.addEventListener('click', onClick);
  return b;
}

/**
 * Show the consent card for a `buildConsentModel` result.
 *
 * @param {{ ok: boolean, missing?: string[], card?: object }} result
 * @param {{ onAdd?: Function, onDecline?: Function, doc?: Document, t?: Function }} [opts]
 * @returns {{ close: () => void, el: HTMLElement }}
 */
export function showConsentCard(result, { onAdd, onDecline, doc = globalThis.document, t = defaultT } = {}) {
  const overlay = doc.createElement('div');
  overlay.className = 'ext-consent-overlay';
  overlay.setAttribute('role', 'dialog');
  overlay.setAttribute('aria-modal', 'true');
  overlay.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.4);display:flex;align-items:center;justify-content:center;z-index:9999;';

  const panel = doc.createElement('div');
  panel.className = 'ext-consent-card';
  panel.style.cssText = 'background:#fff;max-width:440px;width:90%;padding:20px;border-radius:12px;font-family:system-ui,sans-serif;box-shadow:0 8px 30px rgba(0,0,0,.2);';
  overlay.appendChild(panel);

  const close = () => { try { overlay.remove(); } catch { /* already gone */ } };

  // Refused — the verifier found unresolved opIds.
  if (!result || !result.ok) {
    const msg = doc.createElement('p');
    msg.textContent = t('circle.extension.refused', { missing: (result?.missing ?? []).join(', ') });
    panel.appendChild(msg);
    const actions = doc.createElement('div');
    actions.style.cssText = 'display:flex;justify-content:flex-end;margin-top:12px;';
    actions.appendChild(btn(doc, t('circle.extension.decline'), () => { close(); onDecline?.(); }));
    panel.appendChild(actions);
    doc.body.appendChild(overlay);
    return { close, el: panel };
  }

  const card = result.card;

  const h = doc.createElement('h3');
  h.style.cssText = 'margin:0 0 12px;';
  h.textContent = t('circle.extension.title', { title: card.title });
  panel.appendChild(h);

  const addsLabel = doc.createElement('p');
  addsLabel.style.cssText = 'margin:8px 0 4px;font-weight:600;';
  addsLabel.textContent = t('circle.extension.adds');
  panel.appendChild(addsLabel);

  const ul = doc.createElement('ul');
  ul.style.cssText = 'margin:0 0 8px;padding-left:18px;';
  for (const c of card.commands) {
    const li = doc.createElement('li');
    li.textContent = c.invokes.length
      ? `${c.command} — ${t('circle.extension.invokes', { ops: c.invokes.join(', ') })}`
      : c.command;
    ul.appendChild(li);
  }
  panel.appendChild(ul);

  if (card.needs.length) {
    const needs = doc.createElement('p');
    needs.style.cssText = 'margin:8px 0;';
    needs.textContent = t('circle.extension.needs', { atoms: card.needs.join(', ') });
    panel.appendChild(needs);
  }

  const scope = doc.createElement('p');
  scope.style.cssText = 'margin:8px 0;color:#444;';
  scope.textContent = t(card.scope === 'circle' ? 'circle.extension.scope_circle' : 'circle.extension.scope_app');
  panel.appendChild(scope);

  const deny = doc.createElement('p');
  deny.style.cssText = 'color:#666;font-size:.9em;margin:8px 0 0;';
  deny.textContent = t('circle.extension.what_if_deny');
  panel.appendChild(deny);

  const actions = doc.createElement('div');
  actions.style.cssText = 'display:flex;gap:8px;justify-content:flex-end;margin-top:16px;';
  actions.appendChild(btn(doc, t('circle.extension.decline'), () => { close(); onDecline?.(); }));
  const addBtn = btn(doc, t('circle.extension.add'), () => { close(); onAdd?.(); });
  addBtn.style.cssText += 'background:#1a7f5a;color:#fff;border-color:#1a7f5a;font-weight:600;';
  actions.appendChild(addBtn);
  panel.appendChild(actions);

  doc.body.appendChild(overlay);
  return { close, el: panel };
}
