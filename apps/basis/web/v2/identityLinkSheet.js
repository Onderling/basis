/**
 * identityLinkSheet — the sheet the web app opens for a bot's `/koppel` link: which bot, what linking means, the line
 * to paste into the private chat with the bot, the code to pick there, and "linked" once the bot's statement arrives (the
 * bot is then a contact). Paint only; what it does is `src/v2/identityLinkView.js`.
 */
import { t } from '../../src/index.js';

const el = (doc, tag, attrs = {}, ...kids) => {
  const n = doc.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) { if (k === 'onclick') n.addEventListener('click', v); else n.setAttribute(k, v); }
  for (const k of kids) n.append(k);
  return n;
};

/**
 * @param {ReturnType<import('../../src/v2/identityLinkView.js').createIdentityLinkView>} view
 * @param {{doc?: Document, win?: Window}} [a]
 * @returns {{linked: () => void, close: () => void}}  `linked()` is called by the peer router when the statement lands
 */
export function openIdentityLinkSheet(view, { doc = document, win = window } = {}) {
  const dialog = el(doc, 'dialog', { class: 'cc-identity-link', 'data-identity-link': 'sheet' });
  const say = (...nodes) => dialog.replaceChildren(el(doc, 'h2', {}, t('circle.identityLink.title')), ...nodes,
    el(doc, 'button', { type: 'button', 'data-identity-link': 'close', onclick: () => dialog.close() }, t('circle.identityLink.close')));
  const bot = view.label;
  const make = el(doc, 'button', { type: 'button', 'data-identity-link': 'make', onclick: async () => {
    make.disabled = true;
    const made = await view.offer();
    if (!made.ok) { say(el(doc, 'p', { 'data-identity-link': 'failed' }, t('circle.identityLink.no_device_key'))); return; }
    const { line, code } = made;
    say(
      el(doc, 'p', {}, t('circle.identityLink.paste_this', { bot })),
      el(doc, 'textarea', { readonly: 'readonly', rows: '3', 'data-identity-link': 'line' }, line),
      el(doc, 'button', { type: 'button', onclick: () => { try { win.navigator.clipboard?.writeText(line); } catch { /* select it by hand */ } } }, t('circle.identityLink.copy')),
      el(doc, 'p', {}, t('circle.identityLink.code')),
      el(doc, 'p', { class: 'cc-identity-link__code', 'data-identity-link': 'code' }, code),
      el(doc, 'p', { 'data-identity-link': 'waiting' }, t('circle.identityLink.waiting')),
    );
  } }, t('circle.identityLink.make'));
  say(el(doc, 'p', {}, t('circle.identityLink.which_bot', { bot })), el(doc, 'p', {}, t('circle.identityLink.means')), make);
  doc.body.append(dialog);
  try { dialog.showModal(); } catch { dialog.setAttribute('open', ''); }
  return {
    linked: () => say(el(doc, 'p', { 'data-identity-link': 'linked' }, t('circle.identityLink.linked', { bot }))),
    close: () => dialog.close(),
  };
}
