/**
 * basis v2 — contact DM thread (web DOM renderer, feedback-extension).
 *
 * Pure render of a 1:1 conversation with a contact-bot: a header (with a back
 * link to the roster), the message list (user + bot bubbles, with optional
 * reply-buttons), and a composer. The host injects the message list + `t` +
 * handlers; the conversational transport (the contact-thread channel over
 * sa.peer) + the message state live in `circleApp.js`, so this stays unit-
 * testable under happy-dom. Mirrors the other `renderX(container, ctx)`
 * components.
 */

import { createComposerCommands } from '../../src/v2/composerCommands.js';
import { translatorOr } from '../../src/locales/translatorOr.js';

// Privacy-badge palette (§10c) — the discrete states map to Onderling status tokens (mirrors
// apps/basis/src/v2/theme.js). Colour AMPLIFIES the shape; quiet is a NEUTRAL slate outline (never green).
const PRIVACY_BADGE_STYLE = {
  quiet:   { fg: 'var(--ink-soft)', bg: 'transparent', border: 'var(--line)' }, // neutral outline
  sharing: { fg: 'var(--blue)', bg: 'var(--blue-bg)', border: 'var(--blue)' }, // soft-blue fill
  risk:    { fg: 'var(--danger)', bg: 'var(--amber-bg)', border: 'var(--danger)' }, // amber→red
};

// One-time <style> for the flip-to-risk pulse (a subtle emphasis, then settle — never a flashing nag).
let _privacyPulseInjected = false;
function _ensurePrivacyPulseKeyframes() {
  if (_privacyPulseInjected || typeof document === 'undefined' || !document.head) return;
  _privacyPulseInjected = true;
  const style = document.createElement('style');
  style.textContent = '@keyframes cc-privacy-pulse{0%{transform:scale(1)}30%{transform:scale(1.12)}60%{transform:scale(.97)}100%{transform:scale(1)}}.cc-cthread__privacy.is-pulse{animation:cc-privacy-pulse .9s ease-in-out 2}';
  document.head.appendChild(style);
}

export function renderContactThread(container, {
  name = '',
  messages = [],
  skills = [],
  busy = false,
  error = null,
  t,
  onSend,
  onBack,
  onButtonTap,
  onSkillTap,
  inputValue = '',   // pre-fill the composer (inline edit: ✏ a point → its text appears, editable)
  inputHint = '',    // optional placeholder override (e.g. "Editing point N")
  langValue = null,        // when set (+ onLangChange), render an NL/EN picker in the header (feedback thread)
  onLangChange = null,
  privacy = null,          // per-circle privacy indicator (§10c): { level:'quiet'|'sharing'|'risk', icon, label, pulse? }
  onPrivacyTap = null,     // tap the badge → the surface's why/change affordance (surface.showPrivacy)
} = {}) {
  if (!container) return container;
  const tr = translatorOr(t, 'contactThread.js');
  container.innerHTML = '';
  container.className = 'cc-cthread';

  // ── header ────────────────────────────────────────────────────────────────
  const header = document.createElement('div');
  header.className = 'cc-cthread__header';
  const back = document.createElement('button');
  back.type = 'button';
  back.className = 'cc-cthread__back';
  back.textContent = tr('circle.contacts.back');
  back.addEventListener('click', () => { if (typeof onBack === 'function') onBack(); });
  header.appendChild(back);
  const title = document.createElement('h2');
  title.className = 'cc-cthread__title';
  title.textContent = tr('circle.contacts.thread_title', { name });
  header.appendChild(title);
  // Per-circle privacy INDICATOR (§10c) — a persistent, icon-first badge. Only rendered when the host passes
  // `privacy` (i.e. privacyState().applicable). SHAPE carries meaning, colour AMPLIFIES (never colour-alone):
  // quiet → 🛡 neutral outline (grey, NOT green), sharing → 🛡 filled soft-blue, risk → ⚠️ amber→red. The ⚠ is
  // EARNED (level==='risk'); tap → the why/change affordance. A one-time subtle pulse when the state flips to risk.
  if (privacy && (privacy.level === 'quiet' || privacy.level === 'sharing' || privacy.level === 'risk')) {
    const badge = document.createElement('button');
    badge.type = 'button';
    badge.className = `cc-cthread__privacy cc-cthread__privacy--${privacy.level}${privacy.pulse ? ' is-pulse' : ''}`;
    badge.dataset.level = privacy.level;
    const st = PRIVACY_BADGE_STYLE[privacy.level] || PRIVACY_BADGE_STYLE.quiet;
    Object.assign(badge.style, {
      color: st.fg, background: st.bg, border: `1px solid ${st.border}`, borderRadius: '999px',
      padding: '2px 10px', marginLeft: '8px', fontSize: '12px', fontWeight: '600', lineHeight: '1.4',
      cursor: 'pointer', display: 'inline-flex', alignItems: 'center', gap: '4px', whiteSpace: 'nowrap',
    });
    const label = privacy.label || privacy.level;
    badge.textContent = `${privacy.icon || (privacy.level === 'risk' ? '⚠️' : '🛡')} ${label}`;
    badge.setAttribute('aria-label', label);
    badge.title = label;
    badge.addEventListener('click', () => { if (typeof onPrivacyTap === 'function') onPrivacyTap(); });
    header.appendChild(badge);
    if (privacy.pulse) _ensurePrivacyPulseKeyframes();
  }
  // language picker (feedback thread): the participant chooses the BOT's language; the whole thread re-renders.
  if ((langValue === 'nl' || langValue === 'en') && typeof onLangChange === 'function') {
    const toggle = document.createElement('div');
    toggle.className = 'cc-cthread__lang';
    for (const lg of ['nl', 'en']) {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = `cc-cthread__lang-btn${langValue === lg ? ' is-active' : ''}`;
      b.textContent = lg.toUpperCase();
      b.dataset.lang = lg;
      b.addEventListener('click', () => onLangChange(lg));
      toggle.appendChild(b);
    }
    header.appendChild(toggle);
  }
  container.appendChild(header);

  // ── messages ──────────────────────────────────────────────────────────────
  const log = document.createElement('div');
  log.className = 'cc-cthread__log';
  for (const m of messages) {
    // Stage-1 review → editable per-point cards (curated text + the original as a labelled chip + per-card
    // send + a footer). Edit reuses the composer pre-fill via onButtonTap(fp:edit:<id>).
    if (m.kind === 'review') { log.appendChild(renderReviewCards(m, tr, onButtonTap)); continue; }
    const row = document.createElement('div');
    row.className = `cc-cthread__msg cc-cthread__msg--${m.origin === 'user' ? 'user' : 'bot'}`;
    if (m.pending) row.classList.add('is-pending');
    const bubble = document.createElement('div');
    bubble.className = 'cc-cthread__bubble';
    bubble.textContent = m.text ?? '';
    row.appendChild(bubble);
    if (Array.isArray(m.buttons) && m.buttons.length) {
      const btnRow = document.createElement('div');
      btnRow.className = 'cc-cthread__buttons';
      for (const b of m.buttons) {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'cc-cthread__btn';
        btn.dataset.buttonId = b.id ?? '';
        btn.textContent = b.label ?? b.id ?? '';
        btn.addEventListener('click', () => { if (typeof onButtonTap === 'function') onButtonTap(b, m); });
        btnRow.appendChild(btn);
      }
      row.appendChild(btnRow);
    }
    log.appendChild(row);
  }
  if (busy) {
    const pend = document.createElement('div');
    pend.className = 'cc-cthread__sending';
    pend.textContent = tr('circle.contacts.sending');
    log.appendChild(pend);
  }
  container.appendChild(log);

  if (error) {
    const err = document.createElement('div');
    err.className = 'cc-cthread__error';
    err.textContent = tr('circle.contacts.send_failed', { name });
    container.appendChild(err);
  }

  // ── skill quick-actions — the bot's exposed skills as chips ──────
  if (Array.isArray(skills) && skills.length) {
    const skillRow = document.createElement('div');
    skillRow.className = 'cc-cthread__skills';
    for (const sk of skills) {
      const chip = document.createElement('button');
      chip.type = 'button';
      chip.className = 'cc-cthread__skill';
      chip.dataset.skillId = sk.id;
      chip.textContent = `/${sk.id}`;
      if (sk.description) chip.title = sk.description;
      chip.addEventListener('click', () => { if (typeof onSkillTap === 'function') onSkillTap(sk); });
      skillRow.appendChild(chip);
    }
    container.appendChild(skillRow);
  }

  // ── composer ──────────────────────────────────────────────────────────────
  // The typed door. This thread already knew what the peer exposes (`skills`, the chips above) and had
  // no way to TYPE any of it — a `/` line went out as chat. Mobile had a hand-written parser for the
  // same thing; both now read the one seam, so "what can I do here" has one answer per context and one
  // implementation. A bot is a contact, so this is also how a person asks a bot what it offers.
  const commands = createComposerCommands({ kind: 'contact', skills });
  const composer = document.createElement('form');
  composer.className = 'cc-cthread__composer';
  const suggestEl = document.createElement('ul');
  suggestEl.className = 'cc-cthread__suggest';
  suggestEl.hidden = true;
  const input = document.createElement('input');
  input.type = 'text';
  input.className = 'cc-cthread__input';
  input.placeholder = inputHint || tr('circle.contacts.composer', { name });
  if (inputValue) { input.value = inputValue; }
  const paintSuggest = () => {
    const rows = commands.suggest(input.value);
    suggestEl.replaceChildren();
    for (const row of rows) {
      const li = document.createElement('li');
      li.className = 'cc-cthread__suggest-item';
      li.dataset.opId = row.opId;
      const cmd = document.createElement('span');
      cmd.className = 'cc-cthread__suggest-cmd';
      cmd.textContent = row.command;
      li.appendChild(cmd);
      if (row.hint) {
        const hint = document.createElement('span');
        hint.className = 'cc-cthread__suggest-hint';
        hint.textContent = row.hint;
        li.appendChild(hint);
      }
      // Fill the command plus a space, the way the circle composer does — then keep typing arguments.
      // `mousedown`, not `click`: the input blurs first otherwise and the list is gone before the tap.
      li.addEventListener('mousedown', (e) => {
        e.preventDefault();
        input.value = `${row.command} `;
        paintSuggest();
        input.focus();
      });
      suggestEl.appendChild(li);
    }
    suggestEl.hidden = rows.length === 0;
  };
  input.addEventListener('input', paintSuggest);
  container.appendChild(suggestEl);
  composer.appendChild(input);
  const sendBtn = document.createElement('button');
  sendBtn.type = 'submit';
  sendBtn.className = 'cc-cthread__send';
  sendBtn.textContent = tr('circle.contacts.send');
  composer.appendChild(sendBtn);
  composer.addEventListener('submit', (e) => {
    e.preventDefault();
    const text = input.value.trim();
    if (!text) return;
    input.value = '';
    suggestEl.hidden = true;
    // A command this peer offers runs; anything else — including a `/` line they do not expose — is an
    // ordinary turn, because in a conversation a slash is sometimes just a slash.
    const cmd = commands.parse(text);
    if (cmd && typeof onSkillTap === 'function') { onSkillTap({ id: cmd.opId }, cmd.rest); return; }
    if (typeof onSend === 'function') onSend(text);
  });
  container.appendChild(composer);

  return container;
}

/** Stage-1 review block: a card per point (curated text + the original as a labelled chip + per-card send),
 *  with a footer. Tapping the text or ✏ fires onButtonTap(fp:edit:<id>) — the host pre-fills the composer.
 *  Exported so the circle (invite-circle feedback) renders the SAME cards instead of a flattened text bubble. */
export function renderReviewCards(m, tr, onButtonTap) {
  const tap = (id) => { if (typeof onButtonTap === 'function') onButtonTap({ id }, m); };
  // prefer the labels the BOT shipped (in its own language); fall back to the app locale.
  const L = (k) => (m.labels && m.labels[k]) || tr(`circle.feedback.${k}`);
  const block = document.createElement('div');
  block.className = 'cc-cthread__review';
  if (m.intro) {
    const intro = document.createElement('div');
    intro.className = 'cc-cthread__review-intro';
    intro.textContent = String(m.intro).split('\n\n')[0];
    block.appendChild(intro);
  }
  for (const p of (Array.isArray(m.points) ? m.points : [])) {
    const card = document.createElement('div');
    card.className = 'cc-cthread__card';
    const txt = document.createElement('div');
    txt.className = 'cc-cthread__card-text';
    txt.textContent = `${p.text}${p.edited ? ` ${L('edited')}` : ''}`;
    txt.title = tr('circle.feedback.edit_hint');
    txt.addEventListener('click', () => tap(`fp:edit:${p.id}`));
    card.appendChild(txt);
    if (p.raw && p.raw !== p.text) {
      const orig = document.createElement('div');
      orig.className = 'cc-cthread__card-orig';
      const lbl = document.createElement('span'); lbl.className = 'cc-cthread__card-orig-label'; lbl.textContent = L('original');
      const ot = document.createElement('span'); ot.className = 'cc-cthread__card-orig-text'; ot.textContent = p.raw;
      orig.appendChild(lbl); orig.appendChild(ot);
      card.appendChild(orig);
    }
    const btns = document.createElement('div');
    btns.className = 'cc-cthread__card-btns';
    const edit = document.createElement('button');
    edit.type = 'button'; edit.className = 'cc-cthread__card-btn cc-cthread__card-btn--muted'; edit.textContent = '✏';
    edit.addEventListener('click', () => tap(`fp:edit:${p.id}`));
    const send = document.createElement('button');
    send.type = 'button'; send.className = 'cc-cthread__card-btn'; send.textContent = L('send_one');
    send.addEventListener('click', () => tap(`fp:consent:${p.id}`));
    btns.appendChild(edit); btns.appendChild(send);
    card.appendChild(btns);
    block.appendChild(card);
  }
  const footer = document.createElement('div');
  footer.className = 'cc-cthread__review-footer';
  const all = document.createElement('button');
  all.type = 'button'; all.className = 'cc-cthread__card-btn'; all.textContent = L('send_all');
  all.addEventListener('click', () => tap('fp:consent:all'));
  const none = document.createElement('button');
  none.type = 'button'; none.className = 'cc-cthread__card-btn cc-cthread__card-btn--muted'; none.textContent = tr('circle.feedback.send_none');
  none.addEventListener('click', () => tap('fp:cancel'));
  footer.appendChild(all); footer.appendChild(none);
  block.appendChild(footer);
  return block;
}
